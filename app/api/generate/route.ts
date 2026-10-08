import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

// Banner generation is handled client-side via Canvas API
export async function POST() {
  const unauth = await requireSession();
  if (unauth) return unauth;
  return NextResponse.json({ success: false, error: "Use client-side canvas generation" }, { status: 410 });
}
