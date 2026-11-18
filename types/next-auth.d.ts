import "next-auth";
import "next-auth/jwt";
import type { Role } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    /** From the Users sheet's Role column; see lib/roles.ts. */
    role?: Role;
    /** Set when the account was turned off after signing in; the session has no user. */
    revoked?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    idToken?: string;
    provider?: string;
    role?: Role;
    /** Last time the Users sheet was consulted for this session (ms). */
    checkedAt?: number;
    /** When this session signed in (ms). */
    signedInAt?: number;
    /** passwordStamp of the password cell at sign-in; a different one in the sheet means the password changed. */
    pwStamp?: string;
    revoked?: boolean;
  }
}
