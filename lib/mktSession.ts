import { cookies } from "next/headers";
import { parseConnectCode, createMktClient, MktClient, MktConnection } from "@/lib/mktClient";

/**
 * Where the connect code lives between requests.
 *
 * httpOnly so the browser cannot read it back, and it is NOT an environment
 * variable: unlike an API key it belongs to one person, is pasted at runtime,
 * and expires within a day.
 */
export const MKT_COOKIE = "mkt_connect";

export async function storeConnection(code: string, conn: MktConnection) {
  const jar = await cookies();
  jar.set(MKT_COOKIE, code, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    // Never outlive the code itself.
    expires: new Date(conn.expiresAt),
  });
}

export async function clearConnection() {
  (await cookies()).delete(MKT_COOKIE);
}

export async function readConnection(): Promise<MktConnection | null> {
  const raw = (await cookies()).get(MKT_COOKIE)?.value;
  if (!raw) return null;
  try {
    return parseConnectCode(raw);
  } catch {
    return null;
  }
}

/** Throws a 401-shaped error message when there is no usable code. */
export async function requireMkt(): Promise<MktClient> {
  const conn = await readConnection();
  if (!conn) throw new Error("not_connected");
  return createMktClient(conn);
}
