"use client";

import { useState, useRef, useCallback } from "react";
import { extractFramesFromVideo, ExtractedFrame } from "@/lib/videoUtils";
import { AD_SIZES } from "@/lib/adSizes";
import { generateAllBanners } from "@/lib/canvasGen";

interface Brief {
  app_name: string; headline: string; subheadline: string; cta_text: string;
  primary_color: string; secondary_color: string; accent_color: string;
  background_style: string; mood: string; best_frame_index: number;
  niche: string; app_store_url: string; play_store_url: string;
}
interface Preview { key: string; width: number; height: number; label: string; isTop5: boolean; dataUrl: string; }
type Step = "upload" | "analyzing" | "brief" | "generating" | "preview";

const NICHE_DEFAULTS: Record<string, Partial<Brief>> = {
  photo:  { primary_color: "#7B2FBE", secondary_color: "#E91E8C", accent_color: "#FF6B35", headline: "Edit Photos Like a Pro",      subheadline: "100+ Filters & AI Tools",   cta_text: "Edit for Free"    },
  tool:   { primary_color: "#2563EB", secondary_color: "#60A5FA", accent_color: "#059669", headline: "Get More Done in Less Time", subheadline: "Smart tools for every task", cta_text: "Try Free"         },
  office: { primary_color: "#1E3A5F", secondary_color: "#2563EB", accent_color: "#3B82F6", headline: "Work Smarter with Your Team",subheadline: "Documents, Sheets & More",   cta_text: "Start Free Trial" },
};

const LANGUAGES = [
  { code: "English",            label: "🇺🇸 English" },
  { code: "Vietnamese",         label: "🇻🇳 Tiếng Việt" },
  { code: "Indonesian",         label: "🇮🇩 Bahasa Indonesia" },
  { code: "Thai",               label: "🇹🇭 ภาษาไทย" },
  { code: "Korean",             label: "🇰🇷 한국어" },
  { code: "Japanese",           label: "🇯🇵 日本語" },
  { code: "Chinese Simplified", label: "🇨🇳 中文简体" },
  { code: "Arabic",             label: "🇸🇦 العربية" },
  { code: "Spanish",            label: "🇪🇸 Español" },
  { code: "Portuguese",         label: "🇧🇷 Português" },
  { code: "Russian",            label: "🇷🇺 Русский" },
  { code: "French",             label: "🇫🇷 Français" },
  { code: "German",             label: "🇩🇪 Deutsch" },
  { code: "Hindi",              label: "🇮🇳 हिन्दी" },
];

const COUNTRIES = [
  { code: "Global",      label: "🌍 Global (Universal)" },
  { code: "Vietnam",     label: "🇻🇳 Vietnam" },
  { code: "Indonesia",   label: "🇮🇩 Indonesia" },
  { code: "Thailand",    label: "🇹🇭 Thailand" },
  { code: "Philippines", label: "🇵🇭 Philippines" },
  { code: "Malaysia",    label: "🇲🇾 Malaysia" },
  { code: "India",       label: "🇮🇳 India" },
  { code: "Japan",       label: "🇯🇵 Japan" },
  { code: "Korea",       label: "🇰🇷 South Korea" },
  { code: "China",       label: "🇨🇳 China" },
  { code: "USA",         label: "🇺🇸 United States" },
  { code: "Brazil",      label: "🇧🇷 Brazil" },
  { code: "Mexico",      label: "🇲🇽 Mexico" },
  { code: "Saudi Arabia",label: "🇸🇦 Saudi Arabia" },
  { code: "Germany",     label: "🇩🇪 Germany" },
  { code: "France",      label: "🇫🇷 France" },
  { code: "Russia",      label: "🇷🇺 Russia" },
];

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [niche, setNiche] = useState<"photo"|"tool"|"office">("photo");
  const [language, setLanguage] = useState("English");
  const [country, setCountry] = useState("Global");
  const [inputMode, setInputMode] = useState<"video"|"image">("video");
  const [videoFile, setVideoFile] = useState<File|null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [iconFile, setIconFile] = useState<File|null>(null);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [extractProgress, setExtractProgress] = useState(0);
  const [brief, setBrief] = useState<Brief>({ app_name:"",headline:"",subheadline:"",cta_text:"",primary_color:"#7B2FBE",secondary_color:"#E91E8C",accent_color:"#FF6B35",background_style:"dark",mood:"bold",best_frame_index:0,niche:"photo",app_store_url:"",play_store_url:"" });
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [zipBase64, setZipBase64] = useState("");
  const [error, setError] = useState("");
  const [inpainting, setInpainting] = useState(false);
  const [activeTab, setActiveTab] = useState<"top5"|"all">("top5");
  const [selectedPreview, setSelectedPreview] = useState<Preview|null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const [bgColor, setBgColor] = useState("#F8FAFC");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSidebarTool, setActiveSidebarTool] = useState<"competitor"|null>(null);
  const [compQuery, setCompQuery] = useState("");
  const [compLoading, setCompLoading] = useState(false);
  const [compResult, setCompResult] = useState<Record<string, unknown> | null>(null);
  const [compError, setCompError] = useState("");
  const [compAppName, setCompAppName] = useState("");
  const [compAppIcon, setCompAppIcon] = useState("");
  const [compNameLoading, setCompNameLoading] = useState(false);
  const PRESETS = [
    { color: "#0A0A0F", label: "Dark" },
    { color: "#0F172A", label: "Navy" },
    { color: "#1A0A2E", label: "Purple" },
    { color: "#0A1628", label: "Ocean" },
    { color: "#ffffff", label: "Light" },
    { color: "#F8FAFC", label: "Gray" },
  ];
  const hexToLuma = (hex: string) => { const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16); return 0.299*r + 0.587*g + 0.114*b; };
  const isDark = hexToLuma(bgColor) < 128;
  const t = {
    text:        isDark ? "#F1F5F9" : "#0F172A",
    textSub:     isDark ? "#94A3B8" : "#475569",
    textMuted:   isDark ? "#64748B" : "#94A3B8",
    border:      isDark ? "#1E1E2E" : "#E2E8F0",
    card:        isDark ? "#111118" : "#FFFFFF",
    cardHover:   isDark ? "#0F0F1A" : "#F1F5F9",
    input:       isDark ? "#111118" : "#FFFFFF",
    inputBorder: isDark ? "#1E1E2E" : "#CBD5E1",
    progress:    isDark ? "#111118" : "#E2E8F0",
    tabBg:       isDark ? "#111118" : "#F1F5F9",
    tabActive:   isDark ? "#1E1E2E" : "#FFFFFF",
    uploadHover: isDark ? "#111118" : "#F8FAFC",
  };

  const handleVideoChange = useCallback(async (file: File) => {
    setVideoFile(file); setError(""); setExtractProgress(10);
    try {
      setExtractProgress(20);
      const extracted = await extractFramesFromVideo(file, 8);
      setFrames(extracted); setExtractProgress(100);
    } catch { setError("Không thể đọc video. Thử file mp4 khác."); setExtractProgress(0); }
  }, []);

  const handleImagesChange = useCallback(async (files: FileList) => {
    const arr = Array.from(files).slice(0, 8);
    setImageFiles(arr); setError(""); setExtractProgress(10);
    try {
      const extracted: ExtractedFrame[] = await Promise.all(arr.map((f, i) => new Promise<ExtractedFrame>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve({ index: i, timestamp: i, dataUrl, base64: dataUrl.split(",")[1] });
        };
        reader.onerror = reject;
        reader.readAsDataURL(f);
      })));
      setFrames(extracted); setExtractProgress(100);
    } catch { setError("Không thể đọc ảnh. Thử file khác."); setExtractProgress(0); }
  }, []);

  const handleInpaint = async () => {
    const idx = brief.best_frame_index;
    if (!frames[idx]) return;
    setInpainting(true); setError("");
    try {
      const res = await fetch("/api/inpaint", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ imageBase64: frames[idx].dataUrl, language, country }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      // Replace the selected frame with the cleaned image
      const newFrames = frames.map((f, i) => i === idx ? { ...f, dataUrl: data.base64, base64: data.base64.split(",")[1] } : f);
      setFrames(newFrames);
    } catch(e) { setError(String(e)); }
    setInpainting(false);
  };

  const compressFrame = (dataUrl: string, maxSize = 512, quality = 0.5): Promise<string> =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.src = dataUrl;
    });

  const handleAnalyze = async () => {
    if (!frames.length) return;
    setStep("analyzing"); setError("");
    try {
      const indices = frames.length <= 4
        ? frames.map((_: unknown, i: number) => i)
        : [0, Math.floor(frames.length * 0.33), Math.floor(frames.length * 0.66), frames.length - 1];
      const selectedFrames = await Promise.all(
        indices.map(async (i: number) => ({ base64: await compressFrame(frames[i].dataUrl) }))
      );
      const res = await fetch("/api/analyze", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ selectedFrames, niche, language, country }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      const defaults = NICHE_DEFAULTS[niche] || {};
      setBrief(prev => ({ ...prev, ...defaults, ...data.brief, niche, app_store_url: prev.app_store_url, play_store_url: prev.play_store_url }));
      setStep("brief");
    } catch(e) { setError(String(e)); setStep("upload"); }
  };

  const handleGenerate = async () => {
    setStep("generating"); setError("");
    try {
      const bestIdx = Math.min(brief.best_frame_index ?? 0, frames.length - 1);
      const bgDataUrl = frames[bestIdx]?.dataUrl || null;
      const generated = await generateAllBanners(brief, bgDataUrl);
      setPreviews(generated);

      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const top5 = zip.folder("top5")!;
      const all = zip.folder("all_sizes")!;
      for (const b of generated) {
        const base64 = b.dataUrl.split(",")[1];
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        if (b.isTop5) top5.file(`${b.key}.png`, bytes);
        all.file(`${b.key}.png`, bytes);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const reader = new FileReader();
      reader.onload = () => setZipBase64((reader.result as string).split(",")[1]);
      reader.readAsDataURL(blob);
      setStep("preview");
    } catch(e) { setError(String(e)); setStep("brief"); }
  };

  const handleDownloadAll = () => { const a=document.createElement("a"); a.href=`data:application/zip;base64,${zipBase64}`; a.download=`google-ads-${brief.app_name||"banners"}.zip`; a.click(); };
  const handleDownloadSingle = (p: Preview) => { const a=document.createElement("a"); a.href=p.dataUrl; a.download=`${p.key}.png`; a.click(); };
  const displayedPreviews = activeTab==="top5" ? previews.filter(p=>p.isTop5) : previews;
  const resetAll = () => { setStep("upload"); setPreviews([]); setFrames([]); setVideoFile(null); setImageFiles([]); setIconFile(null); setError(""); setExtractProgress(0); };

  const inputStyle = { backgroundColor: t.input, borderColor: t.inputBorder, color: t.text };
  const labelStyle = { color: t.textMuted };

  const extractAppName = (url: string): { name: string; iosId?: string; androidPkg?: string } => {
    const iosSlugMatch = url.match(/apps\.apple\.com\/[^/]+\/app\/([^/]+)\/id(\d+)/);
    if (iosSlugMatch) return { name: iosSlugMatch[1].replace(/-/g, " "), iosId: iosSlugMatch[2] };
    const iosIdOnly = url.match(/apps\.apple\.com.*\/id(\d+)/);
    if (iosIdOnly) return { name: "", iosId: iosIdOnly[1] };
    const androidMatch = url.match(/id=([a-zA-Z0-9._]+)/);
    if (androidMatch) {
      const pkg = androidMatch[1];
      const parts = pkg.split(".");
      return { name: parts[parts.length - 1].replace(/_/g, " "), androidPkg: pkg };
    }
    return { name: url.trim() };
  };

  const handleCompetitorSearch = async () => {
    if (!compQuery.trim()) return;
    setCompLoading(true); setCompError("");
    try {
      const { name, iosId, androidPkg } = extractAppName(compQuery.trim());
      let finalName = name;

      if (iosId) {
        try {
          const res = await fetch(`https://itunes.apple.com/lookup?id=${iosId}`);
          const data = await res.json();
          if (data.results?.[0]?.trackName) finalName = data.results[0].trackName;
        } catch { /* dùng tên từ URL */ }
      } else if (androidPkg) {
        try {
          const res = await fetch("/api/app-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: androidPkg }) });
          const data = await res.json();
          if (data.name) finalName = data.name;
        } catch { /* dùng tên từ package */ }
      }

      if (!finalName || finalName.length < 3) {
        finalName = androidPkg?.split(".").pop()?.replace(/_/g, " ") || compQuery.trim();
      }
      const transparencyUrl = `https://adstransparency.google.com/advertiser/search?query=${encodeURIComponent(finalName)}`;
      window.open(transparencyUrl, "_blank");
    } catch { setCompError("Không thể tra cứu tên app."); }
    finally { setCompLoading(false); }
  };

  const lookupAppNamePreview = async (url: string) => {
    const { name, iosId, androidPkg } = extractAppName(url);
    setCompAppName(name); setCompAppIcon("");
    if (!iosId && !androidPkg) return;
    setCompNameLoading(true);
    try {
      if (iosId) {
        const res = await fetch(`https://itunes.apple.com/lookup?id=${iosId}`);
        const data = await res.json();
        const app = data.results?.[0];
        if (app?.trackName) { setCompAppName(app.trackName); setCompAppIcon(app.artworkUrl60 || ""); }
      } else if (androidPkg) {
        const res = await fetch("/api/app-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: androidPkg }) });
        const data = await res.json();
        if (data.name) setCompAppName(data.name);
      }
    } catch { /* giữ tên từ URL */ }
    finally { setCompNameLoading(false); }
  };

  // Helper to render competitor creatives — unused now but kept for future
  const renderCompResult = () => {
    if (!compResult) return null;
    const creatives = (compResult.creatives as { creatives?: unknown[] } | null)?.creatives || [];
    const details = compResult.details as { name?: string; icon_url?: string; publisher_name?: string; global_rating_count?: number } | null;
    const network = compResult.network as { data?: { date: string; networks: { name: string; sov: number }[] }[] } | null;
    return (
      <div className="space-y-4 mt-4">
        {details && (
          <div className="flex items-center gap-3 p-3 rounded-xl border" style={{borderColor: t.border, backgroundColor: t.card}}>
            {details.icon_url && <img src={details.icon_url} alt="" className="w-10 h-10 rounded-xl"/>}
            <div>
              <div className="font-semibold text-sm" style={{color: t.text}}>{details.name}</div>
              <div className="text-xs" style={{color: t.textMuted}}>{details.publisher_name}</div>
              {details.global_rating_count && <div className="text-xs" style={{color: t.textMuted}}>⭐ {Number(details.global_rating_count).toLocaleString()} ratings</div>}
            </div>
          </div>
        )}
        {network?.data && network.data.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{color: t.textMuted}}>Ad Networks (Share of Voice)</div>
            {network.data.slice(-1)[0]?.networks?.slice(0,5).map((n: {name:string;sov:number}, i: number) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <div className="text-xs w-24 truncate" style={{color: t.textSub}}>{n.name}</div>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{backgroundColor: t.progress}}>
                  <div className="h-full bg-violet-500 rounded-full" style={{width:`${Math.min(n.sov*100,100)}%`}}/>
                </div>
                <div className="text-xs w-10 text-right" style={{color: t.textMuted}}>{(n.sov*100).toFixed(1)}%</div>
              </div>
            ))}
          </div>
        )}
        {creatives.length > 0 ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{color: t.textMuted}}>{creatives.length} Ad Creatives</div>
            <div className="grid grid-cols-2 gap-2">
              {(creatives as Array<{preview_url?:string;ad_type?:string;first_seen_date?:string;last_seen_date?:string;impression_share?:number}>).slice(0,6).map((c, i) => (
                <div key={i} className="rounded-xl overflow-hidden border" style={{borderColor: t.border}}>
                  {c.preview_url ? (
                    <img src={c.preview_url} alt="" className="w-full aspect-video object-cover"/>
                  ) : (
                    <div className="w-full aspect-video flex items-center justify-center text-xs" style={{backgroundColor: t.tabBg, color: t.textMuted}}>No preview</div>
                  )}
                  <div className="p-2 space-y-0.5" style={{backgroundColor: t.card}}>
                    <div className="text-xs font-medium capitalize" style={{color: t.text}}>{c.ad_type || "Display"}</div>
                    {c.first_seen_date && <div className="text-xs" style={{color: t.textMuted}}>First: {c.first_seen_date}</div>}
                    {c.last_seen_date && <div className="text-xs" style={{color: t.textMuted}}>Last: {c.last_seen_date}</div>}
                    {c.impression_share !== undefined && <div className="text-xs" style={{color: t.textMuted}}>SOV: {(c.impression_share*100).toFixed(1)}%</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-center py-4" style={{color: t.textMuted}}>Không có dữ liệu ad creatives<br/>(Cần SensorTower Ad Intelligence plan)</div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex" style={{fontFamily:"Inter,-apple-system,sans-serif", backgroundColor: bgColor, color: t.text}}>

      {/* Left Sidebar */}
      <aside className="fixed top-0 left-0 h-full z-40 flex">
        {/* Icon rail */}
        <div className="flex flex-col items-center py-4 gap-2 border-r w-14" style={{backgroundColor: t.card, borderColor: t.border}}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center mb-4">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="5" rx="1" fill="white" opacity="0.9"/><rect x="9" y="1" width="6" height="8" rx="1" fill="white" opacity="0.6"/><rect x="1" y="8" width="6" height="7" rx="1" fill="white" opacity="0.6"/><rect x="9" y="11" width="6" height="4" rx="1" fill="white" opacity="0.4"/></svg>
          </div>
          <button title="Competitor Ads" onClick={() => { setActiveSidebarTool("competitor"); setSidebarOpen(true); }}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all border"
            style={activeSidebarTool==="competitor"&&sidebarOpen ? {backgroundColor:"#7C3AED22",borderColor:"#7C3AED",color:"#A78BFA"} : {backgroundColor:"transparent",borderColor:"transparent",color:t.textMuted}}>
            🔍
          </button>
        </div>

        {/* Slide-out panel */}
        {sidebarOpen && activeSidebarTool === "competitor" && (
          <div className="h-full w-80 border-r overflow-y-auto flex flex-col" style={{backgroundColor: bgColor, borderColor: t.border}}>
            <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 z-10" style={{backgroundColor: bgColor, borderColor: t.border}}>
              <div>
                <div className="text-sm font-semibold" style={{color: t.text}}>🔍 Competitor Ads</div>
                <div className="text-xs" style={{color: t.textMuted}}>Tra cứu quảng cáo đối thủ</div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="text-lg leading-none" style={{color: t.textMuted}}>✕</button>
            </div>
            <div className="p-4 flex-1">
              <div className="text-xs mb-2" style={{color: t.textMuted}}>Nhập link App Store hoặc Play Store</div>
              <input value={compQuery} onChange={e => {
                const val = e.target.value;
                setCompQuery(val); setCompAppName(""); setCompAppIcon("");
                if (val.trim().startsWith("http")) lookupAppNamePreview(val.trim());
              }}
                placeholder="https://apps.apple.com/..."
                className="w-full text-xs rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500"
                style={inputStyle}/>

              {/* App name preview */}
              {compQuery.trim().startsWith("http") && (
                <div className="mt-2 flex items-center gap-2 px-1">
                  {compNameLoading ? (
                    <span className="text-xs" style={{color: t.textMuted}}>⏳ Đang nhận diện app...</span>
                  ) : compAppName ? (
                    <>
                      {compAppIcon && <img src={compAppIcon} alt="" className="w-7 h-7 rounded-lg flex-shrink-0"/>}
                      <span className="text-xs font-semibold truncate" style={{color: t.text}}>{compAppName}</span>
                    </>
                  ) : null}
                </div>
              )}

              {compQuery.trim() && (
                <div className="mt-3 p-3 rounded-xl border" style={{borderColor: t.border, backgroundColor: t.card}}>
                  <button onClick={handleCompetitorSearch} disabled={compLoading || compNameLoading}
                    className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs py-2 px-3 rounded-lg transition-all font-medium flex items-center justify-center gap-2">
                    {compLoading ? <><span>⏳</span> Đang mở...</> : <>🔎 Xem quảng cáo trên Google</>}
                  </button>
                  <div className="text-xs mt-2 text-center" style={{color: t.textMuted}}>Mở Google Ads Transparency Center</div>
                </div>
              )}
              <div className="mt-6 space-y-2">
                <div className="text-xs font-semibold" style={{color: t.textMuted}}>Ví dụ</div>
                {["https://apps.apple.com/us/app/canva/id897446215","https://play.google.com/store/apps/details?id=com.canva.editor"].map(ex => (
                  <button key={ex} onClick={() => setCompQuery(ex)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors"
                    style={{borderColor: t.border, color: t.textMuted}}>
                    {ex.includes("apple") ? "🍎" : "🤖"} {ex.includes("apple") ? "App Store link" : "Play Store link"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main content — push right when sidebar open */}
      <div className="flex-1 flex flex-col transition-all" style={{marginLeft: sidebarOpen ? "calc(3.5rem + 20rem)" : "3.5rem"}}>

      {/* Header */}
      <header className="border-b px-6 py-4 flex items-center justify-between" style={{borderColor: t.border}}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="5" rx="1" fill="white" opacity="0.9"/><rect x="9" y="1" width="6" height="8" rx="1" fill="white" opacity="0.6"/><rect x="1" y="8" width="6" height="7" rx="1" fill="white" opacity="0.6"/><rect x="9" y="11" width="6" height="4" rx="1" fill="white" opacity="0.4"/></svg>
          </div>
          <div>
            <div className="font-semibold text-sm" style={{color: t.text}}>Google Ads Generator</div>
            <div className="text-xs" style={{color: t.textMuted}}>App Mobile — Photo / Tool / Office</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {PRESETS.map(p => (
              <button key={p.color} onClick={() => setBgColor(p.color)} title={p.label}
                className={`w-5 h-5 rounded-full border-2 transition-all ${bgColor === p.color ? "border-violet-400 scale-110" : "border-transparent opacity-60 hover:opacity-100"}`}
                style={{backgroundColor: p.color, boxShadow: p.color === "#ffffff" || p.color === "#F8FAFC" ? "inset 0 0 0 1px rgba(0,0,0,0.15)" : undefined}}/>
            ))}
            <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
              className="w-5 h-5 rounded-full cursor-pointer border-0 p-0 opacity-60 hover:opacity-100" title="Tuỳ chỉnh màu"/>
          </div>
          {step !== "upload" && (
            <div className="flex items-center gap-2">
              <button onClick={() => {
                if (step === "preview") setStep("brief");
                else if (step === "brief") setStep("upload");
                else if (step === "analyzing") setStep("upload");
              }}
                className="text-xs px-3 py-1.5 rounded-md border transition-colors"
                style={{color: t.textMuted, borderColor: t.border}}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = t.text; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = t.textMuted; }}>
                ← Back
              </button>
              <button onClick={resetAll}
                className="text-xs px-3 py-1.5 rounded-md border transition-colors"
                style={{color: t.textMuted, borderColor: t.border}}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = t.text; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = t.textMuted; }}>
                🏠 Home
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Progress bar */}
      <div className="h-0.5" style={{backgroundColor: t.progress}}>
        <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-500"
          style={{width: step==="upload"?"15%":step==="analyzing"?"40%":step==="brief"?"60%":step==="generating"?"80%":"100%"}}/>
      </div>

      <main className="max-w-4xl mx-auto px-6 py-10">

        {/* UPLOAD */}
        {(step==="upload"||step==="analyzing") && (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{color: t.text}}>Tạo ảnh Google Ads</h1>
              <p className="text-sm" style={{color: t.textMuted}}>Upload video hoặc ảnh → tự động gen {AD_SIZES.length} banner PNG cho Google UAC App Install</p>
            </div>

            {/* Niche */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={labelStyle}>Ngành app</label>
              <div className="grid grid-cols-3 gap-3">
                {(["photo","tool","office"] as const).map(n => (
                  <button key={n} onClick={()=>setNiche(n)}
                    className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all ${niche===n?"border-violet-500 bg-violet-500/10 text-violet-400":""}`}
                    style={niche===n ? {} : {borderColor: t.border, color: t.textMuted}}>
                    {n==="photo"?"📸 Photo":n==="tool"?"🔧 Tool":"💼 Office"}
                  </button>
                ))}
              </div>
            </div>

            {/* Language + Country */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={labelStyle}>
                  🌐 Ngôn ngữ text trong ảnh
                </label>
                <select value={language} onChange={e => setLanguage(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500 transition-colors"
                  style={{...inputStyle, borderColor: t.inputBorder}}>
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <p className="text-xs mt-1.5" style={{color: t.textMuted}}>Headline, subheadline, CTA sẽ được viết bằng ngôn ngữ này</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={labelStyle}>
                  🎯 Thị trường mục tiêu
                </label>
                <select value={country} onChange={e => setCountry(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500 transition-colors"
                  style={{...inputStyle, borderColor: t.inputBorder}}>
                  {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
                <p className="text-xs mt-1.5" style={{color: t.textMuted}}>AI điều chỉnh màu sắc, tone & style phù hợp thị trường</p>
              </div>
            </div>

            {/* Input mode + upload */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-semibold uppercase tracking-wider" style={labelStyle}>
                  Nguồn ảnh <span className="text-violet-400">*</span>
                </label>
                <div className="flex gap-1 rounded-lg p-0.5" style={{backgroundColor: t.tabBg}}>
                  {([["video","🎬 Video"],["image","🖼️ Ảnh tĩnh"]] as const).map(([mode, label])=>(
                    <button key={mode} onClick={()=>{setInputMode(mode);setFrames([]);setVideoFile(null);setImageFiles([]);setExtractProgress(0);}}
                      className="px-3 py-1 rounded-md text-xs font-medium transition-all"
                      style={inputMode===mode?{backgroundColor:t.tabActive,color:t.text}:{color:t.textMuted}}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {inputMode === "video" ? (
                <div onClick={()=>videoInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${videoFile?"border-violet-500/50 bg-violet-500/5":""}`}
                  style={videoFile ? {} : {borderColor: t.border}}
                  onMouseEnter={e => { if (!videoFile) (e.currentTarget as HTMLDivElement).style.backgroundColor = t.uploadHover; }}
                  onMouseLeave={e => { if (!videoFile) (e.currentTarget as HTMLDivElement).style.backgroundColor = ""; }}>
                  {videoFile ? (
                    <div className="space-y-2">
                      <div className="text-2xl">🎬</div>
                      <div className="text-sm font-medium" style={{color: t.text}}>{videoFile.name}</div>
                      <div className="text-xs" style={{color: t.textMuted}}>{(videoFile.size/1024/1024).toFixed(1)} MB</div>
                      {extractProgress>0&&extractProgress<100&&(
                        <div className="mt-3">
                          <div className="h-1 rounded-full overflow-hidden" style={{backgroundColor: t.border}}>
                            <div className="h-full bg-violet-500 transition-all duration-300" style={{width:`${extractProgress}%`}}/>
                          </div>
                          <div className="text-xs mt-1" style={{color: t.textMuted}}>Đang extract frames...</div>
                        </div>
                      )}
                      {extractProgress===100&&<div className="text-xs text-emerald-500">✓ Extracted {frames.length} frames</div>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-3xl opacity-40">🎬</div>
                      <div className="text-sm" style={{color: t.textMuted}}>Click để upload video ads</div>
                      <div className="text-xs" style={{color: t.textMuted, opacity: 0.7}}>MP4, MOV, AVI, WebM</div>
                    </div>
                  )}
                  <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={e=>e.target.files?.[0]&&handleVideoChange(e.target.files[0])}/>
                </div>
              ) : (
                <div onClick={()=>imageInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${imageFiles.length?"border-violet-500/50 bg-violet-500/5":""}`}
                  style={imageFiles.length ? {} : {borderColor: t.border}}
                  onMouseEnter={e => { if (!imageFiles.length) (e.currentTarget as HTMLDivElement).style.backgroundColor = t.uploadHover; }}
                  onMouseLeave={e => { if (!imageFiles.length) (e.currentTarget as HTMLDivElement).style.backgroundColor = ""; }}>
                  {imageFiles.length ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2 justify-center">
                        {frames.map((f,i)=>(
                          <img key={i} src={f.dataUrl} alt={`img${i}`} className="w-16 h-16 object-cover rounded-lg border" style={{borderColor:t.border}}/>
                        ))}
                      </div>
                      <div className="text-xs text-emerald-500">✓ {imageFiles.length} ảnh đã tải lên</div>
                      <div className="text-xs" style={{color: t.textMuted}}>Click để thay đổi</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-3xl opacity-40">🖼️</div>
                      <div className="text-sm" style={{color: t.textMuted}}>Click để upload 1–8 ảnh</div>
                      <div className="text-xs" style={{color: t.textMuted, opacity: 0.7}}>PNG, JPG, WebP</div>
                    </div>
                  )}
                  <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>e.target.files&&e.target.files.length>0&&handleImagesChange(e.target.files)}/>
                </div>
              )}
            </div>

            {/* Icon + Store links */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={labelStyle}>
                  Icon app <span className="font-normal normal-case" style={{color: t.textMuted}}>(tuỳ chọn)</span>
                </label>
                <div onClick={()=>iconInputRef.current?.click()}
                  className={`border border-dashed rounded-xl p-5 text-center cursor-pointer transition-all h-[88px] flex flex-col items-center justify-center gap-1 ${iconFile?"border-violet-500/40 bg-violet-500/5":""}`}
                  style={iconFile ? {} : {borderColor: t.border}}>
                  {iconFile ? (
                    <><div className="text-xl">🔷</div><div className="text-xs truncate max-w-[140px]" style={{color: t.text}}>{iconFile.name}</div></>
                  ) : (
                    <><div className="text-xl opacity-30">🔷</div><div className="text-xs" style={{color: t.textMuted}}>Upload icon PNG/JPG</div></>
                  )}
                  <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={e=>e.target.files?.[0]&&setIconFile(e.target.files[0])}/>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={labelStyle}>
                  Store links <span className="font-normal normal-case" style={{color: t.textMuted}}>(tuỳ chọn)</span>
                </label>
                <input type="url" placeholder="🍎 App Store URL" value={brief.app_store_url} onChange={e=>setBrief(p=>({...p,app_store_url:e.target.value}))}
                  className="w-full rounded-lg px-3 py-2 text-xs border focus:outline-none focus:border-violet-500/50 transition-colors" style={inputStyle}/>
                <input type="url" placeholder="🤖 Google Play URL" value={brief.play_store_url} onChange={e=>setBrief(p=>({...p,play_store_url:e.target.value}))}
                  className="w-full rounded-lg px-3 py-2 text-xs border focus:outline-none focus:border-violet-500/50 transition-colors" style={inputStyle}/>
              </div>
            </div>

            {error&&<p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-4 py-3">{error}</p>}
            <button onClick={handleAnalyze} disabled={frames.length===0||step==="analyzing"}
              className="w-full py-3.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white">
              {step==="analyzing"?<span className="flex items-center justify-center gap-2"><span className="animate-spin">⏳</span> Đang phân tích...</span>:"Phân tích & tạo brief →"}
            </button>
          </div>
        )}

        {/* BRIEF */}
        {step==="brief" && (
          <div className="space-y-8">
            <div>
              <h2 className="text-xl font-bold mb-1" style={{color: t.text}}>Xem lại & chỉnh brief</h2>
              <p className="text-sm" style={{color: t.textMuted}}>Claude đã phân tích. Chỉnh bất kỳ mục nào trước khi gen ảnh.</p>
            </div>

            {/* Frame selector */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-semibold uppercase tracking-wider" style={labelStyle}>
                  Frame background ({brief.best_frame_index+1}/{frames.length})
                </label>
                <button onClick={handleInpaint} disabled={inpainting}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all disabled:opacity-40"
                  style={{borderColor:"rgba(139,92,246,0.5)", color:"#a78bfa", backgroundColor:"rgba(139,92,246,0.08)"}}
                  title="Dùng AI xóa text gốc trong ảnh (OpenAI)">
                  {inpainting ? <><span className="animate-spin">⏳</span> Đang xử lý...</> : <>✨ Xóa text gốc (AI)</>}
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {frames.map((f,i)=>(
                  <button key={i} onClick={()=>setBrief(p=>({...p,best_frame_index:i}))}
                    className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${brief.best_frame_index===i?"border-violet-500 scale-105":""}`}
                    style={brief.best_frame_index===i ? {} : {borderColor: t.border, opacity: 0.6}}>
                    <img src={f.dataUrl} alt={`Frame ${i}`} className="w-24 h-14 object-cover"/>
                  </button>
                ))}
              </div>
              <p className="text-xs mt-2" style={{color: t.textMuted}}>Chọn frame → click "Xóa text gốc" để AI xóa text trong ảnh đó (~$0.04)</p>
            </div>

            {/* Text fields */}
            <div className="grid grid-cols-2 gap-4">
              {[{key:"app_name",label:"Tên app",placeholder:"e.g. PhotoPro"},{key:"cta_text",label:"CTA Button",placeholder:"e.g. Try Free"},{key:"headline",label:"Headline",placeholder:"e.g. Edit Photos Like a Pro",full:true},{key:"subheadline",label:"Subheadline",placeholder:"e.g. 100+ Filters & AI Tools",full:true}].map(field=>(
                <div key={field.key} className={field.full?"col-span-2":""}>
                  <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>{field.label}</label>
                  <input type="text" placeholder={field.placeholder}
                    value={(brief as unknown as Record<string,string>)[field.key]||""}
                    onChange={e=>setBrief(p=>({...p,[field.key]:e.target.value}))}
                    className="w-full rounded-lg px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500/60 transition-colors"
                    style={inputStyle}/>
                </div>
              ))}
            </div>

            {/* Colors */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={labelStyle}>Màu sắc</label>
              <div className="flex gap-6">
                {[{key:"primary_color",label:"Primary"},{key:"secondary_color",label:"Secondary"},{key:"accent_color",label:"Accent (CTA)"}].map(c=>(
                  <div key={c.key} className="flex items-center gap-2">
                    <input type="color" value={(brief as unknown as Record<string,string>)[c.key]||"#7B2FBE"} onChange={e=>setBrief(p=>({...p,[c.key]:e.target.value}))}
                      className="w-8 h-8 rounded cursor-pointer border" style={{borderColor: t.border}}/>
                    <span className="text-xs" style={{color: t.textMuted}}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {error&&<p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-4 py-3">{error}</p>}
            <button onClick={handleGenerate} className="w-full py-3.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 transition-all text-white">
              Gen {AD_SIZES.length} banner PNG →
            </button>
          </div>
        )}

        {/* GENERATING */}
        {step==="generating" && (
          <div className="text-center py-20 space-y-6">
            <div className="text-5xl animate-pulse">🎨</div>
            <div>
              <h2 className="text-xl font-bold mb-2" style={{color: t.text}}>Đang tạo {AD_SIZES.length} banner...</h2>
              <p className="text-sm" style={{color: t.textMuted}}>Đang composite ảnh cho tất cả kích thước Google Ads</p>
            </div>
            <div className="w-48 h-1 rounded-full overflow-hidden mx-auto" style={{backgroundColor: t.border}}>
              <div className="h-full bg-violet-500 animate-pulse w-2/3"/>
            </div>
          </div>
        )}

        {/* PREVIEW */}
        {step==="preview" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold mb-1" style={{color: t.text}}>✅ {previews.length} banner đã sẵn sàng</h2>
                <p className="text-sm" style={{color: t.textMuted}}>Click ảnh để xem lớn · hover để download riêng</p>
              </div>
              <button onClick={handleDownloadAll} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 transition-all text-white text-sm font-semibold px-4 py-2.5 rounded-xl">
                ⬇ Tải tất cả (.zip)
              </button>
            </div>
            <div className="flex gap-1 rounded-xl p-1 w-fit" style={{backgroundColor: t.tabBg}}>
              {(["top5","all"] as const).map(tab=>(
                <button key={tab} onClick={()=>setActiveTab(tab)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={activeTab===tab ? {backgroundColor: t.tabActive, color: t.text} : {color: t.textMuted}}>
                  {tab==="top5"?"⭐ Top 5":`Tất cả (${previews.length})`}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {displayedPreviews.map(p=>{
                const scale=Math.min(1,340/Math.max(p.width,p.height));
                return (
                  <div key={p.key} onClick={()=>setSelectedPreview(p)}
                    className="group rounded-xl p-4 cursor-pointer transition-all border"
                    style={{backgroundColor: t.card, borderColor: t.border}}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = t.cardHover; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(139,92,246,0.4)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = t.card; (e.currentTarget as HTMLDivElement).style.borderColor = t.border; }}>
                    <div className="flex items-center justify-center mb-3" style={{height:Math.round(p.height*scale)+16}}>
                      <img src={p.dataUrl} alt={p.label} style={{width:Math.round(p.width*scale),height:Math.round(p.height*scale)}} className="rounded shadow-lg"/>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold" style={{color: t.text}}>{p.key}</div>
                        <div className="text-xs" style={{color: t.textMuted}}>{p.label}</div>
                      </div>
                      <button onClick={e=>{e.stopPropagation();handleDownloadSingle(p);}}
                        className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded-lg transition-all hover:bg-violet-600 hover:text-white"
                        style={{backgroundColor: t.tabBg, color: t.textSub}}>
                        ⬇
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Lightbox */}
      {selectedPreview && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={()=>setSelectedPreview(null)}>
          <div className="rounded-2xl p-6 max-w-3xl w-full space-y-4 border" style={{backgroundColor: t.card, borderColor: t.border}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold" style={{color: t.text}}>{selectedPreview.key} — {selectedPreview.label}</div>
                <div className="text-xs" style={{color: t.textMuted}}>{selectedPreview.width}×{selectedPreview.height}px</div>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>handleDownloadSingle(selectedPreview)} className="bg-violet-600 hover:bg-violet-500 text-white text-sm px-4 py-2 rounded-lg transition-all font-medium">⬇ Download PNG</button>
                <button onClick={()=>setSelectedPreview(null)} className="px-3 py-2 rounded-lg transition-colors" style={{color: t.textMuted}}>✕</button>
              </div>
            </div>
            <div className="flex items-center justify-center rounded-xl p-4 overflow-auto" style={{backgroundColor: isDark ? "#0A0A0F" : "#F1F5F9", maxHeight:"60vh"}}>
              <img src={selectedPreview.dataUrl} alt={selectedPreview.label} style={{maxWidth:"100%",maxHeight:"55vh",width:selectedPreview.width>600?"100%":"auto"}} className="rounded"/>
            </div>
          </div>
        </div>
      )}
      </div>{/* end main content */}
    </div>
  );
}
