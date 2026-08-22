import { createSign, createHash } from "crypto";

const SPREADSHEET_ID = "17KwfmFYVT9DuJIC4o5aRGzGRwKkkipGBXIEl011FONs";
const USERS_SHEET = "Users";

async function getAccessToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(sa.private_key, "base64url");
  const jwt = `${header}.${payload}.${signature}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

export interface SheetUser {
  username: string;
  password: string; // plaintext stored in sheet, compared with hash
  name: string;
  active: boolean;
}

export async function getUsersFromSheet(): Promise<SheetUser[]> {
  const token = await getAccessToken();

  // Ensure header row exists
  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A1:D1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const checkData = await checkRes.json();
  const hasHeader = checkData.values && checkData.values.length > 0;

  if (!hasHeader) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A1:D1?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [["Username", "Password", "Name", "Active"]] }),
      }
    );
    return [];
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A2:D1000`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!data.values) return [];

  return (data.values as string[][])
    .filter(row => row[0] && row[1])
    .map(row => ({
      username: (row[0] || "").trim().toLowerCase(),
      password: (row[1] || "").trim(),
      name: (row[2] || "").trim() || row[0],
      active: (row[3] || "yes").trim().toLowerCase() !== "no",
    }));
}

export function hashPassword(password: string): string {
  return createHash("sha256").update(password + "ads-gen-salt-2024").digest("hex");
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<{ id: string; name: string; email: string } | null> {
  const users = await getUsersFromSheet();
  const user = users.find(u => u.username === username.toLowerCase().trim() && u.active);
  if (!user) return null;

  // Support both plaintext and hashed passwords in sheet
  const passwordMatches =
    user.password === password ||
    user.password === hashPassword(password);
  if (!passwordMatches) return null;

  return {
    id: user.username,
    name: user.name,
    email: user.username.includes("@") ? user.username : `${user.username}@ads-gen.internal`,
  };
}
