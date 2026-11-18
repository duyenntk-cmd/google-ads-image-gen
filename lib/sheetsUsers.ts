import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getAccessToken, SPREADSHEET_ID } from "@/lib/sheetsLogger";
import { parseRole, type Role } from "@/lib/roles";

/**
 * Accounts live in the "Users" tab of the system sheet:
 *   A Username · B Password · C Name · D Active (no = turned off) · E Role (ua | creative)
 *
 * Passwords are stored as scrypt hashes ("scrypt$<salt>$<hash>"). An admin who
 * creates or resets an account types the password in plain text; the first
 * successful sign-in replaces it with the hash, so the sheet stops holding
 * readable passwords.
 */
const USERS_SHEET = "Users";
const HEADER = ["Username", "Password", "Name", "Active", "Role"];
const INTERNAL_DOMAIN = "@ads-gen.internal";

export interface SheetUser {
  username: string;
  password: string; // scrypt hash, or plain text / old SHA-256 until the next sign-in
  name: string;
  active: boolean;
  role: Role;
  row: number; // sheet row, for the hash upgrade
}

export async function getUsersFromSheet(): Promise<SheetUser[]> {
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };

  // Header row: create it on an empty tab, add the Role column to an older one.
  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A1:E1`,
    { headers: auth },
  );
  if (!checkRes.ok) throw new Error(`Không đọc được tab ${USERS_SHEET}: HTTP ${checkRes.status}`);
  const head = ((await checkRes.json()).values?.[0] || []) as string[];
  if (!head.length || !head[4]) {
    const range = head.length ? "E1" : "A1:E1";
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!${range}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [head.length ? ["Role"] : HEADER] }),
      },
    );
    if (!head.length) return [];
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A2:E2000`,
    { headers: auth },
  );
  if (!res.ok) throw new Error(`Không đọc được tab ${USERS_SHEET}: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.values) return [];

  return (data.values as string[][])
    .map((row, i) => ({ row, n: i + 2 }))
    .filter(({ row }) => row[0] && row[1])
    .map(({ row, n }) => ({
      username: (row[0] || "").trim().toLowerCase(),
      password: (row[1] || "").trim(),
      name: (row[2] || "").trim() || row[0],
      active: (row[3] || "yes").trim().toLowerCase() !== "no",
      role: parseRole(row[4]),
      row: n,
    }));
}

/**
 * The Users-sheet username behind a session or connector identity.
 * Accounts without an email get "<username>@ads-gen.internal" as their email.
 */
export function userIdOf(emailOrName: string | null | undefined): string {
  const s = String(emailOrName || "").trim().toLowerCase();
  return s.endsWith(INTERNAL_DOMAIN) ? s.slice(0, -INTERNAL_DOMAIN.length) : s;
}

/* ───────────────────────── passwords ───────────────────────── */

const SCRYPT_PREFIX = "scrypt$";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${SCRYPT_PREFIX}${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

const sha = (s: string) => createHash("sha256").update(s).digest();
const sameText = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));
/** The hash format used before v7.2 (one fixed salt for everyone). Only read, never written. */
const legacySha = (password: string) => createHash("sha256").update(password + "ads-gen-salt-2024").digest("hex");

function checkPassword(stored: string, password: string): { ok: boolean; legacy: boolean } {
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [salt, hash] = stored.slice(SCRYPT_PREFIX.length).split("$");
    if (!salt || !hash) return { ok: false, legacy: false };
    const want = Buffer.from(hash, "base64url");
    const got = scryptSync(password, Buffer.from(salt, "base64url"), want.length || 32);
    return { ok: want.length === got.length && timingSafeEqual(want, got), legacy: false };
  }
  const ok = sameText(stored, password) || sameText(stored, legacySha(password));
  return { ok, legacy: ok };
}

/**
 * Short fingerprint of a stored password cell. It changes whenever the
 * password is changed on the web or reset in the sheet, which is how a
 * session learns that it was signed in with an old password (lib/authOptions.ts).
 */
export function passwordStamp(stored: string): string {
  return createHash("sha256").update(`pw:${stored}`).digest("base64url").slice(0, 16);
}

/** Writes a password hash into column B of one Users row. */
async function writePasswordHash(row: number, hash: string): Promise<boolean> {
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!B${row}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [[hash]] }),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.error("password write:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<{ id: string; name: string; email: string; role: Role; pwStamp: string } | null> {
  const users = await getUsersFromSheet();
  const user = users.find(u => u.username === username.toLowerCase().trim() && u.active);
  if (!user) return null;

  const { ok, legacy } = checkPassword(user.password, password);
  if (!ok) return null;
  // Plain text or the old format: store the scrypt hash instead.
  let stored = user.password;
  if (legacy) {
    const hash = hashPassword(password);
    if (await writePasswordHash(user.row, hash)) stored = hash;
  }

  return {
    id: user.username,
    name: user.name,
    email: user.username.includes("@") ? user.username : `${user.username}${INTERNAL_DOMAIN}`,
    role: user.role,
    pwStamp: passwordStamp(stored),
  };
}

/* ───────────────────────── changing a password on the web ───────────────────────── */

export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/** Why a new password is refused, or null when it is fine. Checked before the current password. */
export function newPasswordProblem(username: string, current: string, next: string): string | null {
  if (next.length < PASSWORD_MIN) return `Mật khẩu mới cần ít nhất ${PASSWORD_MIN} ký tự.`;
  if (next.length > PASSWORD_MAX) return `Mật khẩu mới dài quá ${PASSWORD_MAX} ký tự.`;
  if (next === current) return "Mật khẩu mới phải khác mật khẩu hiện tại.";
  if (next.trim().toLowerCase() === username.trim().toLowerCase()) return "Mật khẩu không được trùng tên đăng nhập.";
  return null;
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "not_found" | "wrong_current" | "write_failed"; message: string };

/** The signed-in person changes their own password: checks the current one, stores the new one as a hash. */
export async function changePassword(username: string, current: string, next: string): Promise<ChangePasswordResult> {
  const problem = newPasswordProblem(username, current, next);
  if (problem) return { ok: false, reason: "invalid", message: problem };
  const users = await getUsersFromSheet();
  const user = users.find(u => u.username === username.trim().toLowerCase() && u.active);
  if (!user) {
    return { ok: false, reason: "not_found", message: "Tài khoản này không có trong sheet Users hoặc đã bị tắt, không đổi mật khẩu trên web được." };
  }
  if (!checkPassword(user.password, current).ok) return { ok: false, reason: "wrong_current", message: "Mật khẩu hiện tại không đúng." };
  if (!(await writePasswordHash(user.row, hashPassword(next)))) {
    return { ok: false, reason: "write_failed", message: "Chưa lưu được mật khẩu mới vào sheet Users. Thử lại sau ít phút." };
  }
  return { ok: true };
}
