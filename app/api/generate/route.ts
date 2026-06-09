import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "@vercel/og";
import { AD_SIZES } from "@/lib/adSizes";
import JSZip from "jszip";
import React from "react";

export const runtime = "edge";
export const maxDuration = 60;

interface Brief {
  app_name?: string; headline?: string; subheadline?: string; cta_text?: string;
  primary_color?: string; secondary_color?: string; accent_color?: string;
  best_frame_index?: number; niche?: string;
  app_store_url?: string; play_store_url?: string;
}

const NICHE_DEFAULTS: Record<string, Partial<Brief>> = {
  photo:  { primary_color:"#7B2FBE", secondary_color:"#E91E8C", accent_color:"#FF6B35", headline:"Edit Photos Like a Pro",      subheadline:"100+ Filters & AI Tools",   cta_text:"Edit for Free"    },
  tool:   { primary_color:"#2563EB", secondary_color:"#60A5FA", accent_color:"#059669", headline:"Get More Done in Less Time", subheadline:"Smart tools for every task", cta_text:"Try Free"         },
  office: { primary_color:"#1E3A5F", secondary_color:"#2563EB", accent_color:"#3B82F6", headline:"Work Smarter with Your Team",subheadline:"Documents, Sheets & More",   cta_text:"Start Free Trial" },
};

function BannerLayout({ w, h, brief, bgDataUrl }: {
  w: number; h: number; brief: Brief; bgDataUrl: string | null;
}) {
  const primary = brief.primary_color || "#1A1A2E";
  const secondary = brief.secondary_color || "#7B2FBE";
  const accent = brief.accent_color || "#FF6B35";
  const headline = (brief.headline || "Your App").slice(0, 52);
  const sub = (brief.subheadline || "").slice(0, 60);
  const cta = brief.cta_text || "Try Free";
  const appName = brief.app_name || "";
  const showBadges = !!(brief.app_store_url || brief.play_store_url) && h > 200;
  const isWide = w > h * 3;
  const isTall = !isWide && h > w * 1.5;
  const isTiny = h <= 60;

  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.05));
  const hlSize  = isWide ? Math.max(9, Math.round(h/3.2)) : isTall ? Math.max(13, Math.round(w*0.095)) : Math.max(10, Math.round(h*0.105));
  const subSize = Math.max(8, Math.round(hlSize * 0.65));
  const nameSize= Math.max(9, Math.round(hlSize * 0.7));
  const ctaSize = Math.max(9, Math.min(18, Math.round(hlSize * 0.85)));
  const ctaW    = Math.min(Math.round(w * (isWide ? 0.18 : 0.65)), 180);
  const ctaH    = Math.max(22, Math.min(38, Math.round(h * (isTall ? 0.07 : 0.14))));

  const containerStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", width: w, height: h, position: "relative", overflow: "hidden",
    background: `linear-gradient(${isWide?"to right":"to bottom"}, ${primary}, ${secondary})`,
  };

  const overlayStyle: React.CSSProperties = {
    position: "absolute", inset: 0,
    background: `linear-gradient(to bottom, transparent 0%, ${primary}88 55%, ${primary}ee 100%)`,
  };

  const textShadow = "1px 1px 3px rgba(0,0,0,0.9)";

  if (isWide) {
    return React.createElement("div", { style: containerStyle },
      bgDataUrl && React.createElement("img", { src: bgDataUrl, style: { position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:0.5 } }),
      React.createElement("div", { style: overlayStyle }),
      React.createElement("div", { style: { display:"flex", alignItems:"center", width:"100%", height:"100%", padding:`0 ${pad}px`, gap: Math.round(w*0.04), position:"relative" } },
        appName && React.createElement("div", { style: { fontSize:nameSize, fontWeight:700, color:"white", textShadow, whiteSpace:"nowrap", flexShrink:0 } }, appName),
        React.createElement("div", { style: { fontSize:hlSize, fontWeight:700, color:"white", textShadow, flex:1, overflow:"hidden" } }, headline),
        React.createElement("div", { style: { display:"flex", alignItems:"center", justifyContent:"center", width:ctaW, height:ctaH, background:accent, borderRadius:ctaH/2.5, flexShrink:0 } },
          React.createElement("span", { style: { fontSize:ctaSize, fontWeight:700, color:"white" } }, cta)
        )
      )
    );
  }

  return React.createElement("div", { style: containerStyle },
    bgDataUrl && React.createElement("img", { src: bgDataUrl, style: { position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:0.45 } }),
    React.createElement("div", { style: overlayStyle }),
    React.createElement("div", { style: { display:"flex", flexDirection:"column", width:"100%", height:"100%", padding:`${pad}px`, position:"relative", justifyContent:"flex-end", gap:4 } },
      !isTiny && appName && React.createElement("div", { style: { position:"absolute", top:pad, left:pad, fontSize:nameSize, fontWeight:700, color:"white", textShadow } }, appName),
      React.createElement("div", { style: { fontSize:hlSize, fontWeight:700, color:"white", textShadow, lineHeight:1.2, marginBottom:4 } }, headline),
      !isTiny && sub && h > 150 && React.createElement("div", { style: { fontSize:subSize, color:"#D4D4D8", textShadow, marginBottom:4 } }, sub),
      showBadges && React.createElement("div", { style: { display:"flex", gap:6, marginBottom:6 } },
        brief.app_store_url && React.createElement("div", { style: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", width:100, height:24, background:"rgba(0,0,0,0.75)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:4 } },
          React.createElement("span", { style: { fontSize:7, color:"#aaa" } }, "Download on the"),
          React.createElement("span", { style: { fontSize:9, fontWeight:700, color:"white" } }, "App Store")
        ),
        brief.play_store_url && React.createElement("div", { style: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", width:100, height:24, background:"rgba(0,0,0,0.75)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:4 } },
          React.createElement("span", { style: { fontSize:7, color:"#aaa" } }, "GET IT ON"),
          React.createElement("span", { style: { fontSize:9, fontWeight:700, color:"white" } }, "Google Play")
        )
      ),
      React.createElement("div", { style: { display:"flex", alignItems:"center", justifyContent:"center", width:ctaW, height:ctaH, background:accent, borderRadius:ctaH/2.5, alignSelf:"center" } },
        React.createElement("span", { style: { fontSize:ctaSize, fontWeight:700, color:"white" } }, cta)
      )
    )
  );
}

export async function POST(req: NextRequest) {
  try {
    const { brief: rawBrief, frames } = await req.json();
    const niche = rawBrief.niche || "tool";
    const brief: Brief = { ...NICHE_DEFAULTS[niche] || NICHE_DEFAULTS.tool, ...rawBrief };

    const bestIdx = Math.min(brief.best_frame_index ?? 0, frames.length - 1);
    const bgDataUrl = frames[bestIdx] ? `data:image/jpeg;base64,${frames[bestIdx].base64}` : null;

    const zip = new JSZip();
    const top5Folder = zip.folder("top5")!;
    const allFolder = zip.folder("all_sizes")!;
    const previews: { key: string; width: number; height: number; label: string; isTop5: boolean; dataUrl: string }[] = [];

    for (const size of AD_SIZES) {
      const element = React.createElement(BannerLayout, { w: size.width, h: size.height, brief, bgDataUrl });
      const imgResponse = new ImageResponse(element, { width: size.width, height: size.height });
      const pngBuffer = Buffer.from(await imgResponse.arrayBuffer());

      const filename = `${size.key}.png`;
      if (size.isTop5) top5Folder.file(filename, pngBuffer);
      allFolder.file(filename, pngBuffer);
      previews.push({ key: size.key, width: size.width, height: size.height, label: size.label, isTop5: size.isTop5, dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}` });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return NextResponse.json({ success: true, previews, zipBase64: zipBuffer.toString("base64") });
  } catch (err) {
    console.error("Generate error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };
