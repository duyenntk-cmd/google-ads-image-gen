import { getUsersFromSheet, userIdOf, type SheetUser } from "@/lib/sheetsUsers";
import type { Role } from "@/lib/roles";

/**
 * Current access of a person, read from the Users sheet (cached 5 minutes per
 * server instance). Used to end web sessions and connector keys of people who
 * were turned off, and to pick up role changes, without a deploy.
 *
 * When the sheet cannot be read, the last good copy is used. If there has
 * never been one (sheet down since the instance started, or no service
 * account configured), the answer is null and callers let the person through:
 * a Google outage must not lock the whole team out.
 */
const TTL_MS = 5 * 60_000;
let cache: { at: number; users: SheetUser[] } | null = null;

async function users(): Promise<SheetUser[] | null> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.users;
  try {
    const list = await getUsersFromSheet();
    cache = { at: Date.now(), users: list };
    return list;
  } catch (e) {
    console.error("userAccess:", e instanceof Error ? e.message : e);
    return cache?.users ?? null;
  }
}

export interface Access {
  /** The person has a row in the Users sheet. */
  found: boolean;
  /** Has a row and Active is not "no". */
  active: boolean;
  role: Role;
}

/** null = cannot tell (see above). An empty Users tab also answers null. */
export async function accessOf(emailOrName: string | null | undefined): Promise<Access | null> {
  const list = await users();
  if (!list?.length) return null;
  const id = userIdOf(emailOrName);
  const u = list.find(x => x.username === id);
  return u ? { found: true, active: u.active, role: u.role } : { found: false, active: false, role: "ua" };
}
