import KeycloakProvider from "next-auth/providers/keycloak";
import CredentialsProvider from "next-auth/providers/credentials";
import type { NextAuthOptions } from "next-auth";
import { logLoginToSheet } from "@/lib/sheetsLogger";
import { verifyCredentials } from "@/lib/sheetsUsers";
import { accessOf } from "@/lib/userAccess";
import { parseRole } from "@/lib/roles";
import { headers } from "next/headers";

/**
 * How often a live session is checked against the Users sheet. Plus the
 * 1-minute cache in lib/userAccess.ts, a change in the sheet (turned off,
 * password changed or reset, role) reaches the session within 5 minutes.
 * Must stay longer than that cache: the password check trusts only a sheet
 * copy read after the sign-in.
 */
const RECHECK_MS = 4 * 60_000;

async function requestInfo() {
  try {
    const hdrs = await headers();
    return {
      ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "unknown",
      userAgent: hdrs.get("user-agent") || "unknown",
    };
  } catch {
    return { ip: "unknown", userAgent: "unknown" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Tài khoản",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        let user: Awaited<ReturnType<typeof verifyCredentials>> = null;
        let failure = "sai tài khoản/mật khẩu hoặc đã bị tắt";
        try {
          user = await verifyCredentials(credentials.username, credentials.password);
        } catch (e) {
          failure = `lỗi đọc sheet Users: ${e instanceof Error ? e.message : String(e)}`;
        }
        // Failed attempts are logged too: repeated failures on one name are worth seeing.
        if (!user) await logLoginToSheet({ email: credentials.username, name: "", ...(await requestInfo()), result: `thất bại: ${failure}` });
        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.provider = account.provider;
      }
      if (user) {
        token.name = user.name;
        token.email = user.email;
        token.role = parseRole((user as { role?: string }).role);
        token.pwStamp = (user as { pwStamp?: string }).pwStamp;
        token.signedInAt = Date.now();
        token.checkedAt = Date.now();
      }
      // Turning someone off in the Users sheet (Active = no, or deleting the row)
      // ends their session within RECHECK_MS instead of when the 30-day cookie expires.
      // So does a password change on the web or a reset in the sheet: the session
      // remembers a fingerprint of the password cell it signed in with.
      // Role changes are picked up the same way.
      if (!token.revoked && Date.now() - (token.checkedAt ?? 0) > RECHECK_MS) {
        // Sessions from before v7.2 carry no provider; the login page has offered only
        // username/password since 2026-08, so treat those as credentials.
        const keycloak = token.provider === "keycloak";
        const access = await accessOf(keycloak ? token.email : token.sub || token.email);
        if (access) {
          // A Keycloak account need not have a row; only an explicit "no" turns it off.
          const off = access.found ? !access.active : !keycloak;
          // Only a sheet copy read after this sign-in can say the password changed since.
          const pwChanged = Boolean(token.pwStamp) && access.found && access.readAt > (token.signedInAt ?? Infinity) && access.pwStamp !== token.pwStamp;
          if (off || pwChanged) token.revoked = true;
          else if (access.found) token.role = access.role;
        }
        token.checkedAt = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      if (token.revoked) {
        // No user: every API route answers 401 and the page signs out.
        return { expires: session.expires, revoked: true };
      }
      session.accessToken = token.accessToken as string;
      session.role = parseRole(token.role);
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      try {
        await logLoginToSheet({
          email: user.email || "unknown",
          name: user.name || "unknown",
          ...(await requestInfo()),
        });
      } catch {
        // Don't block login if logging fails
      }
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
