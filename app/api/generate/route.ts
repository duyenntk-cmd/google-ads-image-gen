import { NextResponse } from "next/server";

// Banner generation is handled client-side via Canvas API
export async function POST() {
  return NextResponse.json({ success: false, error: "Use client-side canvas generation" }, { status: 410 });
}
