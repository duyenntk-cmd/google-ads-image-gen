import NextAuth from "next-auth";
import { authOptions } from "@/lib/authOptions";

// authOptions lives in lib/ so route handlers can import it for getServerSession
// without pulling this route module (and NextAuth's handler) in with it.
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
