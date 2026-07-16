import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  const response = NextResponse.redirect(`${baseUrl}/login`);
  response.cookies.delete("app_session");
  return response;
}
