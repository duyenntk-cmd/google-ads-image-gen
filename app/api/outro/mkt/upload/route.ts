import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { requireMkt } from "@/lib/mktSession";
import { ConnectCodeExpiredError, uploadToS3 } from "@/lib/mktClient";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Outro Studio → MKT System: putting finished videos in the creative library.
 *
 * Same connection (/api/mkt/connect, cookie `mkt_connect`) and the same two
 * stages as the creative upload on the Banner + Ad Copy page: the
 * file goes to MKT System's S3 by multipart upload, then one bulk call to
 * `automation-facebook/creative-settings/bulk` creates the creatives.
 *
 * The difference is size. A banner fits in one request to this server; a
 * video does not (Vercel caps a request body at 4.5MB, and S3 parts must be
 * at least 5MB). So this route only does the signed calls, with the connect
 * code that never leaves the server, and the browser PUTs each part straight
 * to the presigned S3 URL it is handed. A presigned URL is a grant for one
 * part of one upload, for half an hour.
 *
 * One POST, `action` picks the step:
 *   init     { fileName, contentType, size }      → { uploadId, key, partSize, parts }  (links for the first parts)
 *   presign  { uploadId, key, partNumbers }        → { parts: [{ partNumber, presignedUrl }] }
 *   complete { uploadId, key, parts }              → { url }
 *   abort    { uploadId, key }                     → {}
 *   thumb    { name, dataUrl }                     → { url }   (small JPEG, goes through here)
 *   create   { items, idempotencyKey }             → { creatives }
 */

/** MKT System's own uploader: 300MB, and of video only mp4/mov. */
const MAX_BYTES = 300 * 1024 * 1024;
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
/** Part size the page slices the file into. S3's floor is 5MB for every part but the last. */
const PART_SIZE = 10 * 1024 * 1024;
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

type Mkt = Awaited<ReturnType<typeof requireMkt>>;

function bad(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const comma = dataUrl.indexOf(",");
  const head = comma > 0 ? dataUrl.slice(0, comma) : "";
  if (!head.startsWith("data:") || !head.includes(";base64")) throw new Error("Ảnh thumbnail không hợp lệ.");
  const contentType = head.slice(5).split(";")[0] || "application/octet-stream";
  return { contentType, bytes: new Uint8Array(Buffer.from(dataUrl.slice(comma + 1), "base64")) };
}

async function init(mkt: Mkt, body: Record<string, unknown>) {
  const fileName = str(body.fileName).trim();
  const contentType = str(body.contentType).toLowerCase().split(";")[0].trim();
  const size = Number(body.size);
  if (!fileName) return bad("Thiếu tên file.");
  if (!VIDEO_TYPES.has(contentType)) {
    return bad(`MKT System chỉ nhận video MP4 hoặc MOV (file này là ${contentType || "không rõ định dạng"}).`);
  }
  if (!Number.isFinite(size) || size <= 0) return bad("Thiếu dung lượng file.");
  if (size > MAX_BYTES) return bad(`File quá 300MB (${(size / 1048576).toFixed(0)}MB).`);

  const { uploadId, key } = await mkt.request<{ uploadId: string; key: string }>("files/multipart/init", {
    method: "POST",
    body: { fileName, contentType, folder: "mkt-system" },
  });
  // Presign the first parts here too, saving the page one round trip per video
  // (all of them for a video up to 60MB). If it fails the page presigns itself.
  let parts: { partNumber: number; presignedUrl: string }[] = [];
  try {
    const first = Array.from({ length: Math.min(6, Math.ceil(size / PART_SIZE)) }, (_, i) => i + 1);
    parts = (await mkt.request<{ parts: typeof parts }>("files/multipart/presign-batch", {
      method: "POST",
      body: { uploadId, key, partNumbers: first, expiresIn: 1800 },
    })).parts || [];
  } catch { parts = []; }
  return NextResponse.json({ success: true, uploadId, key, partSize: PART_SIZE, parts });
}

async function presign(mkt: Mkt, body: Record<string, unknown>) {
  const uploadId = str(body.uploadId);
  const key = str(body.key);
  const partNumbers = Array.isArray(body.partNumbers)
    ? body.partNumbers.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10000)
    : [];
  if (!uploadId || !key) return bad("Thiếu uploadId/key.");
  if (!partNumbers.length || partNumbers.length > 10) return bad("partNumbers phải có 1–10 phần.");

  const { parts } = await mkt.request<{ parts: { partNumber: number; presignedUrl: string }[] }>(
    "files/multipart/presign-batch",
    { method: "POST", body: { uploadId, key, partNumbers, expiresIn: 1800 } },
  );
  return NextResponse.json({ success: true, parts });
}

async function complete(mkt: Mkt, body: Record<string, unknown>) {
  const uploadId = str(body.uploadId);
  const key = str(body.key);
  const parts = Array.isArray(body.parts)
    ? body.parts
        .map((p: { PartNumber?: unknown; ETag?: unknown }) => ({
          PartNumber: Number(p?.PartNumber),
          ETag: String(p?.ETag ?? "").replace(/"/g, ""),
        }))
        .filter((p) => Number.isInteger(p.PartNumber) && p.PartNumber >= 1 && p.ETag)
        .sort((a, b) => a.PartNumber - b.PartNumber)
    : [];
  if (!uploadId || !key || !parts.length) return bad("Thiếu uploadId/key/parts.");

  const { url } = await mkt.request<{ url: string }>("files/multipart/complete", {
    method: "POST",
    body: { uploadId, key, parts },
  });
  return NextResponse.json({ success: true, url });
}

async function abort(mkt: Mkt, body: Record<string, unknown>) {
  const uploadId = str(body.uploadId);
  const key = str(body.key);
  if (!uploadId || !key) return bad("Thiếu uploadId/key.");
  // Leaving an upload open leaves paid-for parts sitting in the bucket.
  await mkt.request("files/multipart/abort", { method: "POST", body: { uploadId, key } }).catch(() => {});
  return NextResponse.json({ success: true });
}

async function thumb(mkt: Mkt, body: Record<string, unknown>) {
  const name = str(body.name).trim() || "thumb.jpg";
  const { bytes, contentType } = decodeDataUrl(str(body.dataUrl));
  if (!contentType.startsWith("image/")) return bad("Thumbnail phải là ảnh.");
  if (bytes.length > MAX_THUMB_BYTES) return bad("Thumbnail quá lớn.");
  const url = await uploadToS3(mkt, { name, contentType, bytes });
  return NextResponse.json({ success: true, url });
}

async function create(mkt: Mkt, body: Record<string, unknown>) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return bad("Không có video nào.");
  if (items.length > 100) return bad("Tối đa 100 video một lần.");

  const prepared: Record<string, unknown>[] = [];
  for (const it of items as Record<string, unknown>[]) {
    const url = str(it?.url);
    const name = str(it?.name).trim().slice(0, 120);
    if (!url.startsWith("https://") || !name) return bad(`${name || "video"}: thiếu url hoặc tên.`);
    const thumbnail = str(it.thumbnail);
    const tags = strList(it.tags);
    const angleCodes = strList(it.angleCodes);
    prepared.push({
      url,
      name,
      format: "VIDEO",
      isPublic: Boolean(it.isPublic),
      ...(typeof it.size === "number" && it.size > 0 && { size: it.size }),
      ...(thumbnail.startsWith("https://") && { thumbnail }),
      // whole seconds: the Banner page never sends duration, so its type is unproven; an integer fits either way
      ...(typeof it.duration === "number" && it.duration > 0 && { duration: Math.max(1, Math.round(it.duration)) }),
      ...(tags.length && { tags }),
      ...(angleCodes.length && { angleCodes }),
    });
  }

  // One bulk call for the whole batch. The page keeps the same key for a
  // retry of the same batch, so the backend replays instead of duplicating.
  const idem = str(body.idempotencyKey);
  const creatives = await mkt.request<unknown[]>("automation-facebook/creative-settings/bulk", {
    method: "POST",
    headers: idem ? { "Idempotency-Key": idem } : {},
    body: { items: prepared },
  });
  return NextResponse.json({ success: true, creatives });
}

const ACTIONS = { init, presign, complete, abort, thumb, create } as const;

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Body không phải JSON.");
  }
  const action = str(body.action);
  const run = ACTIONS[action as keyof typeof ACTIONS];
  if (!run) return bad("action không hợp lệ.");

  try {
    const mkt = await requireMkt();
    return await run(mkt, body);
  } catch (err) {
    const e = err as Error & { status?: number; body?: unknown };
    // MKT System's own message is often just "Internal server error"; the
    // step and its response body in the Vercel log are what narrow it down.
    console.error(`[outro-mkt] ${action} failed`, e?.status ?? "", e?.message, JSON.stringify(e?.body ?? null).slice(0, 1000));
    // `reconnect` tells the page to ask for a new connect code.
    if (e?.message === "not_connected") {
      return NextResponse.json({ success: false, error: "not_connected", reconnect: true }, { status: 401 });
    }
    if (e instanceof ConnectCodeExpiredError) {
      return NextResponse.json({ success: false, error: e.message, reconnect: true }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: e?.message || "Lỗi MKT System.", detail: e?.body },
      { status: e?.status && e.status >= 400 ? e.status : 500 },
    );
  }
}
