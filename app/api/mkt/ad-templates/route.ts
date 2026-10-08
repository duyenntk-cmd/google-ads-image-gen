import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { requireMkt } from "@/lib/mktSession";
import { validateAdContents, normaliseAdContents, AdContent } from "@/lib/mktClient";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Google ad templates on MKT System.
 *
 * The upstream path is automation-facebook/ad-templates for historical
 * reasons; Google, Facebook and TikTok share it and split on `channel`.
 *
 * Ids travel as a query parameter rather than a path segment so this stays one
 * file — the upstream shape is flat enough that a dynamic segment would buy
 * nothing.
 */
const BASE = "automation-facebook/ad-templates";

function fail(err: unknown) {
  const e = err as Error & { status?: number; body?: unknown };
  if (e?.message === "not_connected") {
    return NextResponse.json({ success: false, error: "not_connected" }, { status: 401 });
  }
  return NextResponse.json(
    { success: false, error: e?.message || "Lỗi MKT System.", detail: e?.body },
    { status: e?.status || 500 },
  );
}

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const mkt = await requireMkt();
    const p = new URL(req.url).searchParams;
    const id = p.get("id");
    if (id) return NextResponse.json({ success: true, template: await mkt.request(`${BASE}/${id}`) });

    const qs = new URLSearchParams({
      channel: "google",
      page: p.get("page") || "1",
      pageSize: p.get("pageSize") || "20",
    });
    if (p.get("search")) qs.set("search", p.get("search")!);
    const list = await mkt.request<{ items?: unknown[]; total?: number }>(`${BASE}?${qs}`);
    return NextResponse.json({ success: true, items: list.items || [], total: list.total || 0 });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const mkt = await requireMkt();
    const { action, id, name, adContents } = await req.json();

    if (action === "duplicate") {
      if (!id) return NextResponse.json({ success: false, error: "Thiếu id." }, { status: 400 });
      return NextResponse.json({ success: true, template: await mkt.request(`${BASE}/${id}/duplicate`, { method: "POST" }) });
    }

    if (!name?.trim()) return NextResponse.json({ success: false, error: "Thiếu tên template." }, { status: 400 });

    const blocks = normaliseAdContents((adContents || []) as AdContent[]);
    // Checked against the campaign-time rule, not the save-time one: the
    // backend accepts a template that later cannot create a campaign, and
    // finding that out at launch is the expensive moment.
    const errors = validateAdContents(blocks);
    if (errors.length) {
      return NextResponse.json({ success: false, error: errors.join("\n") }, { status: 400 });
    }

    // Only the three fields Google uses. format, primaryText, headline,
    // description, callToAction and adTextList belong to Facebook/TikTok.
    const template = await mkt.request(BASE, {
      method: "POST",
      body: { name: name.trim(), channel: "google", adContents: blocks },
    });
    return NextResponse.json({ success: true, template });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const mkt = await requireMkt();
    const { id, name, adContents } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: "Thiếu id." }, { status: 400 });

    // name and channel go on every PATCH, per the integration guide. Omitting
    // adContents leaves the existing blocks alone.
    const body: Record<string, unknown> = { name, channel: "google" };
    if (adContents) {
      const blocks = normaliseAdContents(adContents as AdContent[]);
      const errors = validateAdContents(blocks);
      if (errors.length) return NextResponse.json({ success: false, error: errors.join("\n") }, { status: 400 });
      body.adContents = blocks;
    }
    return NextResponse.json({ success: true, template: await mkt.request(`${BASE}/${id}`, { method: "PATCH", body }) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const mkt = await requireMkt();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ success: false, error: "Thiếu id." }, { status: 400 });
    await mkt.request(`${BASE}/${id}`, { method: "DELETE" });
    return NextResponse.json({ success: true });
  } catch (err) {
    return fail(err);
  }
}
