import crypto from "crypto";

/**
 * Personal key for the Claude connector (/api/mcp/<key>).
 *
 * A Claude custom connector is reached by URL only — no login form, no custom
 * header — so the key is part of the URL. It is the user's name plus an HMAC
 * of it with NEXTAUTH_SECRET: nothing to store, and it cannot be forged
 * without the secret. Turning the user off in the Users sheet blocks it;
 * rotating NEXTAUTH_SECRET invalidates every key at once.
 */
const PREFIX = "gaic_";

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET chưa được cấu hình.");
  return s;
}

function sign(user: string): string {
  return crypto.createHmac("sha256", secret()).update(`mcp:v1:${user}`).digest("base64url").slice(0, 32);
}

export function mcpKeyFor(user: string): string {
  const u = user.trim().toLowerCase();
  return `${PREFIX}${Buffer.from(u).toString("base64url")}.${sign(u)}`;
}

/** The user a key belongs to, or null when it is malformed or forged. */
export function userFromMcpKey(key: string): string | null {
  if (!key?.startsWith(PREFIX)) return null;
  const [u64, sig] = key.slice(PREFIX.length).split(".");
  if (!u64 || !sig) return null;
  let user: string;
  try {
    user = Buffer.from(u64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!user || user.length > 200) return null;
  const want = Buffer.from(sign(user));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? user : null;
}
