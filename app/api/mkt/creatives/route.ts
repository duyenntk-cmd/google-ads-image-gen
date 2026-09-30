import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { requireMkt } from "@/lib/mktSession";
import { uploadToS3 } from "@/lib/mktClient";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Creative library upload.
 *
 * Files arrive as data URLs from the browser — AI Banner already holds its
 * output that way — and the two-stage upload (S3 multipart, then one bulk
 * call) happens here rather than in the page, so the bucket never has to know
 * about this origin.
 *
 * MKT System's own uploader caps files at 300MB and accepts
 * jpg/jpeg/png/gif/mp4/mov; the same limits apply here so a file is rejected
 * before it is carried across the network twice.
 */
const MAX_BYTES = 300 * 1024 * 1024;
const ALLOWED: Record<string, "IMAGE" | "VIDEO"> = {
  "image/jpeg": "IMAGE", "image/jpg": "IMAGE", "image/png": "IMAGE", "image/gif": "IMAGE",
  "video/mp4": "VIDEO", "video/quicktime": "VIDEO",
};

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  // Split rather than match across the payload: a base64 body is megabytes
  // long and a greedy regex over it is wasted work.
  const comma = (dataUrl || "").indexOf(",");
  const head = comma > 0 ? dataUrl.slice(0, comma) : "";
  if (!head.startsWith("data:")) throw new Error("File không phải data URL hợp lệ.");
  const contentType = head.slice(5).split(";")[0] || "application/octet-stream";
  return { contentType, bytes: new Uint8Array(Buffer.from(dataUrl.slice(comma + 1), "base64")) };
}

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const mkt = await requireMkt();
    const { items, idempotencyKey } = await req.json();
    if (!Array.isArray(items) || !items.length) {
      return NextResponse.json({ success: false, error: "Không có file nào." }, { status: 400 });
    }

    const prepared: Record<string, unknown>[] = [];
    const errors: string[] = [];

    for (const item of items) {
      try {
        const { bytes, contentType } = decodeDataUrl(item.dataUrl);
        const format = ALLOWED[contentType.toLowerCase()];
        if (!format) throw new Error(`Định dạng ${contentType} không được hỗ trợ.`);
        if (bytes.length > MAX_BYTES) throw new Error(`File quá 300MB (${(bytes.length / 1048576).toFixed(0)}MB).`);

        const url = await uploadToS3(mkt, { name: item.name, contentType, bytes });

        // A creative without a thumbnail still lands in the library, just
        // without a preview — so a failed thumbnail must not fail the upload.
        let thumbnail: string | null = null;
        if (item.thumbnailDataUrl) {
          try {
            const th = decodeDataUrl(item.thumbnailDataUrl);
            thumbnail = await uploadToS3(mkt, { name: `thumb-${item.name}`, contentType: th.contentType, bytes: th.bytes });
          } catch { /* preview only */ }
        }

        prepared.push({
          url,
          name: item.name,
          format,
          size: bytes.length,
          ...(thumbnail && { thumbnail }),
          isPublic: Boolean(item.isPublic),
          ...(item.duration && { duration: item.duration }),
          ...(item.tags?.length && { tags: item.tags }),
          ...(item.productIds?.length && { productIds: item.productIds }),
          ...(item.angleCodes?.length && { angleCodes: item.angleCodes }),
          ...(item.marketTargets?.length && { marketTargets: item.marketTargets }),
          ...(item.languages?.length && { languages: item.languages }),
        });
      } catch (e) {
        errors.push(`${item?.name || "file"}: ${(e as Error)?.message || "lỗi không rõ"}`);
      }
    }

    if (!prepared.length) {
      return NextResponse.json({ success: false, error: "Không upload được file nào.\n" + errors.join("\n") }, { status: 400 });
    }

    // Everything that reached S3 goes up in ONE bulk call, carrying the key the
    // client generated — a retry after a network error reuses it and the
    // backend replays instead of creating duplicates.
    const res = await mkt.request<unknown[]>("automation-facebook/creative-settings/bulk", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : {},
      body: { items: prepared },
    });

    return NextResponse.json({ success: true, creatives: res, errors });
  } catch (err) {
    const e = err as Error & { status?: number; body?: unknown };
    if (e?.message === "not_connected") {
      return NextResponse.json({ success: false, error: "not_connected" }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: e?.message || "Lỗi upload creative.", detail: e?.body },
      { status: e?.status || 500 },
    );
  }
}
