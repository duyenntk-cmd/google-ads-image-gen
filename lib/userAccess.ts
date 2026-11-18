import { getUsersFromSheet, passwordStamp, userIdOf, type SheetUser } from "@/lib/sheetsUsers";
import type { Role } from "@/lib/roles";

/**
 * Current access of a person, read from the Users sheet (cached 1 minute per
 * server instance). Used to end web sessions and connector keys of people who
 * were turned off, and to pick up role changes, without a deploy.
 *
 * When the sheet cannot be read, the last good copy is used. If there has
 * never been one (sheet down since the instance started, or no service
 * account configured), the answer is null and callers let the person through:
 * a Google outage must not lock the whole team out.
 */
// With RECHECK_MS in lib/authOptions.ts (4 min), a change in the sheet reaches
// every live session within 5 minutes. Cost: at most one sheet read a minute per instance.
const TTL_MS = 60_000;
let cache: { at: number; users: SheetUser[] } | null = null;

async function users(): Promise<{ at: number; users: SheetUser[] } | null> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  try {
    const list = await getUsersFromSheet();
    cache = { at: Date.now(), users: list };
    return cache;
  } catch (e) {
    console.error("userAccess:", e instanceof Error ? e.message : e);
    return cache;
  }
}

/** Drop this instance's copy, e.g. right after a password change written from here. */
export function forgetUsers() {
  cache = null;
}

export interface Access {
  /** The person has a row in the Users sheet. */
  found: boolean;
  /** Has a row and Active is not "no". */
  active: boolean;
  role: Role;
  /** passwordStamp of the stored password cell; "" when the person has no row. */
  pwStamp: string;
  /** When the sheet copy behind this answer was read (ms). */
  readAt: number;
}

/** null = cannot tell (see above). An empty Users tab also answers null. */
export async function accessOf(emailOrName: string | null | undefined): Promise<Access | null> {
  const copy = await users();
  if (!copy?.users.length) return null;
  const id = userIdOf(emailOrName);
  const u = copy.users.find(x => x.username === id);
  return u
    ? { found: true, active: u.active, role: u.role, pwStamp: passwordStamp(u.password), readAt: copy.at }
    : { found: false, active: false, role: "ua", pwStamp: "", readAt: copy.at };
}
