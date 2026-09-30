// Client for MKT System, authenticated with a user's connect code (mktmcp_...).
// See CONNECT_CODE_INTEGRATION.md. Never log the code or any token.

const PREFIX = "mktmcp_";
const STORAGE_KEY = "mkt_connection";
const CHANGE_EVENT = "mkt-connection-change";

export interface MktConnection {
  backendUrl: string;
  refreshToken: string;
  email?: string;
  expiresAt: number;
}

export interface MktRequestError extends Error {
  status?: number;
  body?: unknown;
}

function base64UrlDecode(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  // atob returns a binary string; decode it as UTF-8
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function decodeJwt(token: string): { exp: number; user?: { email?: string } } {
  return JSON.parse(base64UrlDecode(token.split(".")[1]));
}

export class ConnectCodeExpiredError extends Error {
  constructor() {
    super("Mã kết nối đã hết hạn. Đăng nhập lại MKT System và lấy mã mới.");
  }
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
  if (data.v !== 1) throw new Error(`Mã kết nối phiên bản ${data.v} chưa được hỗ trợ.`);
  if (!data.backendUrl || !data.refreshToken) throw new Error("Mã kết nối thiếu dữ liệu.");

  let payload: ReturnType<typeof decodeJwt>;
  try {
    payload = decodeJwt(data.refreshToken);
  } catch {
    throw new Error("Mã kết nối bị hỏng, copy lại từ MKT System.");
  }
  const conn: MktConnection = {
    backendUrl: data.backendUrl.replace(/\/?$/, "/"),
    refreshToken: data.refreshToken,
    email: payload.user?.email,
    expiresAt: payload.exp * 1000,
  };
  if (Date.now() >= conn.expiresAt) throw new ConnectCodeExpiredError();
  return conn;
}

// ── Storage (sessionStorage only, per security checklist) ──

export function loadConnection(): MktConnection | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const conn = JSON.parse(raw) as MktConnection;
    if (!conn.refreshToken || Date.now() >= conn.expiresAt) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return conn;
  } catch {
    return null;
  }
}

export function saveConnection(conn: MktConnection) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
  cachedClient = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearConnection() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  cachedClient = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onConnectionChange(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// ── API client ──

export type MktClient = ReturnType<typeof createMktClient>;

export function createMktClient(conn: MktConnection) {
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
      const data = await res.json().catch(() => null);
      throw new Error(data?.message || `Không lấy được access token (HTTP ${res.status}).`);
    }
    const body = await res.json();
    accessToken = body.dataSource.accessToken as string;
    accessExpiresAt = decodeJwt(accessToken).exp * 1000;
    return accessToken;
  }

  function getAccessToken(force = false): Promise<string> {
    if (!force && accessToken && accessExpiresAt - Date.now() > 60_000) {
      return Promise.resolve(accessToken);
    }
    if (!inflight) inflight = refresh().finally(() => (inflight = null));
    return inflight;
  }

  async function request<T = unknown>(
    path: string,
    { method = "GET", body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<T> {
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
    if (res.status === 401) res = await send(await getAccessToken(true));

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = Array.isArray(data?.message) ? data.message.join("; ") : data?.message;
      const err: MktRequestError = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data as T;
  }

  return { request, getAccessToken, email: conn.email, expiresAt: conn.expiresAt };
}

let cachedClient: { conn: MktConnection; client: MktClient } | null = null;

/** Returns a shared client for the stored connection, or null if not connected. */
export function getMktClient(): MktClient | null {
  const conn = loadConnection();
  if (!conn) return null;
  if (cachedClient && cachedClient.conn.refreshToken === conn.refreshToken) return cachedClient.client;
  cachedClient = { conn, client: createMktClient(conn) };
  return cachedClient.client;
}

// ── Creative upload ──

const PART_SIZE = 10 * 1024 * 1024;
export const MAX_CREATIVE_SIZE = 300 * 1024 * 1024;

export async function uploadToS3(mkt: MktClient, file: File, folder = "mkt-system"): Promise<string> {
  const { uploadId, key } = await mkt.request<{ uploadId: string; key: string }>("files/multipart/init", {
    method: "POST",
    body: { fileName: file.name, contentType: file.type || "application/octet-stream", folder },
  });

  try {
    const partNumbers = Array.from({ length: Math.max(1, Math.ceil(file.size / PART_SIZE)) }, (_, i) => i + 1);
    const parts: { PartNumber: number; ETag: string }[] = [];

    for (let i = 0; i < partNumbers.length; i += 3) {
      const { parts: urls } = await mkt.request<{ parts: { partNumber: number; presignedUrl: string }[] }>(
        "files/multipart/presign-batch",
        { method: "POST", body: { uploadId, key, partNumbers: partNumbers.slice(i, i + 3), expiresIn: 1800 } }
      );

      await Promise.all(
        urls.map(async ({ partNumber, presignedUrl }) => {
          const start = (partNumber - 1) * PART_SIZE;
          const res = await fetch(presignedUrl, { method: "PUT", body: file.slice(start, start + PART_SIZE) });
          if (!res.ok) throw new Error(`Upload part ${partNumber} lỗi HTTP ${res.status}`);
          const eTag = res.headers.get("ETag");
          if (!eTag) throw new Error("S3 không trả ETag, kiểm tra CORS của bucket.");
          parts.push({ PartNumber: partNumber, ETag: eTag.replace(/"/g, "") });
        })
      );
    }

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    const { url } = await mkt.request<{ url: string }>("files/multipart/complete", {
      method: "POST",
      body: { uploadId, key, parts },
    });
    return url;
  } catch (err) {
    await mkt.request("files/multipart/abort", { method: "POST", body: { uploadId, key } }).catch(() => {});
    throw err;
  }
}

export interface CreativeItem {
  url: string;
  name: string;
  format: "IMAGE" | "VIDEO";
  thumbnail?: string;
  size?: number;
  duration?: number;
  isPublic?: boolean;
  tags?: string[];
  productIds?: string[];
  angleCodes?: string[];
  marketTargets?: string[];
  languages?: string[];
}

export async function createCreatives(mkt: MktClient, items: CreativeItem[], idempotencyKey: string) {
  return mkt.request<{ id: string }[]>("automation-facebook/creative-settings/bulk", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: { items },
  });
}

/** Resize an image to 800px wide and export as webp (thumbnail convention of MKT System). */
export async function makeImageThumbnail(src: string, name: string): Promise<File | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = Math.min(800, img.naturalWidth);
    const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/webp", 0.85));
    return blob ? new File([blob], name.replace(/\.[^.]+$/, "") + "-thumb.webp", { type: "image/webp" }) : null;
  } catch {
    return null;
  }
}

export function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(",");
  const type = head.match(/data:([^;]+)/)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new File([bytes], name, { type });
}

// ── Google ad templates ──

export interface AdContentBlock { headlines: string[]; descriptions: string[]; }

export const AD_LIMITS = { headlineMax: 30, descriptionMax: 90, maxPerBlock: 5 };

/** Validates a block against the "used to create a campaign" rules. Returns error messages. */
export function validateAdBlock(block: AdContentBlock): string[] {
  const errors: string[] = [];
  const headlines = block.headlines.map(h => h.trim()).filter(Boolean);
  const descriptions = block.descriptions.map(d => d.trim()).filter(Boolean);
  const distinct = new Set(headlines).size;
  if (headlines.length > AD_LIMITS.maxPerBlock) errors.push(`Tối đa ${AD_LIMITS.maxPerBlock} headline`);
  if (distinct < 2) errors.push("Cần ≥ 2 headline khác nhau");
  const longH = headlines.filter(h => h.length > AD_LIMITS.headlineMax).length;
  if (longH) errors.push(`${longH} headline vượt ${AD_LIMITS.headlineMax} ký tự`);
  if (descriptions.length < 1) errors.push("Cần ≥ 1 description");
  if (descriptions.length > AD_LIMITS.maxPerBlock) errors.push(`Tối đa ${AD_LIMITS.maxPerBlock} description`);
  const longD = descriptions.filter(d => d.length > AD_LIMITS.descriptionMax).length;
  if (longD) errors.push(`${longD} description vượt ${AD_LIMITS.descriptionMax} ký tự`);
  return errors;
}

export async function createGoogleAdTemplate(mkt: MktClient, name: string, adContents: AdContentBlock[]) {
  return mkt.request<{ id: string; name: string }>("automation-facebook/ad-templates", {
    method: "POST",
    body: {
      name,
      channel: "google",
      adContents: adContents.map(b => ({
        headlines: b.headlines.map(h => h.trim()).filter(Boolean),
        descriptions: b.descriptions.map(d => d.trim()).filter(Boolean),
      })),
    },
  });
}
