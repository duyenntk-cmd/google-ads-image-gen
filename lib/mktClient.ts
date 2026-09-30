/**
 * Client for MKT System's connect-code API.
 *
 * Runs on the server only. The connect code is the user's credential for up to
 * 24 hours, it cannot be revoked, and MKT System's own integration guide asks
 * for it to be kept server-side — so it lives in an httpOnly cookie and never
 * reaches the browser again after it is pasted.
 *
 * The S3 upload also has to run here: the PUT goes straight to the bucket, and
 * a browser doing it needs that origin in the bucket's CORS rules and needs
 * ETag exposed. From the server neither is our problem.
 */

const PREFIX = "mktmcp_";

export class ConnectCodeExpiredError extends Error {
  constructor() {
    super("Mã kết nối đã hết hạn. Đăng nhập lại MKT System và lấy mã mới.");
  }
}

export interface MktConnection {
  backendUrl: string;
  refreshToken: string;
  email: string;
  /** ms since epoch. Fixed at MKT System login — refreshing never moves it. */
  expiresAt: number;
}

function base64UrlDecode(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8");
}

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(base64UrlDecode(token.split(".")[1]));
}

export function parseConnectCode(raw: string): MktConnection {
  const code = (raw || "").trim();
  if (!code.startsWith(PREFIX)) throw new Error("Không phải mã kết nối MKT System.");

  let data: { v?: number; backendUrl?: string; refreshToken?: string };
  try {
    data = JSON.parse(base64UrlDecode(code.slice(PREFIX.length)));
  } catch {
    throw new Error("Mã kết nối bị hỏng, copy lại từ MKT System.");
  }
  // An unknown version means the shape may have changed; guessing would send a
  // credential somewhere it was not meant to go.
  if (data.v !== 1) throw new Error(`Mã kết nối phiên bản ${data.v} chưa được hỗ trợ.`);
  if (!data.backendUrl || !data.refreshToken) throw new Error("Mã kết nối thiếu dữ liệu.");

  const payload = decodeJwt(data.refreshToken) as { user?: { email?: string }; exp?: number };
  const conn: MktConnection = {
    backendUrl: data.backendUrl.replace(/\/?$/, "/"),
    refreshToken: data.refreshToken,
    email: payload.user?.email || "",
    expiresAt: (payload.exp || 0) * 1000,
  };
  if (Date.now() >= conn.expiresAt) throw new ConnectCodeExpiredError();
  return conn;
}

export interface MktClient {
  request<T = unknown>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<T>;
  email: string;
  expiresAt: number;
}

export function createMktClient(conn: MktConnection): MktClient {
  let accessToken: string | null = null;
  let accessExpiresAt = 0;
  let inflight: Promise<string> | null = null;

  async function refresh(): Promise<string> {
    if (Date.now() >= conn.expiresAt) throw new ConnectCodeExpiredError();
    const res = await fetch(conn.backendUrl + "auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: conn.refreshToken }),
    });
    if (res.status === 401) throw new ConnectCodeExpiredError();
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Không lấy được access token (HTTP ${res.status}). ${detail.slice(0, 200)}`);
    }
    const body = await res.json();
    accessToken = body?.dataSource?.accessToken;
    if (!accessToken) throw new Error("Response /auth không có accessToken.");
    // The guide says an hour, and also says to read exp rather than assume it.
    accessExpiresAt = ((decodeJwt(accessToken) as { exp?: number }).exp || 0) * 1000;
    return accessToken;
  }

  function getAccessToken(force = false): Promise<string> {
    if (!force && accessToken && accessExpiresAt - Date.now() > 60_000) {
      return Promise.resolve(accessToken);
    }
    // One refresh for however many calls are in flight.
    if (!inflight) inflight = refresh().finally(() => { inflight = null; });
    return inflight;
  }

  async function request<T>(path: string, { method = "GET", body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const send = (token: string) =>
      fetch(conn.backendUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined && { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let res = await send(await getAccessToken());
    // A 401 on a live token usually means the user's permissions just changed.
    // Retry once; twice would just be a loop.
    if (res.status === 401) res = await send(await getAccessToken(true));

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data as { message?: string })?.message || `HTTP ${res.status}`) as Error & { status?: number; body?: unknown };
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data as T;
  }

  return { request, email: conn.email, expiresAt: conn.expiresAt };
}

/* ─────────────────────── creative upload ─────────────────────── */

const PART_SIZE = 10 * 1024 * 1024;

/**
 * Multipart upload straight to S3, then the public URL.
 *
 * Presigned URLs are requested a few parts ahead of use rather than all at
 * once, so a slow upload does not outlive them.
 */
export async function uploadToS3(
  mkt: MktClient,
  file: { name: string; contentType: string; bytes: Uint8Array },
  folder = "mkt-system",
): Promise<string> {
  const { uploadId, key } = await mkt.request<{ uploadId: string; key: string }>("files/multipart/init", {
    method: "POST",
    body: { fileName: file.name, contentType: file.contentType || "application/octet-stream", folder },
  });

  try {
    const partNumbers = Array.from({ length: Math.max(1, Math.ceil(file.bytes.length / PART_SIZE)) }, (_, i) => i + 1);
    const parts: { PartNumber: number; ETag: string }[] = [];

    for (let i = 0; i < partNumbers.length; i += 3) {
      const { parts: urls } = await mkt.request<{ parts: { partNumber: number; presignedUrl: string }[] }>(
        "files/multipart/presign-batch",
        { method: "POST", body: { uploadId, key, partNumbers: partNumbers.slice(i, i + 3), expiresIn: 1800 } },
      );

      await Promise.all(
        urls.map(async ({ partNumber, presignedUrl }) => {
          const start = (partNumber - 1) * PART_SIZE;
          const chunk = file.bytes.subarray(start, start + PART_SIZE);
          // No Authorization header here: the presigned URL carries the grant,
          // and sending one makes S3 reject the request.
          const res = await fetch(presignedUrl, { method: "PUT", body: chunk as unknown as BodyInit });
          if (!res.ok) throw new Error(`Upload part ${partNumber} lỗi HTTP ${res.status}`);
          const eTag = res.headers.get("ETag");
          if (!eTag) throw new Error("S3 không trả ETag.");
          parts.push({ PartNumber: partNumber, ETag: eTag.replace(/"/g, "") });
        }),
      );
    }

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    const { url } = await mkt.request<{ url: string }>("files/multipart/complete", {
      method: "POST",
      body: { uploadId, key, parts },
    });
    return url;
  } catch (err) {
    // Leaving an upload open leaves paid-for parts sitting in the bucket.
    await mkt.request("files/multipart/abort", { method: "POST", body: { uploadId, key } }).catch(() => {});
    throw err;
  }
}

/* ─────────────────────── ad template rules ───────────────────────
 * Google's limits, as MKT System's guide states them. The backend will SAVE a
 * template that cannot later create a campaign — a block with one headline or
 * no description — so this checks the stricter campaign-time rule, for every
 * block, before anything is sent.
 */

export interface AdContent { headlines: string[]; descriptions: string[] }

export function validateAdContents(blocks: AdContent[]): string[] {
  const errors: string[] = [];
  if (!blocks.length) errors.push("Cần ít nhất 1 khối nội dung.");
  blocks.forEach((b, i) => {
    const label = `Khối ${i + 1}`;
    // Blank and duplicate headlines are dropped before counting, so two
    // identical lines count as one.
    const heads = Array.from(new Set((b.headlines || []).map((h) => h.trim()).filter(Boolean)));
    const descs = (b.descriptions || []).map((d) => d.trim()).filter(Boolean);
    if (heads.length < 2) errors.push(`${label}: cần ít nhất 2 headline KHÁC NHAU (đang có ${heads.length}).`);
    if (heads.length > 5) errors.push(`${label}: tối đa 5 headline.`);
    if (descs.length < 1) errors.push(`${label}: cần ít nhất 1 description.`);
    if (descs.length > 5) errors.push(`${label}: tối đa 5 description.`);
    heads.filter((h) => h.length > 30).forEach((h) => errors.push(`${label}: headline quá 30 ký tự — "${h}" (${h.length}).`));
    descs.filter((d) => d.length > 90).forEach((d) => errors.push(`${label}: description quá 90 ký tự — "${d.slice(0, 40)}…" (${d.length}).`));
  });
  return errors;
}

export function normaliseAdContents(blocks: AdContent[]): AdContent[] {
  return blocks.map((b) => ({
    headlines: Array.from(new Set((b.headlines || []).map((h) => h.trim()).filter(Boolean))).slice(0, 5),
    descriptions: (b.descriptions || []).map((d) => d.trim()).filter(Boolean).slice(0, 5),
  }));
}
