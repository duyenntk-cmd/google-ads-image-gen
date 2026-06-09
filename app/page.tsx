"use client";

import { useState, useRef, useCallback } from "react";
import { extractFramesFromVideo, fileToBase64, ExtractedFrame } from "@/lib/videoUtils";
import { AD_SIZES } from "@/lib/adSizes";

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

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [niche, setNiche] = useState<"photo"|"tool"|"office">("photo");
  const [videoFile, setVideoFile] = useState<File|null>(null);
  const [iconFile, setIconFile] = useState<File|null>(null);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [extractProgress, setExtractProgress] = useState(0);
  const [brief, setBrief] = useState<Brief>({ app_name:"",headline:"",subheadline:"",cta_text:"",primary_color:"#7B2FBE",secondary_color:"#E91E8C",accent_color:"#FF6B35",background_style:"dark",mood:"bold",best_frame_index:0,niche:"photo",app_store_url:"",play_store_url:"" });
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [zipBase64, setZipBase64] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"top5"|"all">("top5");
  const [selectedPreview, setSelectedPreview] = useState<Preview|null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const handleVideoChange = useCallback(async (file: File) => {
    setVideoFile(file); setError(""); setExtractProgress(10);
    try {
      setExtractProgress(20);
      const extracted = await extractFramesFromVideo(file, 8);
      setFrames(extracted); setExtractProgress(100);
    } catch { setError("Không thể đọc video. Thử file mp4 khác."); setExtractProgress(0); }
  }, []);

  const handleAnalyze = async () => {
    if (!frames.length) return;
    setStep("analyzing"); setError("");
    try {
      const res = await fetch("/api/analyze", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ frames, niche }) });
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
      let iconBase64 = "";
      if (iconFile) iconBase64 = await fileToBase64(iconFile);
      const res = await fetch("/api/generate", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ brief, frames, iconBase64 }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setPreviews(data.previews); setZipBase64(data.zipBase64); setStep("preview");
    } catch(e) { setError(String(e)); setStep("brief"); }
  };

  const handleDownloadAll = () => { const a=document.createElement("a"); a.href=`data:application/zip;base64,${zipBase64}`; a.download=`google-ads-${brief.app_name||"banners"}.zip`; a.click(); };
  const handleDownloadSingle = (p: Preview) => { const a=document.createElement("a"); a.href=p.dataUrl; a.download=`${p.key}.png`; a.click(); };
  const displayedPreviews = activeTab==="top5" ? previews.filter(p=>p.isTop5) : previews;
  const resetAll = () => { setStep("upload"); setPreviews([]); setFrames([]); setVideoFile(null); setIconFile(null); setError(""); setExtractProgress(0); };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-[#F1F5F9]" style={{fontFamily:"Inter,-apple-system,sans-serif"}}>
      {/* Header */}
      <header className="border-b border-[#1E1E2E] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="5" rx="1" fill="white" opacity="0.9"/><rect x="9" y="1" width="6" height="8" rx="1" fill="white" opacity="0.6"/><rect x="1" y="8" width="6" height="7" rx="1" fill="white" opacity="0.6"/><rect x="9" y="11" width="6" height="4" rx="1" fill="white" opacity="0.4"/></svg>
          </div>
          <div>
            <div className="font-semibold text-sm text-white">Google Ads Generator</div>
            <div className="text-xs text-[#64748B]">App Mobile — Photo / Tool / Office</div>
          </div>
        </div>
        {step !== "upload" && <button onClick={resetAll} className="text-xs text-[#64748B] hover:text-white transition-colors px-3 py-1.5 rounded-md border border-[#1E1E2E] hover:border-[#334155]">← Bắt đầu lại</button>}
      </header>

      {/* Progress */}
      <div className="h-0.5 bg-[#111118]">
        <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-500"
          style={{width: step==="upload"?"15%":step==="analyzing"?"40%":step==="brief"?"60%":step==="generating"?"80%":"100%"}}/>
      </div>

      <main className="max-w-4xl mx-auto px-6 py-10">

        {/* UPLOAD */}
        {(step==="upload"||step==="analyzing") && (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">Tạo ảnh Google Ads</h1>
              <p className="text-[#64748B] text-sm">Upload video ads → tự động gen 11 banner PNG cho Google Display Network</p>
            </div>

            {/* Niche */}
            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Ngành app</label>
              <div className="grid grid-cols-3 gap-3">
                {(["photo","tool","office"] as const).map(n => (
                  <button key={n} onClick={()=>setNiche(n)}
                    className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all ${niche===n?"border-violet-500 bg-violet-500/10 text-violet-300":"border-[#1E1E2E] text-[#64748B] hover:border-[#334155] hover:text-[#94A3B8]"}`}>
                    {n==="photo"?"📸 Photo":n==="tool"?"🔧 Tool":"💼 Office"}
                  </button>
                ))}
              </div>
            </div>

            {/* Video upload */}
            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Video ads <span className="text-violet-400">*</span></label>
              <div onClick={()=>videoInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${videoFile?"border-violet-500/50 bg-violet-500/5":"border-[#1E1E2E] hover:border-[#334155] hover:bg-[#111118]"}`}>
                {videoFile ? (
                  <div className="space-y-2">
                    <div className="text-2xl">🎬</div>
                    <div className="text-sm font-medium text-white">{videoFile.name}</div>
                    <div className="text-xs text-[#64748B]">{(videoFile.size/1024/1024).toFixed(1)} MB</div>
                    {extractProgress>0&&extractProgress<100&&<div className="mt-3"><div className="h-1 bg-[#1E1E2E] rounded-full overflow-hidden"><div className="h-full bg-violet-500 transition-all duration-300" style={{width:`${extractProgress}%`}}/></div><div className="text-xs text-[#64748B] mt-1">Đang extract frames...</div></div>}
                    {extractProgress===100&&<div className="text-xs text-emerald-400">✓ Extracted {frames.length} frames</div>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-3xl opacity-40">🎬</div>
                    <div className="text-sm text-[#64748B]">Click để upload video ads</div>
                    <div className="text-xs text-[#475569]">MP4, MOV, AVI, WebM</div>
                  </div>
                )}
                <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={e=>e.target.files?.[0]&&handleVideoChange(e.target.files[0])}/>
              </div>
            </div>

            {/* Icon + Store links */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Icon app <span className="text-[#475569] font-normal normal-case">(tuỳ chọn)</span></label>
                <div onClick={()=>iconInputRef.current?.click()}
                  className={`border border-dashed rounded-xl p-5 text-center cursor-pointer transition-all h-[88px] flex flex-col items-center justify-center gap-1 ${iconFile?"border-violet-500/40 bg-violet-500/5":"border-[#1E1E2E] hover:border-[#334155]"}`}>
                  {iconFile?(<><div className="text-xl">🔷</div><div className="text-xs text-white truncate max-w-[140px]">{iconFile.name}</div></>):(<><div className="text-xl opacity-30">🔷</div><div className="text-xs text-[#475569]">Upload icon PNG/JPG</div></>)}
                  <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={e=>e.target.files?.[0]&&setIconFile(e.target.files[0])}/>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1">Store links <span className="text-[#475569] font-normal normal-case">(tuỳ chọn)</span></label>
                <input type="url" placeholder="🍎 App Store URL" value={brief.app_store_url} onChange={e=>setBrief(p=>({...p,app_store_url:e.target.value}))} className="w-full bg-[#111118] border border-[#1E1E2E] rounded-lg px-3 py-2 text-xs text-[#94A3B8] placeholder-[#334155] focus:outline-none focus:border-violet-500/50 transition-colors"/>
                <input type="url" placeholder="🤖 Google Play URL" value={brief.play_store_url} onChange={e=>setBrief(p=>({...p,play_store_url:e.target.value}))} className="w-full bg-[#111118] border border-[#1E1E2E] rounded-lg px-3 py-2 text-xs text-[#94A3B8] placeholder-[#334155] focus:outline-none focus:border-violet-500/50 transition-colors"/>
              </div>
            </div>

            {error&&<p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-4 py-3">{error}</p>}
            <button onClick={handleAnalyze} disabled={!videoFile||frames.length===0||step==="analyzing"}
              className="w-full py-3.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white">
              {step==="analyzing"?<span className="flex items-center justify-center gap-2"><span className="animate-spin">⏳</span> Đang phân tích video...</span>:"Phân tích video →"}
            </button>
          </div>
        )}

        {/* BRIEF */}
        {step==="brief" && (
          <div className="space-y-8">
            <div><h2 className="text-xl font-bold text-white mb-1">Xem lại & chỉnh brief</h2><p className="text-[#64748B] text-sm">Claude đã phân tích video. Chỉnh bất kỳ mục nào trước khi gen ảnh.</p></div>
            
            {/* Frame selector */}
            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Frame background ({brief.best_frame_index+1}/{frames.length})</label>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {frames.map((f,i)=>(
                  <button key={i} onClick={()=>setBrief(p=>({...p,best_frame_index:i}))}
                    className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${brief.best_frame_index===i?"border-violet-500 scale-105":"border-[#1E1E2E] opacity-60 hover:opacity-100"}`}>
                    <img src={f.dataUrl} alt={`Frame ${i}`} className="w-24 h-14 object-cover"/>
                  </button>
                ))}
              </div>
            </div>

            {/* Text fields */}
            <div className="grid grid-cols-2 gap-4">
              {[{key:"app_name",label:"Tên app",placeholder:"e.g. PhotoPro"},{key:"cta_text",label:"CTA Button",placeholder:"e.g. Try Free"},{key:"headline",label:"Headline",placeholder:"e.g. Edit Photos Like a Pro",full:true},{key:"subheadline",label:"Subheadline",placeholder:"e.g. 100+ Filters & AI Tools",full:true}].map(field=>(
                <div key={field.key} className={field.full?"col-span-2":""}>
                  <label className="block text-xs text-[#64748B] mb-1.5">{field.label}</label>
                  <input type="text" placeholder={field.placeholder} value={(brief as unknown as Record<string,string>)[field.key]||""} onChange={e=>setBrief(p=>({...p,[field.key]:e.target.value}))} className="w-full bg-[#111118] border border-[#1E1E2E] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#334155] focus:outline-none focus:border-violet-500/60 transition-colors"/>
                </div>
              ))}
            </div>

            {/* Colors */}
            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Màu sắc</label>
              <div className="flex gap-6">
                {[{key:"primary_color",label:"Primary"},{key:"secondary_color",label:"Secondary"},{key:"accent_color",label:"Accent (CTA)"}].map(c=>(
                  <div key={c.key} className="flex items-center gap-2">
                    <input type="color" value={(brief as unknown as Record<string,string>)[c.key]||"#7B2FBE"} onChange={e=>setBrief(p=>({...p,[c.key]:e.target.value}))} className="w-8 h-8 rounded cursor-pointer border border-[#1E1E2E]"/>
                    <span className="text-xs text-[#64748B]">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {error&&<p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-4 py-3">{error}</p>}
            <button onClick={handleGenerate} className="w-full py-3.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 transition-all text-white">Gen {AD_SIZES.length} banner PNG →</button>
          </div>
        )}

        {/* GENERATING */}
        {step==="generating" && (
          <div className="text-center py-20 space-y-6">
            <div className="text-5xl animate-pulse">🎨</div>
            <div><h2 className="text-xl font-bold text-white mb-2">Đang tạo {AD_SIZES.length} banner...</h2><p className="text-[#64748B] text-sm">Đang composite ảnh cho tất cả kích thước Google Ads</p></div>
            <div className="w-48 h-1 bg-[#1E1E2E] rounded-full overflow-hidden mx-auto"><div className="h-full bg-violet-500 animate-pulse w-2/3"/></div>
          </div>
        )}

        {/* PREVIEW */}
        {step==="preview" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div><h2 className="text-xl font-bold text-white mb-1">✅ {previews.length} banner đã sẵn sàng</h2><p className="text-[#64748B] text-sm">Click ảnh để xem lớn · hover để download riêng</p></div>
              <button onClick={handleDownloadAll} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 transition-all text-white text-sm font-semibold px-4 py-2.5 rounded-xl">⬇ Tải tất cả (.zip)</button>
            </div>
            <div className="flex gap-1 bg-[#111118] rounded-xl p-1 w-fit">
              {(["top5","all"] as const).map(tab=>(
                <button key={tab} onClick={()=>setActiveTab(tab)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab===tab?"bg-[#1E1E2E] text-white":"text-[#64748B] hover:text-[#94A3B8]"}`}>
                  {tab==="top5"?"⭐ Top 5":`Tất cả (${previews.length})`}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {displayedPreviews.map(p=>{
                const scale=Math.min(1,340/Math.max(p.width,p.height));
                return (
                  <div key={p.key} onClick={()=>setSelectedPreview(p)}
                    className="group bg-[#111118] border border-[#1E1E2E] hover:border-violet-500/40 rounded-xl p-4 cursor-pointer transition-all hover:bg-[#0F0F1A]">
                    <div className="flex items-center justify-center mb-3" style={{height:Math.round(p.height*scale)+16}}>
                      <img src={p.dataUrl} alt={p.label} style={{width:Math.round(p.width*scale),height:Math.round(p.height*scale)}} className="rounded shadow-lg"/>
                    </div>
                    <div className="flex items-center justify-between">
                      <div><div className="text-xs font-semibold text-white">{p.key}</div><div className="text-xs text-[#475569]">{p.label}</div></div>
                      <button onClick={e=>{e.stopPropagation();handleDownloadSingle(p);}} className="opacity-0 group-hover:opacity-100 text-xs bg-[#1E1E2E] hover:bg-violet-600 text-[#94A3B8] hover:text-white px-2 py-1 rounded-lg transition-all">⬇</button>
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
          <div className="bg-[#111118] border border-[#1E1E2E] rounded-2xl p-6 max-w-3xl w-full space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div><div className="font-semibold text-white">{selectedPreview.key} — {selectedPreview.label}</div><div className="text-xs text-[#64748B]">{selectedPreview.width}×{selectedPreview.height}px</div></div>
              <div className="flex gap-2">
                <button onClick={()=>handleDownloadSingle(selectedPreview)} className="bg-violet-600 hover:bg-violet-500 text-white text-sm px-4 py-2 rounded-lg transition-all font-medium">⬇ Download PNG</button>
                <button onClick={()=>setSelectedPreview(null)} className="text-[#64748B] hover:text-white px-3 py-2 rounded-lg transition-colors">✕</button>
              </div>
            </div>
            <div className="flex items-center justify-center bg-[#0A0A0F] rounded-xl p-4 overflow-auto" style={{maxHeight:"60vh"}}>
              <img src={selectedPreview.dataUrl} alt={selectedPreview.label} style={{maxWidth:"100%",maxHeight:"55vh",width:selectedPreview.width>600?"100%":"auto"}} className="rounded"/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
