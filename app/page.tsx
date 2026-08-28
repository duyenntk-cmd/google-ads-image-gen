"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { extractFramesFromVideo, ExtractedFrame } from "@/lib/videoUtils";
import { AD_SIZES } from "@/lib/adSizes";
import { generateAllBanners } from "@/lib/canvasGen";

interface Brief {
  app_name: string; headline: string; subheadline: string; cta_text: string;
  primary_color: string; secondary_color: string; accent_color: string;
  background_style: string; mood: string; best_frame_index: number;
  niche: string; app_store_url: string; play_store_url: string;
  subject_position?: string; text_zone?: string;
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
  { code: "Bengali",            label: "🇧🇩 বাংলা" },
  { code: "Filipino",           label: "🇵🇭 Filipino" },
  { code: "Malay",              label: "🇲🇾 Bahasa Melayu" },
];

const COUNTRY_DEFAULT_LANG: Record<string, string> = {
  Vietnam: "Vietnamese", Indonesia: "Indonesian", Thailand: "Thai",
  Philippines: "Filipino", Malaysia: "Malay", Singapore: "English",
  Myanmar: "English", Cambodia: "English",
  Japan: "Japanese", "South Korea": "Korean", China: "Chinese Simplified",
  Taiwan: "Chinese Simplified", "Hong Kong": "Chinese Simplified",
  India: "Hindi", Pakistan: "English", Bangladesh: "Bengali", "Sri Lanka": "English",
  "Saudi Arabia": "Arabic", UAE: "Arabic", Egypt: "Arabic", Turkey: "English",
  Israel: "English", Iraq: "Arabic",
  USA: "English", Canada: "English", Mexico: "Spanish",
  Brazil: "Portuguese", Argentina: "Spanish", Colombia: "Spanish",
  Chile: "Spanish", Peru: "Spanish",
  Germany: "German", France: "French", "United Kingdom": "English",
  Italy: "English", Spain: "Spanish", Netherlands: "English",
  Poland: "English", Sweden: "English", Norway: "English",
  Denmark: "English", Finland: "English", Belgium: "French",
  Switzerland: "German", Austria: "German", Portugal: "Portuguese",
  Greece: "English", Ukraine: "English", Russia: "Russian",
  Australia: "English", "New Zealand": "English",
  Nigeria: "English", "South Africa": "English", Kenya: "English",
  Ethiopia: "English", Ghana: "English",
};

const COUNTRIES = [
  { code: "Global",           label: "🌍 Global (Universal)" },
  // Southeast Asia
  { code: "Vietnam",          label: "🇻🇳 Vietnam" },
  { code: "Indonesia",        label: "🇮🇩 Indonesia" },
  { code: "Thailand",         label: "🇹🇭 Thailand" },
  { code: "Philippines",      label: "🇵🇭 Philippines" },
  { code: "Malaysia",         label: "🇲🇾 Malaysia" },
  { code: "Singapore",        label: "🇸🇬 Singapore" },
  { code: "Myanmar",          label: "🇲🇲 Myanmar" },
  { code: "Cambodia",         label: "🇰🇭 Cambodia" },
  // East Asia
  { code: "Japan",            label: "🇯🇵 Japan" },
  { code: "South Korea",      label: "🇰🇷 South Korea" },
  { code: "China",            label: "🇨🇳 China" },
  { code: "Taiwan",           label: "🇹🇼 Taiwan" },
  { code: "Hong Kong",        label: "🇭🇰 Hong Kong" },
  // South Asia
  { code: "India",            label: "🇮🇳 India" },
  { code: "Pakistan",         label: "🇵🇰 Pakistan" },
  { code: "Bangladesh",       label: "🇧🇩 Bangladesh" },
  { code: "Sri Lanka",        label: "🇱🇰 Sri Lanka" },
  // Middle East
  { code: "Saudi Arabia",     label: "🇸🇦 Saudi Arabia" },
  { code: "UAE",              label: "🇦🇪 UAE" },
  { code: "Egypt",            label: "🇪🇬 Egypt" },
  { code: "Turkey",           label: "🇹🇷 Turkey" },
  { code: "Israel",           label: "🇮🇱 Israel" },
  { code: "Iraq",             label: "🇮🇶 Iraq" },
  // North America
  { code: "USA",              label: "🇺🇸 United States" },
  { code: "Canada",           label: "🇨🇦 Canada" },
  { code: "Mexico",           label: "🇲🇽 Mexico" },
  // Latin America
  { code: "Brazil",           label: "🇧🇷 Brazil" },
  { code: "Argentina",        label: "🇦🇷 Argentina" },
  { code: "Colombia",         label: "🇨🇴 Colombia" },
  { code: "Chile",            label: "🇨🇱 Chile" },
  { code: "Peru",             label: "🇵🇪 Peru" },
  // Europe
  { code: "Germany",          label: "🇩🇪 Germany" },
  { code: "France",           label: "🇫🇷 France" },
  { code: "United Kingdom",   label: "🇬🇧 United Kingdom" },
  { code: "Italy",            label: "🇮🇹 Italy" },
  { code: "Spain",            label: "🇪🇸 Spain" },
  { code: "Netherlands",      label: "🇳🇱 Netherlands" },
  { code: "Poland",           label: "🇵🇱 Poland" },
  { code: "Sweden",           label: "🇸🇪 Sweden" },
  { code: "Norway",           label: "🇳🇴 Norway" },
  { code: "Denmark",          label: "🇩🇰 Denmark" },
  { code: "Finland",          label: "🇫🇮 Finland" },
  { code: "Belgium",          label: "🇧🇪 Belgium" },
  { code: "Switzerland",      label: "🇨🇭 Switzerland" },
  { code: "Austria",          label: "🇦🇹 Austria" },
  { code: "Portugal",         label: "🇵🇹 Portugal" },
  { code: "Greece",           label: "🇬🇷 Greece" },
  { code: "Ukraine",          label: "🇺🇦 Ukraine" },
  { code: "Russia",           label: "🇷🇺 Russia" },
  // Oceania
  { code: "Australia",        label: "🇦🇺 Australia" },
  { code: "New Zealand",      label: "🇳🇿 New Zealand" },
  // Africa
  { code: "Nigeria",          label: "🇳🇬 Nigeria" },
  { code: "South Africa",     label: "🇿🇦 South Africa" },
  { code: "Kenya",            label: "🇰🇪 Kenya" },
  { code: "Ethiopia",         label: "🇪🇹 Ethiopia" },
  { code: "Ghana",            label: "🇬🇭 Ghana" },
];

export default function Home() {
  const { data: session } = useSession();
  const [step, setStep] = useState<Step>("upload");
  const [niche, setNiche] = useState<"photo"|"tool"|"office">("photo");
  const [language, setLanguage] = useState("English");
  const [country, setCountry] = useState("Global");
  const [inputMode, setInputMode] = useState<"video"|"image">("video");
  const [videoFile, setVideoFile] = useState<File|null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [iconFile, setIconFile] = useState<File|null>(null);
  const [iconDataUrlFetched, setIconDataUrlFetched] = useState<string|null>(null);
  const [iconFetching, setIconFetching] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [suggestResult, setSuggestResult] = useState<any>(null);
  const [lightboxFrame, setLightboxFrame] = useState<string|null>(null);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [extractProgress, setExtractProgress] = useState(0);
  const [brief, setBrief] = useState<Brief>({ app_name:"",headline:"",subheadline:"",cta_text:"",primary_color:"#7B2FBE",secondary_color:"#E91E8C",accent_color:"#FF6B35",background_style:"dark",mood:"bold",best_frame_index:0,niche:"photo",app_store_url:"",play_store_url:"" });
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [zipBase64, setZipBase64] = useState("");
  const [error, setError] = useState("");
  const [inpainting, setInpainting] = useState(false);
  const [activeTab, setActiveTab] = useState<"top5"|"all"|"device">("top5");
  const [deviceType, setDeviceType] = useState<"phone"|"tablet">("phone");
  const [devicePreviewIndex, setDevicePreviewIndex] = useState(0);
  const [selectedPreview, setSelectedPreview] = useState<Preview|null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const [darkMode, setDarkMode] = useState(false);
  const bgColor = darkMode ? "#0A0A0F" : "#F8FAFC";
  // kept for compatibility but no longer used
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSidebarTool, setActiveSidebarTool] = useState<"competitor"|"history"|"adcopy"|null>(null);
  void sidebarOpen; void setSidebarOpen; void activeSidebarTool; void setActiveSidebarTool;

  const [activePage, setActivePage] = useState<"home"|"generate"|"adcopy"|"competitor"|"history"|"youtube"|"keywords"|"autogen"|"localize"|"launch">("home");

  // YouTube upload state
  const [ytAuthenticated, setYtAuthenticated] = useState(false);
  const [ytAccessToken, setYtAccessToken] = useState("");
  interface YtVideo { file: File; title: string; description: string; tags: string; privacy: "public"|"unlisted"|"private"; status: "idle"|"uploading"|"done"|"error"; progress: number; errorMsg: string; videoId?: string; }
  const [ytVideos, setYtVideos] = useState<YtVideo[]>([]);
  const [ytUploading, setYtUploading] = useState(false);
  const [ytCopiedIndex, setYtCopiedIndex] = useState<number|null>(null);
  const ytFileRef = useRef<HTMLInputElement>(null);

  const checkYtAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/token");
      if (res.ok) { const d = await res.json(); if (d.access_token) { setYtAccessToken(d.access_token); setYtAuthenticated(true); } }
    } catch {}
  }, []);

  useEffect(() => { checkYtAuth(); }, [checkYtAuth]);

  // Handle OAuth redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yt_ok")) { setActivePage("youtube"); checkYtAuth(); window.history.replaceState({}, "", "/"); }
    if (params.get("page") === "youtube") { setActivePage("youtube"); window.history.replaceState({}, "", "/"); }
  }, [checkYtAuth]);

  const addYtFiles = (files: FileList) => {
    const newVids: YtVideo[] = Array.from(files).map(f => ({
      file: f, title: f.name.replace(/\.[^.]+$/, ""), description: "", tags: "", privacy: "unlisted",
      status: "idle", progress: 0, errorMsg: "",
    }));
    setYtVideos(prev => [...prev, ...newVids]);
  };

  const uploadSingleVideo = async (video: YtVideo, index: number, token: string): Promise<void> => {
    setYtVideos(prev => prev.map((v, i) => i === index ? {...v, status: "uploading", progress: 0} : v));
    try {
      const metadata = {
        snippet: { title: video.title || video.file.name, description: video.description, tags: video.tags ? video.tags.split(",").map(t=>t.trim()) : [] },
        status: { privacyStatus: video.privacy },
      };
      // 1. Init resumable upload
      const initRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "X-Upload-Content-Type": video.file.type, "X-Upload-Content-Length": String(video.file.size) },
        body: JSON.stringify(metadata),
      });
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
      const uploadUrl = initRes.headers.get("Location");
      if (!uploadUrl) throw new Error("No upload URL");

      // 2. Upload in chunks
      const CHUNK = 5 * 1024 * 1024; // 5MB
      let offset = 0;
      while (offset < video.file.size) {
        const chunk = video.file.slice(offset, offset + CHUNK);
        const end = Math.min(offset + CHUNK - 1, video.file.size - 1);
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${offset}-${end}/${video.file.size}`, "Content-Type": video.file.type },
          body: chunk,
        });
        if (uploadRes.status === 308) {
          const range = uploadRes.headers.get("Range");
          offset = range ? parseInt(range.split("-")[1]) + 1 : offset + CHUNK;
        } else if (uploadRes.ok || uploadRes.status === 201 || uploadRes.status === 200) {
          const resData = await uploadRes.json().catch(() => ({}));
          const vid = resData?.id;
          setYtVideos(prev => prev.map((v, i) => i === index ? {...v, videoId: vid || undefined} : v));
          offset = video.file.size;
        } else {
          throw new Error(`Upload chunk failed: ${uploadRes.status}`);
        }
        const pct = Math.round((Math.min(offset, video.file.size) / video.file.size) * 100);
        setYtVideos(prev => prev.map((v, i) => i === index ? {...v, progress: pct} : v));
      }
      setYtVideos(prev => prev.map((v, i) => i === index ? {...v, status: "done", progress: 100} : v));
    } catch (e) {
      setYtVideos(prev => prev.map((v, i) => i === index ? {...v, status: "error", errorMsg: String(e)} : v));
    }
  };

  const handleYtUploadAll = async () => {
    if (!ytAccessToken) return;
    setYtUploading(true);
    for (let i = 0; i < ytVideos.length; i++) {
      if (ytVideos[i].status === "idle" || ytVideos[i].status === "error") {
        await uploadSingleVideo(ytVideos[i], i, ytAccessToken);
      }
    }
    setYtUploading(false);
  };

  const ytLogout = async () => {
    await fetch("/api/auth/token", { method: "DELETE" });
    setYtAuthenticated(false); setYtAccessToken(""); setYtVideos([]);
  };

  // Auto Gen from URL state
  type AutoGenStep = "input" | "analyzing" | "brief" | "generating" | "preview";
  const [agStep, setAgStep] = useState<AutoGenStep>("input");
  const [agUrl, setAgUrl] = useState("");
  const [agKeywords, setAgKeywords] = useState("");
  const [agCountry, setAgCountry] = useState("Global");
  const [agLang, setAgLang] = useState("English");
  const [agNiche, setAgNiche] = useState<"photo"|"tool"|"office">("tool");
  const [agCountrySearch, setAgCountrySearch] = useState("");
  const [agCountryOpen, setAgCountryOpen] = useState(false);
  const agCountryRef = useRef<HTMLDivElement>(null);
  const [agLangSearch, setAgLangSearch] = useState("");
  const [agLangOpen, setAgLangOpen] = useState(false);
  const agLangRef = useRef<HTMLDivElement>(null);
  const [agError, setAgError] = useState("");
  const [agBrief, setAgBrief] = useState<Brief|null>(null);
  const [agScreenshot, setAgScreenshot] = useState<string|null>(null);
  const [agIcon, setAgIcon] = useState<string|null>(null);
  interface AgAppMeta { name: string; category: string; rating: number; ratingCount: number; platform: string; screenshotCount: number; }
  const [agAppMeta, setAgAppMeta] = useState<AgAppMeta|null>(null);
  const [agPreviews, setAgPreviews] = useState<Preview[]>([]);
  const [agZipBase64, setAgZipBase64] = useState("");
  const [agActiveTab, setAgActiveTab] = useState<"top5"|"all">("top5");

  // Google Ads Launch state
  const [adsConnected, setAdsConnected] = useState<boolean|null>(null);
  const [adsAccounts, setAdsAccounts] = useState<{id:string;name:string;currency:string;status:string}[]>([]);
  const [adsSelectedAccount, setAdsSelectedAccount] = useState("");
  const [adsCampaignName, setAdsCampaignName] = useState("");
  const [adsAppId, setAdsAppId] = useState("");
  const [adsAppStore, setAdsAppStore] = useState<"GOOGLE_APP_STORE"|"APPLE_APP_STORE">("GOOGLE_APP_STORE");
  const [adsBudget, setAdsBudget] = useState("200000");
  const [adsHeadlines, setAdsHeadlines] = useState(["","",""]);
  const [adsDescriptions, setAdsDescriptions] = useState(["",""]);
  const [adsSelectedBanners, setAdsSelectedBanners] = useState<string[]>([]);
  const [adsLaunching, setAdsLaunching] = useState(false);
  const [adsResult, setAdsResult] = useState<{success:boolean;message?:string;error?:string}|null>(null);
  const [adsCampaigns, setAdsCampaigns] = useState<{id:string;name:string;status:string;budgetPerDay:number}[]>([]);
  const [adsAccountsError, setAdsAccountsError] = useState<string|null>(null);
  const [adsAccountsLoading, setAdsAccountsLoading] = useState(false);

  const checkAdsConnection = async () => {
    try {
      const res = await fetch("/api/google-ads/auth?action=status");
      if (!res.ok) { setAdsConnected(false); return; }
      const data = await res.json();
      setAdsConnected(data.connected);
      if (data.connected) loadAdsAccounts();
    } catch { setAdsConnected(false); }
  };

  const loadAdsAccounts = async () => {
    setAdsAccountsLoading(true);
    setAdsAccountsError(null);
    try {
      const res = await fetch("/api/google-ads/accounts");
      const text = await res.text();
      let data: {success:boolean;accounts?:{id:string;name:string;currency:string;status:string}[];error?:string};
      try { data = JSON.parse(text); } catch { throw new Error(`Server returned HTML (middleware issue). Status: ${res.status}`); }
      if (data.success) setAdsAccounts(data.accounts || []);
      else setAdsAccountsError(data.error || "Unknown error");
    } catch(e) { setAdsAccountsError(String(e)); }
    setAdsAccountsLoading(false);
  };

  const loadAdsCampaigns = async (customerId: string) => {
    const res = await fetch(`/api/google-ads/campaigns?customerId=${customerId}`);
    const data = await res.json();
    if (data.success) setAdsCampaigns(data.campaigns || []);
  };

  const handleAdsLaunch = async () => {
    if (!adsSelectedAccount || !adsCampaignName || !adsAppId) return;
    setAdsLaunching(true); setAdsResult(null);
    try {
      const res = await fetch("/api/google-ads/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: adsSelectedAccount,
          campaignName: adsCampaignName,
          appId: adsAppId,
          appStore: adsAppStore,
          budgetPerDayVnd: parseInt(adsBudget) || 200000,
          headlines: adsHeadlines.filter(Boolean),
          descriptions: adsDescriptions.filter(Boolean),
          imageDataUrls: adsSelectedBanners,
        }),
      });
      const data = await res.json();
      setAdsResult(data);
      if (data.success) loadAdsCampaigns(adsSelectedAccount);
    } catch (e) { setAdsResult({ success: false, error: String(e) }); }
    setAdsLaunching(false);
  };

  const handleAgAnalyze = async () => {
    if (!agUrl.trim()) return;
    setAgStep("analyzing"); setAgError("");
    try {
      const res = await fetch("/api/autogen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appUrl: agUrl, keywords: agKeywords, country: agCountry, language: agLang, niche: agNiche }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAgBrief(data.brief);
      setAgScreenshot(data.screenshotBase64 || null);
      setAgIcon(data.iconBase64 || null);
      setAgAppMeta(data.appMeta);
      setAgStep("brief");
    } catch (e) { setAgError(String(e)); setAgStep("input"); }
  };

  const handleAgGenerate = async () => {
    if (!agBrief) return;
    setAgStep("generating"); setAgError("");
    try {
      const generated = await generateAllBanners(agBrief, agScreenshot || null, undefined, agIcon || null);
      setAgPreviews(generated);
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
      reader.onload = () => setAgZipBase64((reader.result as string).split(",")[1]);
      reader.readAsDataURL(blob);
      setAgStep("preview");
    } catch (e) { setAgError(String(e)); setAgStep("brief"); }
  };

  const handleAgDownloadAll = () => { const a = document.createElement("a"); a.href = `data:application/zip;base64,${agZipBase64}`; a.download = `google-ads-${agBrief?.app_name||"banners"}.zip`; a.click(); };
  const agDisplayed = agActiveTab === "top5" ? agPreviews.filter(p => p.isTop5) : agPreviews;
  const resetAg = () => { setAgStep("input"); setAgPreviews([]); setAgBrief(null); setAgScreenshot(null); setAgError(""); };

  // Keyword Research state
  const [kwAppName, setKwAppName] = useState("");
  const [kwAppUrl, setKwAppUrl] = useState("");
  const [kwCountry, setKwCountry] = useState("Global");
  const [kwLang, setKwLang] = useState("English");
  const [kwCountrySearch, setKwCountrySearch] = useState("");
  const [kwCountryOpen, setKwCountryOpen] = useState(false);
  const kwCountryRef = useRef<HTMLDivElement>(null);
  const [kwLangSearch, setKwLangSearch] = useState("");
  const [kwLangOpen, setKwLangOpen] = useState(false);
  const kwLangRef = useRef<HTMLDivElement>(null);
  const [kwLoading, setKwLoading] = useState(false);
  const [kwError, setKwError] = useState("");
  interface KwItem { keyword: string; monthly_searches: string; competition: "Low"|"Medium"|"High"; competition_index: number; cpc_min: number; cpc_max: number; relevance: number; intent: string; }
  interface KwResult { app_name: string; keywords: KwItem[]; }
  const [kwResult, setKwResult] = useState<KwResult|null>(null);
  const [kwSort, setKwSort] = useState<"relevance"|"competition_index"|"cpc_max">("relevance");
  const [kwCopied, setKwCopied] = useState(false);

  const handleKwGenerate = async () => {
    if (!kwAppName.trim() && !kwAppUrl.trim()) return;
    setKwLoading(true); setKwError(""); setKwResult(null);
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: kwAppName, appUrl: kwAppUrl, country: kwCountry, language: kwLang }),
      });
      const data = await res.json();
      if (data.success) setKwResult(data.result);
      else setKwError(data.error || "Lỗi không xác định");
    } catch (e) { setKwError(String(e)); }
    finally { setKwLoading(false); }
  };

  const copyKwList = () => {
    if (!kwResult) return;
    const sorted = [...kwResult.keywords].sort((a, b) => {
      if (kwSort === "relevance") return b.relevance - a.relevance;
      if (kwSort === "competition_index") return a.competition_index - b.competition_index;
      return b.cpc_max - a.cpc_max;
    });
    const text = sorted.map(k => k.keyword).join("\n");
    navigator.clipboard.writeText(text);
    setKwCopied(true);
    setTimeout(() => setKwCopied(false), 2000);
  };

  // Ad Copy Generator state
  const [adcopyAppName, setAdcopyAppName] = useState("");
  const [adcopyMessage, setAdcopyMessage] = useState("");
  const [adcopyCountry, setAdcopyCountry] = useState("Global");
  const [adcopyLang, setAdcopyLang] = useState("English");
  const [adcopyCountrySearch, setAdcopyCountrySearch] = useState("");
  const [adcopyCountryOpen, setAdcopyCountryOpen] = useState(false);
  const adcopyCountryRef = useRef<HTMLDivElement>(null);
  const [adcopyLangSearch, setAdcopyLangSearch] = useState("");
  const [adcopyLangOpen, setAdcopyLangOpen] = useState(false);
  const adcopyLangRef = useRef<HTMLDivElement>(null);
  const [adcopyLoading, setAdcopyLoading] = useState(false);
  interface AdCopyResult { headlines: string[]; descriptions: string[]; ctas: string[]; }
  const [adcopyResult, setAdcopyResult] = useState<AdCopyResult|null>(null);
  const [adcopyCopied, setAdcopyCopied] = useState<string|null>(null);

  // Localize state
  const LOCALIZE_MARKETS = [
    { code: "VN", name: "Vietnam",      flag: "🇻🇳" },
    { code: "ID", name: "Indonesia",    flag: "🇮🇩" },
    { code: "TH", name: "Thailand",     flag: "🇹🇭" },
    { code: "PH", name: "Philippines",  flag: "🇵🇭" },
    { code: "MY", name: "Malaysia",     flag: "🇲🇾" },
    { code: "SG", name: "Singapore",    flag: "🇸🇬" },
    { code: "KR", name: "South Korea",  flag: "🇰🇷" },
    { code: "JP", name: "Japan",        flag: "🇯🇵" },
    { code: "TW", name: "Taiwan",       flag: "🇹🇼" },
    { code: "CN", name: "China",        flag: "🇨🇳" },
    { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
    { code: "BD", name: "Bangladesh",   flag: "🇧🇩" },
    { code: "BR", name: "Brazil",       flag: "🇧🇷" },
    { code: "DE", name: "Germany",      flag: "🇩🇪" },
    { code: "FR", name: "France",       flag: "🇫🇷" },
    { code: "ES", name: "Spain",        flag: "🇪🇸" },
    { code: "US", name: "United States",flag: "🇺🇸" },
    { code: "IN", name: "India",        flag: "🇮🇳" },
  ];
  interface LocalizeMarketResult { code: string; name: string; language: string; flag: string; headlines: string[]; descriptions: string[]; ctas: string[]; }
  const [lcAppName, setLcAppName] = useState("");
  const [lcHeadlines, setLcHeadlines] = useState("Download now and explore\nBoost your productivity\nTry it free today");
  const [lcDescriptions, setLcDescriptions] = useState("The best app for your daily tasks\nMillions of users trust us every day");
  const [lcCtas, setLcCtas] = useState("Install Free\nDownload Now\nGet Started");
  const [lcSourceLang, setLcSourceLang] = useState("English");
  const [lcMarkets, setLcMarkets] = useState<string[]>(["VN","ID","TH","PH","MY","SG","US"]);
  const [lcLoading, setLcLoading] = useState(false);
  const [lcResults, setLcResults] = useState<LocalizeMarketResult[]|null>(null);
  const [lcError, setLcError] = useState("");
  const [lcCopied, setLcCopied] = useState<string|null>(null);
  const [lcActiveMarket, setLcActiveMarket] = useState<string|null>(null);

  const lcToggleMarket = (code: string) => {
    setLcMarkets(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };
  const lcSelectAll = () => setLcMarkets(LOCALIZE_MARKETS.map(m => m.code));
  const lcSelectNone = () => setLcMarkets([]);

  const lcCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setLcCopied(key);
    setTimeout(() => setLcCopied(null), 2000);
  };

  const lcCopyAllForMarket = (market: LocalizeMarketResult) => {
    const lines = [
      `=== ${market.flag} ${market.name} (${market.language}) ===`,
      "--- Headlines ---",
      ...market.headlines.map((h, i) => `${i+1}. ${h}`),
      "--- Descriptions ---",
      ...market.descriptions.map((d, i) => `${i+1}. ${d}`),
      "--- CTAs ---",
      ...market.ctas.map((c, i) => `${i+1}. ${c}`),
    ].join("\n");
    navigator.clipboard.writeText(lines);
    setLcCopied(`all-${market.code}`);
    setTimeout(() => setLcCopied(null), 2000);
  };

  const lcCopyAll = () => {
    if (!lcResults) return;
    const text = lcResults.map(m => [
      `=== ${m.flag} ${m.name} (${m.language}) ===`,
      "Headlines: " + m.headlines.join(" | "),
      "Descriptions: " + m.descriptions.join(" | "),
      "CTAs: " + m.ctas.join(" | "),
    ].join("\n")).join("\n\n");
    navigator.clipboard.writeText(text);
    setLcCopied("all");
    setTimeout(() => setLcCopied(null), 2000);
  };

  const handleLocalize = async () => {
    if (!lcAppName.trim()) return;
    setLcLoading(true);
    setLcError("");
    setLcResults(null);
    try {
      const res = await fetch("/api/localize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: lcAppName,
          headlines: lcHeadlines.split("\n").map(s => s.trim()).filter(Boolean),
          descriptions: lcDescriptions.split("\n").map(s => s.trim()).filter(Boolean),
          ctas: lcCtas.split("\n").map(s => s.trim()).filter(Boolean),
          markets: lcMarkets,
          sourceLanguage: lcSourceLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setLcResults(data.results);
      if (data.results?.length > 0) setLcActiveMarket(data.results[0].code);
    } catch (e: unknown) {
      setLcError(e instanceof Error ? e.message : "Translation failed");
    } finally {
      setLcLoading(false);
    }
  };

  const handleAdCopyGenerate = async () => {
    if (!adcopyAppName.trim()) return;
    setAdcopyLoading(true); setAdcopyResult(null);
    try {
      const res = await fetch("/api/adcopy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: adcopyAppName, message: adcopyMessage, country: adcopyCountry, language: adcopyLang }),
      });
      const data = await res.json();
      if (data.success) setAdcopyResult(data.result);
    } catch { /* silent */ }
    finally { setAdcopyLoading(false); }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setAdcopyCopied(text);
    setTimeout(() => setAdcopyCopied(null), 1500);
  };

  interface HistoryItem { id: string; appName: string; date: string; thumbnail: string; count: number; }
  const [history, setHistory] = useState<HistoryItem[]>([]);
  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem("banner_history") || "[]")); } catch {}
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_ads_connected") === "1") {
      setActivePage("launch");
      checkAdsConnection();
      // Clean up URL
      window.history.replaceState({}, "", "/");
    }
  }, []);
  const saveHistory = (item: HistoryItem) => {
    setHistory(prev => {
      const next = [item, ...prev].slice(0, 20);
      try {
        // Compress thumbnail to small size before saving
        const canvas = document.createElement("canvas");
        const img = new Image(); img.src = item.thumbnail;
        canvas.width = 120; canvas.height = 63;
        const ctx = canvas.getContext("2d");
        img.onload = () => {
          ctx?.drawImage(img, 0, 0, 120, 63);
          const smallThumb = canvas.toDataURL("image/jpeg", 0.5);
          const compressed = next.map((h, i) => i === 0 ? {...h, thumbnail: smallThumb} : h);
          localStorage.setItem("banner_history", JSON.stringify(compressed));
          setHistory(compressed);
        };
        img.src = item.thumbnail;
      } catch {}
      return next;
    });
  };
  const deleteHistory = (id: string) => {
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id);
      try { localStorage.setItem("banner_history", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const [compQuery, setCompQuery] = useState("");
  const [compLoading, setCompLoading] = useState(false);
  const [compResult, setCompResult] = useState<Record<string, unknown> | null>(null);
  const [compError, setCompError] = useState("");
  const [compAppName, setCompAppName] = useState("");
  const [compAppIcon, setCompAppIcon] = useState("");
  const [compNameLoading, setCompNameLoading] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [countryOpen, setCountryOpen] = useState(false);
  const countryRef = useRef<HTMLDivElement>(null);
  const [langSearch, setLangSearch] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const isDark = darkMode;
  const t = {
    text:        isDark ? "#F1F5F9" : "#0F172A",
    textSub:     isDark ? "#94A3B8" : "#475569",
    textMuted:   isDark ? "#64748B" : "#94A3B8",
    border:      isDark ? "#1E293B" : "#E2E8F0",
    card:        isDark ? "#0F1117" : "#FFFFFF",
    cardHover:   isDark ? "#161B27" : "#F8FAFC",
    input:       isDark ? "#0F1117" : "#FFFFFF",
    inputBorder: isDark ? "#1E293B" : "#CBD5E1",
    progress:    isDark ? "#1E293B" : "#E2E8F0",
    tabBg:       isDark ? "#161B27" : "#F1F5F9",
    tabActive:   isDark ? "#1E293B" : "#FFFFFF",
    uploadHover: isDark ? "#161B27" : "#F8FAFC",
    cardShadow:  isDark ? "0 4px 24px rgba(0,0,0,0.4)" : "0 4px 24px rgba(109,40,217,0.07)",
    cardShadowHover: isDark ? "0 8px 40px rgba(0,0,0,0.5)" : "0 8px 40px rgba(109,40,217,0.13)",
    gradientOrb1: isDark ? "rgba(109,40,217,0.15)" : "rgba(139,92,246,0.08)",
    gradientOrb2: isDark ? "rgba(236,72,153,0.08)" : "rgba(236,72,153,0.05)",
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
      const prevUrl = brief.app_store_url || brief.play_store_url;
      setBrief(prev => ({ ...prev, ...defaults, ...data.brief, niche, app_store_url: prev.app_store_url, play_store_url: prev.play_store_url }));
      setStep("brief");
      // Auto-fetch app name from store URL if AI didn't get it
      if (!data.brief?.app_name && prevUrl) {
        try {
          const iconRes = await fetch("/api/fetch-icon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: prevUrl }) });
          const iconData = await iconRes.json();
          if (iconData.appName) setBrief(p => ({ ...p, app_name: p.app_name || iconData.appName }));
          if (iconData.iconDataUrl) setIconDataUrlFetched(iconData.iconDataUrl);
        } catch { /* ignore */ }
      }
    } catch(e) { setError(String(e)); setStep("upload"); }
  };

  const handleFetchIcon = async (url: string) => {
    if (!url) return;
    setIconFetching(true);
    try {
      const res = await fetch("/api/fetch-icon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await res.json();
      if (data.iconDataUrl) {
        setIconDataUrlFetched(data.iconDataUrl);
        if (data.appName && !brief.app_name) setBrief(p => ({ ...p, app_name: data.appName }));
      }
    } catch { /* ignore */ }
    setIconFetching(false);
  };

  const handleGenerate = async () => {
    setStep("generating"); setError("");
    try {
      const bestIdx = Math.min(brief.best_frame_index ?? 0, frames.length - 1);
      const bgDataUrl = frames[bestIdx]?.dataUrl || null;
      const allFrameDataUrls = frames.map((f: { dataUrl: string }) => f.dataUrl);
      let iconDataUrl: string | null = iconDataUrlFetched || null;
      if (!iconDataUrl && iconFile) {
        iconDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(iconFile);
        });
      }
      const generated = await generateAllBanners(brief, bgDataUrl, allFrameDataUrls, iconDataUrl);
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
      reader.onload = () => {
        const zip64 = (reader.result as string).split(",")[1];
        setZipBase64(zip64);
        const thumbnail = generated.find(p => p.isTop5)?.dataUrl || generated[0]?.dataUrl || "";
        saveHistory({ id: Date.now().toString(), appName: brief.app_name || "Untitled", date: new Date().toLocaleString("vi-VN"), thumbnail, count: generated.length });
      };
      reader.readAsDataURL(blob);
      setStep("preview");
    } catch(e) { setError(String(e)); setStep("brief"); }
  };

  const handleDownloadAll = () => { const a=document.createElement("a"); a.href=`data:application/zip;base64,${zipBase64}`; a.download=`google-ads-${brief.app_name||"banners"}.zip`; a.click(); };
  const handleDownloadSingle = (p: Preview) => { const a=document.createElement("a"); a.href=p.dataUrl; a.download=`${p.key}.png`; a.click(); };
  const displayedPreviews = activeTab==="top5" ? previews.filter(p=>p.isTop5) : previews;
  const resetAll = () => { setStep("upload"); setPreviews([]); setFrames([]); setVideoFile(null); setImageFiles([]); setIconFile(null); setError(""); setExtractProgress(0); };

  const inputStyle = { backgroundColor: t.input, borderColor: t.inputBorder, color: t.text, transition: "border-color 0.15s, box-shadow 0.15s" };
  const labelStyle = { color: t.textMuted };
  const cardStyle = { backgroundColor: t.card, borderColor: t.border, boxShadow: t.cardShadow, borderRadius: 16 };
  const cardStyleHover = { backgroundColor: t.card, borderColor: t.border, boxShadow: t.cardShadowHover, borderRadius: 16 };
  void cardStyleHover;

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
      const transparencyUrl = `https://adstransparency.google.com/?region=anywhere&query=${encodeURIComponent(finalName)}`;
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
  void renderCompResult; void compError; void compResult;

  return (
    <div className="min-h-screen flex relative" style={{fontFamily:"Inter,-apple-system,sans-serif", backgroundColor: bgColor, color: t.text}}>
      {/* Gradient orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{zIndex:0}}>
        <div style={{position:"absolute",top:"-10%",right:"5%",width:600,height:600,borderRadius:"50%",background:`radial-gradient(circle, ${t.gradientOrb1} 0%, transparent 70%)`,filter:"blur(40px)"}}/>
        <div style={{position:"absolute",bottom:"10%",left:"10%",width:400,height:400,borderRadius:"50%",background:`radial-gradient(circle, ${t.gradientOrb2} 0%, transparent 70%)`,filter:"blur(40px)"}}/>
      </div>
      <div className="min-h-screen flex w-full relative" style={{zIndex:1}}>

      {/* Fixed Sidebar */}
      <aside className="fixed top-0 left-0 h-full z-40 flex flex-col border-r" style={{width:200, backgroundColor: t.card, borderColor: t.border}}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{borderColor: t.border}}>
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center flex-shrink-0">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="5" rx="1" fill="white" opacity="0.9"/><rect x="9" y="1" width="6" height="8" rx="1" fill="white" opacity="0.6"/><rect x="1" y="8" width="6" height="7" rx="1" fill="white" opacity="0.6"/><rect x="9" y="11" width="6" height="4" rx="1" fill="white" opacity="0.4"/></svg>
          </div>
          <div>
            <div className="text-xs font-bold leading-tight" style={{color: t.text}}>Ads Generator</div>
            <div className="text-[10px]" style={{color: t.textMuted}}>Apero Group</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          <div className="text-[9px] font-bold uppercase tracking-widest px-3 py-2" style={{color: t.textMuted}}>Công cụ</div>
          {([
            ["home",     "🏠", "Home"],
            ["generate", "🎨", "Gen Banner"],
            ["autogen",  "⚡", "Auto Gen"],
            ["adcopy",   "✍️", "Ad Copy"],
            ["keywords", "🔑", "Keywords"],
            ["localize", "🌏", "Localize"],
            ["launch",   "🚀", "Launch Camp"],
          ] as const).map(([page, icon, label]) => (
            <button key={page} onClick={() => { setActivePage(page); if (page==="generate") { setStep("upload"); } if (page==="launch") { checkAdsConnection(); } }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left"
              style={activePage===page
                ? {backgroundColor:"#7C3AED18", color:"#A78BFA", borderLeft:"2px solid #7C3AED", paddingLeft:10}
                : {color: t.textMuted, borderLeft:"2px solid transparent", paddingLeft:10}}>
              <span>{icon}</span>{label}
            </button>
          ))}
          <div className="text-[9px] font-bold uppercase tracking-widest px-3 py-2 mt-2" style={{color: t.textMuted}}>Upload</div>
    {([
      ["youtube", "▶️", "YouTube Upload"],
    ] as const).map(([page, icon, label]) => (
      <button key={page} onClick={() => setActivePage(page)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left"
        style={activePage===page
          ? {backgroundColor:"#7C3AED18", color:"#A78BFA", borderLeft:"2px solid #7C3AED", paddingLeft:10}
          : {color: t.textMuted, borderLeft:"2px solid transparent", paddingLeft:10}}>
        <span>{icon}</span>{label}
        {ytAuthenticated && <span className="ml-auto w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/>}
      </button>
    ))}
    <div className="text-[9px] font-bold uppercase tracking-widest px-3 py-2 mt-2" style={{color: t.textMuted}}>Nghiên cứu</div>
          {([
            ["competitor", "🔍", "Competitor Ads"],
            ["history",   "🕐", "Lịch sử"],
          ] as const).map(([page, icon, label]) => (
            <button key={page} onClick={() => setActivePage(page)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left"
              style={activePage===page
                ? {backgroundColor:"#7C3AED18", color:"#A78BFA", borderLeft:"2px solid #7C3AED", paddingLeft:10}
                : {color: t.textMuted, borderLeft:"2px solid transparent", paddingLeft:10}}>
              <span>{icon}</span>{label}
              {page==="history" && history.length>0 && (
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{backgroundColor:"#10B98122",color:"#10B981"}}>{history.length}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom: user info + dark mode */}
        <div className="p-3 border-t space-y-2" style={{borderColor: t.border}}>
          {session?.user && (
            <div className="px-3 py-2 rounded-lg" style={{backgroundColor: t.tabBg}}>
              <div className="flex items-center gap-2 mb-1.5">
                {session.user.image
                  ? <img src={session.user.image} alt="" className="w-6 h-6 rounded-full flex-shrink-0"/>
                  : <div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs flex-shrink-0">{(session.user.name||"?")[0].toUpperCase()}</div>
                }
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate" style={{color: t.text}}>{session.user.name || "User"}</div>
                  <div className="text-[10px] truncate" style={{color: t.textMuted}}>{session.user.email}</div>
                </div>
              </div>
              <button onClick={() => signOut({ callbackUrl: "/login" })}
                className="w-full text-[10px] px-2 py-1 rounded-md border transition-colors text-center"
                style={{borderColor: t.border, color: t.textMuted}}>
                Đăng xuất
              </button>
            </div>
          )}
          <button onClick={() => setDarkMode(d => !d)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all border"
            style={{color: t.textMuted, borderColor: t.border, backgroundColor: t.tabBg}}>
            {darkMode ? "☀️" : "🌙"} {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col" style={{marginLeft: 200}}>

      {/* Header */}
      <header className="border-b px-6 py-3.5 flex items-center justify-between" style={{borderColor: t.border}}>
        <div className="text-sm font-semibold" style={{color: t.text}}>
          {activePage==="home" ? "👋 Dashboard" : activePage==="generate" ? "🎨 Gen Banner" : activePage==="autogen" ? "⚡ Auto Gen từ URL" : activePage==="adcopy" ? "✍️ Ad Copy Generator" : activePage==="competitor" ? "🔍 Competitor Ads" : activePage==="youtube" ? "▶️ YouTube Upload" : activePage==="keywords" ? "🔑 Keyword Research" : activePage==="localize" ? "🌏 Multi-market Localizer" : activePage==="launch" ? "🚀 Launch Campaign" : "🕐 Lịch sử"}
        </div>
        <div className="flex items-center gap-2">
          {activePage==="generate" && step !== "upload" && (
            <>
              <button onClick={() => { if (step==="preview") setStep("brief"); else if (step==="brief") setStep("upload"); else if (step==="analyzing") setStep("upload"); }}
                className="text-xs px-3 py-1.5 rounded-md border transition-colors"
                style={{color: t.textMuted, borderColor: t.border}}>← Back</button>
              <button onClick={resetAll}
                className="text-xs px-3 py-1.5 rounded-md border transition-colors"
                style={{color: t.textMuted, borderColor: t.border}}>🏠 Home</button>
            </>
          )}
          {activePage==="generate" && step==="upload" && (
            <button onClick={() => setActivePage("home")}
              className="text-xs px-3 py-1.5 rounded-md border transition-colors"
              style={{color: t.textMuted, borderColor: t.border}}>← Dashboard</button>
          )}
        </div>
      </header>

      {/* Progress bar */}
      {activePage === "generate" && (
        <div className="h-0.5" style={{backgroundColor: t.progress}}>
          <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-500"
            style={{width: step==="upload"?"15%":step==="analyzing"?"40%":step==="brief"?"60%":step==="generating"?"80%":"100%"}}/>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-6 py-10">

        {/* HOME DASHBOARD */}
        {activePage === "home" && (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{color: t.text}}>Xin chào! 👋</h1>
              <p className="text-sm" style={{color: t.textMuted}}>Chọn công cụ để bắt đầu tạo quảng cáo</p>
            </div>

            {/* Tool cards */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{color: t.textMuted}}>Công cụ chính</div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { page: "generate" as const, icon: "🎨", name: "Gen Banner", desc: "Upload ảnh → AI tạo 20+ kích thước chuẩn Google Ads trong 60 giây", badge: "Phổ biến nhất", primary: true },
                  { page: "adcopy" as const,   icon: "✍️", name: "Ad Copy",    desc: "Tạo headline, description & CTA chuẩn Google Ads theo thị trường", badge: null, primary: false },
                  { page: "competitor" as const, icon: "🔍", name: "Competitor", desc: "Xem banner quảng cáo đối thủ đang chạy qua Google Ads Transparency", badge: null, primary: false },
                ].map(tool => (
                  <button key={tool.page} onClick={() => { setActivePage(tool.page); if (tool.page==="generate") setStep("upload"); }}
                    className="p-5 rounded-2xl border text-left transition-all hover:scale-[1.02]"
                    style={tool.primary
                      ? {backgroundColor:"#7C3AED12", borderColor:"#7C3AED44", boxShadow: t.cardShadow}
                      : {...cardStyle}}>
                    <div className="text-3xl mb-3">{tool.icon}</div>
                    <div className="text-sm font-bold mb-1" style={{color: t.text}}>{tool.name}</div>
                    <div className="text-xs leading-relaxed" style={{color: t.textMuted}}>{tool.desc}</div>
                    {tool.badge && (
                      <div className="mt-3 inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full" style={{backgroundColor:"#7C3AED22",color:"#A78BFA"}}>⭐ {tool.badge}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Recent history */}
            {history.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>Lần tạo gần đây</div>
                  <button onClick={() => setActivePage("history")} className="text-xs" style={{color:"#A78BFA"}}>Xem tất cả →</button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {history.slice(0,3).map(h => (
                    <div key={h.id} className="rounded-xl border overflow-hidden" style={cardStyle}>
                      {h.thumbnail && <img src={h.thumbnail} alt="" className="w-full object-cover" style={{height:64}}/>}
                      <div className="p-3">
                        <div className="text-xs font-semibold truncate" style={{color: t.text}}>{h.appName || "Untitled"}</div>
                        <div className="text-[10px] mt-0.5" style={{color: t.textMuted}}>{h.date} · {h.count} ảnh</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* UPLOAD */}
        {activePage==="generate" && (step==="upload"||step==="analyzing") && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{color: t.text}}>Tạo ảnh Google Ads</h1>
              <p className="text-sm" style={{color: t.textMuted}}>Upload video hoặc ảnh → tự động gen {AD_SIZES.length} banner PNG cho Google UAC App Install</p>
            </div>

            {/* Niche */}
            <div className="p-5 border" style={cardStyle}>
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
            <div className="p-5 border grid grid-cols-2 gap-4" style={cardStyle}>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={labelStyle}>
                  🌐 Ngôn ngữ text trong ảnh
                </label>
                <div ref={langRef} className="relative">
                  <button type="button" onClick={() => { setLangOpen(o => !o); setLangSearch(""); }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none transition-colors"
                    style={{...inputStyle, borderColor: langOpen ? "#7C3AED" : t.inputBorder}}>
                    <span>{LANGUAGES.find(l => l.code === language)?.label || language}</span>
                    <span className="text-xs ml-2" style={{color: t.textMuted}}>{langOpen ? "▲" : "▼"}</span>
                  </button>
                  {langOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                      <div className="p-2 border-b" style={{borderColor: t.border}}>
                        <input autoFocus value={langSearch} onChange={e => setLangSearch(e.target.value)}
                          placeholder="🔍 Tìm ngôn ngữ..."
                          className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500"
                          style={inputStyle}/>
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {LANGUAGES.filter(l => l.label.toLowerCase().includes(langSearch.toLowerCase()) || l.code.toLowerCase().includes(langSearch.toLowerCase())).map(l => (
                          <button key={l.code} type="button"
                            onClick={() => { setLanguage(l.code); setLangOpen(false); setLangSearch(""); }}
                            className="w-full text-left px-4 py-2 text-sm transition-colors"
                            style={{backgroundColor: language === l.code ? "#7C3AED22" : "transparent", color: language === l.code ? "#A78BFA" : t.text}}>
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs mt-1.5" style={{color: t.textMuted}}>Headline, subheadline, CTA sẽ được viết bằng ngôn ngữ này</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={labelStyle}>
                  🎯 Thị trường mục tiêu
                </label>
                <div ref={countryRef} className="relative">
                  <button type="button" onClick={() => { setCountryOpen(o => !o); setCountrySearch(""); }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none focus:border-violet-500 transition-colors"
                    style={{...inputStyle, borderColor: countryOpen ? "#7C3AED" : t.inputBorder}}>
                    <span>{COUNTRIES.find(c => c.code === country)?.label || country}</span>
                    <span className="text-xs ml-2" style={{color: t.textMuted}}>{countryOpen ? "▲" : "▼"}</span>
                  </button>
                  {countryOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                      <div className="p-2 border-b" style={{borderColor: t.border}}>
                        <input autoFocus value={countrySearch} onChange={e => setCountrySearch(e.target.value)}
                          placeholder="🔍 Tìm quốc gia..."
                          className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500"
                          style={inputStyle}/>
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {COUNTRIES.filter(c => c.label.toLowerCase().includes(countrySearch.toLowerCase()) || c.code.toLowerCase().includes(countrySearch.toLowerCase())).map(c => (
                          <button key={c.code} type="button"
                            onClick={() => { setCountry(c.code); setCountryOpen(false); setCountrySearch(""); }}
                            className="w-full text-left px-4 py-2 text-sm transition-colors"
                            style={{backgroundColor: country === c.code ? "#7C3AED22" : "transparent", color: country === c.code ? "#A78BFA" : t.text}}>
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs mt-1.5" style={{color: t.textMuted}}>AI điều chỉnh màu sắc, tone & style phù hợp thị trường</p>
              </div>
            </div>

            {/* Input mode + upload */}
            <div className="p-5 border" style={cardStyle}>
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
            <div className="p-5 border grid grid-cols-2 gap-4" style={cardStyle}>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={labelStyle}>
                  Icon app <span className="font-normal normal-case" style={{color: t.textMuted}}>(tuỳ chọn)</span>
                </label>
                {iconDataUrlFetched ? (
                  <div className="border border-violet-500/40 bg-violet-500/5 rounded-xl p-3 flex items-center gap-3 h-[88px]">
                    <img src={iconDataUrlFetched} alt="icon" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0 shadow"/>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{color: t.text}}>Icon đã fetch ✓</div>
                      <button onClick={()=>{ setIconDataUrlFetched(null); setIconFile(null); }} className="text-xs mt-1" style={{color: t.textMuted}}>Xoá</button>
                    </div>
                  </div>
                ) : (
                  <div onClick={()=>iconInputRef.current?.click()}
                    className={`border border-dashed rounded-xl p-5 text-center cursor-pointer transition-all h-[88px] flex flex-col items-center justify-center gap-1 ${iconFile?"border-violet-500/40 bg-violet-500/5":""}`}
                    style={iconFile ? {} : {borderColor: t.border}}>
                    {iconFile ? (
                      <><div className="text-xl">🔷</div><div className="text-xs truncate max-w-[140px]" style={{color: t.text}}>{iconFile.name}</div></>
                    ) : (
                      <><div className="text-xl opacity-30">🔷</div><div className="text-xs" style={{color: t.textMuted}}>Upload icon PNG/JPG</div></>
                    )}
                    <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={e=>e.target.files?.[0]&&(setIconFile(e.target.files[0]),setIconDataUrlFetched(null))}/>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={labelStyle}>
                  Store links <span className="font-normal normal-case" style={{color: t.textMuted}}>(auto-fetch icon)</span>
                </label>
                <div className="flex gap-1">
                  <input type="url" placeholder="🍎 App Store URL" value={brief.app_store_url}
                    onChange={e=>{setBrief(p=>({...p,app_store_url:e.target.value})); setIconDataUrlFetched(null);}}
                    className="flex-1 rounded-lg px-3 py-2 text-xs border focus:outline-none focus:border-violet-500/50 transition-colors" style={inputStyle}/>
                  {brief.app_store_url && <button onClick={()=>handleFetchIcon(brief.app_store_url)} disabled={iconFetching}
                    className="px-2 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white disabled:opacity-50 flex-shrink-0">{iconFetching?"⏳":"Fetch"}</button>}
                </div>
                <div className="flex gap-1">
                  <input type="url" placeholder="🤖 Google Play URL" value={brief.play_store_url}
                    onChange={e=>{setBrief(p=>({...p,play_store_url:e.target.value})); setIconDataUrlFetched(null);}}
                    className="flex-1 rounded-lg px-3 py-2 text-xs border focus:outline-none focus:border-violet-500/50 transition-colors" style={inputStyle}/>
                  {brief.play_store_url && <button onClick={()=>handleFetchIcon(brief.play_store_url)} disabled={iconFetching}
                    className="px-2 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white disabled:opacity-50 flex-shrink-0">{iconFetching?"⏳":"Fetch"}</button>}
                </div>
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
        {activePage==="generate" && step==="brief" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1" style={{color: t.text}}>Xem lại & chỉnh brief</h2>
              <p className="text-sm" style={{color: t.textMuted}}>Claude đã phân tích. Chỉnh bất kỳ mục nào trước khi gen ảnh.</p>
            </div>

            {/* Frame selector */}
            <div className="p-5 border" style={cardStyle}>
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
                  <div key={i} className="relative flex-shrink-0 group">
                    <button onClick={()=>setBrief(p=>({...p,best_frame_index:i}))}
                      className={`rounded-lg overflow-hidden border-2 transition-all block ${brief.best_frame_index===i?"border-violet-500 scale-105":""}`}
                      style={brief.best_frame_index===i ? {} : {borderColor: t.border, opacity: 0.6}}>
                      <img src={f.dataUrl} alt={`Frame ${i}`} className="w-24 h-14 object-cover"/>
                    </button>
                    <button onClick={e=>{e.stopPropagation();setLightboxFrame(f.dataUrl);}}
                      className="absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{backgroundColor:"rgba(0,0,0,0.7)",color:"white"}} title="Xem to">🔍</button>
                  </div>
                ))}
              </div>
              <p className="text-xs mt-2" style={{color: t.textMuted}}>Click chọn frame · Hover → 🔍 để xem to · "Xóa text gốc" dùng AI xóa text (~$0.04)</p>
            </div>

            {/* Text fields */}
            <div className="p-5 border grid grid-cols-2 gap-4" style={cardStyle}>
              <div className="col-span-2 flex items-center justify-between mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider" style={labelStyle}>Nội dung</span>
                <button onClick={async () => {
                  if (!brief.app_name) { alert("Nhập tên app trước!"); return; }
                  setSuggestLoading(true); setSuggestResult(null);
                  try {
                    const res = await fetch("/api/suggest-brief", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ app_name: brief.app_name, niche: brief.niche, headline: brief.headline, subheadline: brief.subheadline, cta_text: brief.cta_text }) });
                    const data = await res.json();
                    if (data.success) setSuggestResult(data);
                  } catch {}
                  setSuggestLoading(false);
                }} disabled={suggestLoading}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all disabled:opacity-40"
                  style={{borderColor:"rgba(139,92,246,0.5)", color:"#a78bfa", backgroundColor:"rgba(139,92,246,0.08)"}}>
                  {suggestLoading ? <><span className="animate-spin">⏳</span> Đang suggest...</> : <>✨ AI Suggest</>}
                </button>
              </div>

              {/* AI Suggestions */}
              {suggestResult && (
                <div className="col-span-2 space-y-2 mb-2">
                  <p className="text-xs font-medium" style={{color: t.textMuted}}>Chọn 1 gợi ý bên dưới để áp dụng:</p>
                  {suggestResult.suggestions.map((s: {label:string;headline:string;subheadline:string;cta:string}, i: number) => (
                    <button key={i} onClick={() => { setBrief(p => ({...p, headline: s.headline, subheadline: s.subheadline, cta_text: s.cta})); setSuggestResult(null); }}
                      className="w-full text-left p-3 rounded-lg border transition-all hover:border-violet-500/60"
                      style={{borderColor: t.border, backgroundColor: t.input}}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{color:"#a78bfa"}}>{s.label || `Gợi ý ${i+1}`}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{backgroundColor:"rgba(139,92,246,0.15)", color:"#a78bfa"}}>Áp dụng →</span>
                      </div>
                      <p className="text-sm font-semibold" style={{color: t.text}}>{s.headline}</p>
                      <p className="text-xs mt-0.5" style={{color: t.textMuted}}>{s.subheadline} · <span style={{color:"#34d399"}}>{s.cta}</span></p>
                    </button>
                  ))}
                  {suggestResult.palettes && (
                    <div>
                      <p className="text-xs font-medium mt-3 mb-1.5" style={{color: t.textMuted}}>Bảng màu gợi ý:</p>
                      <div className="flex gap-2">
                        {suggestResult.palettes.map((p: {name:string;primary:string;secondary:string;accent:string}, i: number) => (
                          <button key={i} onClick={() => { setBrief(prev => ({...prev, primary_color: p.primary, secondary_color: p.secondary, accent_color: p.accent})); }}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all hover:border-violet-500/60 flex-1"
                            style={{borderColor: t.border, backgroundColor: t.input}}>
                            <div className="flex gap-1">
                              <div className="w-4 h-4 rounded-full" style={{backgroundColor: p.primary}}/>
                              <div className="w-4 h-4 rounded-full" style={{backgroundColor: p.secondary}}/>
                              <div className="w-4 h-4 rounded-full" style={{backgroundColor: p.accent}}/>
                            </div>
                            <span className="text-[10px]" style={{color: t.textMuted}}>{p.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
            <div className="p-5 border" style={cardStyle}>
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
        {activePage==="generate" && step==="generating" && (
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
        {activePage==="generate" && step==="preview" && (
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
              {([["top5","⭐ Top 5"],["all",`Tất cả (${previews.length})`],["device","📱 Device Preview"]] as const).map(([tab,label])=>(
                <button key={tab} onClick={()=>setActiveTab(tab)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={activeTab===tab ? {backgroundColor: t.tabActive, color: t.text} : {color: t.textMuted}}>
                  {label}
                </button>
              ))}
            </div>
            {/* Device Preview Tab */}
            {activeTab === "device" && (() => {
              const allP = previews;
              const cur = allP[devicePreviewIndex] || allP[0];
              const isPortrait = cur && cur.height > cur.width;
              const isSquare = cur && cur.width === cur.height;
              return (
                <div className="space-y-6">
                  {/* Device selector */}
                  <div className="flex items-center gap-3">
                    {(["phone","tablet"] as const).map(d => (
                      <button key={d} onClick={() => setDeviceType(d)}
                        className="px-4 py-1.5 rounded-lg text-sm font-medium border transition-all"
                        style={deviceType===d ? {backgroundColor:"#7C3AED22",borderColor:"#7C3AED",color:"#A78BFA"} : {borderColor:t.border,color:t.textMuted}}>
                        {d==="phone"?"📱 Phone":"📟 Tablet"}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col lg:flex-row gap-8 items-start">
                    {/* Mockup */}
                    <div className="flex-shrink-0 flex flex-col items-center gap-4">
                      {/* Phone frame */}
                      {deviceType === "phone" ? (
                        <div className="relative rounded-[2.5rem] border-[6px] shadow-2xl overflow-hidden flex-shrink-0"
                          style={{width:220, height:440, borderColor: isDark?"#334155":"#1E293B", backgroundColor:"#0F172A"}}>
                          {/* Notch */}
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 rounded-b-xl z-10" style={{backgroundColor: isDark?"#334155":"#1E293B"}}/>
                          {/* Screen */}
                          <div className="w-full h-full overflow-hidden flex flex-col" style={{backgroundColor:"#F8FAFC"}}>
                            {/* Status bar */}
                            <div className="flex items-center justify-between px-5 pt-6 pb-1 text-xs font-medium" style={{color:"#0F172A"}}>
                              <span>9:41</span><span>●●●</span>
                            </div>
                            {/* App-like content above ad — thu nhỏ lại nếu portrait */}
                            {!isPortrait && (
                              <div className="flex-1 px-2 py-1 space-y-1.5 overflow-hidden">
                                {[80,60,70].map((w,i)=>(
                                  <div key={i} className="h-2 rounded-full" style={{width:`${w}%`,backgroundColor:"#E2E8F0"}}/>
                                ))}
                                <div className="h-16 rounded-lg mt-2" style={{backgroundColor:"#E2E8F0"}}/>
                                <div className="h-2 rounded-full w-4/5" style={{backgroundColor:"#E2E8F0"}}/>
                                <div className="h-2 rounded-full w-3/5" style={{backgroundColor:"#E2E8F0"}}/>
                              </div>
                            )}
                            {/* Ad banner — scale đúng tỉ lệ, phone inner width ~196px */}
                            {cur && (() => {
                              const innerW = 196;
                              const ratio = cur.height / cur.width;
                              const adH = Math.round(innerW * ratio);
                              const maxAdH = isPortrait ? 320 : isSquare ? 196 : 103;
                              return (
                                <div className="relative mx-1 mb-1 overflow-hidden rounded-lg shadow" style={{flexShrink:0, height: Math.min(adH, maxAdH)}}>
                                  <div className="absolute top-0.5 right-0.5 bg-black/50 text-white px-1 rounded z-10" style={{fontSize:8}}>Ad</div>
                                  <img src={cur.dataUrl} alt="" style={{width:"100%", height:"100%", objectFit:"cover", objectPosition:"top"}}/>
                                </div>
                              );
                            })()}
                          </div>
                          {/* Home bar */}
                          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full" style={{backgroundColor:"#334155"}}/>
                        </div>
                      ) : (
                        /* Tablet frame */
                        <div className="relative rounded-[1.5rem] border-[6px] shadow-2xl overflow-hidden"
                          style={{width:320, height:440, borderColor: isDark?"#334155":"#1E293B", backgroundColor:"#0F172A"}}>
                          <div className="w-full h-full overflow-hidden flex flex-col" style={{backgroundColor:"#F8FAFC"}}>
                            <div className="flex items-center justify-between px-4 pt-3 pb-1 text-xs font-medium" style={{color:"#0F172A"}}>
                              <span>9:41</span><span>●●● 100%</span>
                            </div>
                            <div className="flex-1 px-3 py-2 grid grid-cols-2 gap-2 overflow-hidden">
                              {[1,2,3,4].map(i=>(
                                <div key={i} className="rounded-lg" style={{backgroundColor:"#E2E8F0",height:80}}/>
                              ))}
                            </div>
                            {cur && (() => {
                              const innerW = 296;
                              const ratio = cur.height / cur.width;
                              const adH = Math.round(innerW * ratio);
                              const maxAdH = isPortrait ? 380 : isSquare ? 296 : 155;
                              return (
                                <div className="relative mx-2 mb-2 overflow-hidden rounded-lg shadow" style={{flexShrink:0, height: Math.min(adH, maxAdH)}}>
                                  <div className="absolute top-0.5 right-0.5 bg-black/50 text-white px-1 rounded z-10" style={{fontSize:8}}>Ad</div>
                                  <img src={cur.dataUrl} alt="" style={{width:"100%", height:"100%", objectFit:"cover", objectPosition:"top"}}/>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                      <div className="text-xs text-center" style={{color:t.textMuted}}>
                        {cur?.label} · {cur?.width}×{cur?.height}px
                      </div>
                    </div>

                    {/* Banner selector list */}
                    <div className="flex-1 grid grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                      {allP.map((p,i) => (
                        <button key={p.key} onClick={() => setDevicePreviewIndex(i)}
                          className="rounded-lg border p-2 text-left transition-all"
                          style={{borderColor: devicePreviewIndex===i?"#7C3AED":t.border, backgroundColor: devicePreviewIndex===i?"#7C3AED11":t.card}}>
                          <img src={p.dataUrl} alt="" className="w-full rounded mb-1 object-cover" style={{height:40}}/>
                          <div className="text-xs font-medium truncate" style={{color: devicePreviewIndex===i?"#A78BFA":t.text}}>{p.key}</div>
                          <div className="text-xs truncate" style={{color:t.textMuted}}>{p.width}×{p.height}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Banner grid */}
            {activeTab !== "device" && <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {displayedPreviews.map(p=>{
                const scale=Math.min(1,340/Math.max(p.width,p.height));
                return (
                  <div key={p.key} onClick={()=>setSelectedPreview(p)}
                    className="group rounded-2xl p-4 cursor-pointer transition-all border"
                    style={{...cardStyle, transition:"box-shadow 0.2s, border-color 0.2s, background-color 0.2s"}}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = t.cardShadowHover; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(139,92,246,0.4)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = t.cardShadow; (e.currentTarget as HTMLDivElement).style.borderColor = t.border; }}>
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
            </div>}
          </div>
        )}

        {/* AD COPY PAGE */}
        {activePage === "adcopy" && (
          <div className="max-w-xl space-y-4">
            <div className="text-xs font-medium mb-1" style={{color: t.textMuted}}>Tên app / sản phẩm *</div>
            <input value={adcopyAppName} onChange={e => setAdcopyAppName(e.target.value)}
              placeholder="VD: Canva, PhotoRoom..."
              className="w-full text-sm rounded-xl px-4 py-3 border focus:outline-none focus:border-violet-500"
              style={inputStyle}/>
            <div className="text-xs font-medium mb-1" style={{color: t.textMuted}}>Key message</div>
            <textarea value={adcopyMessage} onChange={e => setAdcopyMessage(e.target.value)}
              placeholder="VD: Chỉnh ảnh chuyên nghiệp, miễn phí..." rows={3}
              className="w-full text-sm rounded-xl px-4 py-3 border focus:outline-none focus:border-violet-500 resize-none"
              style={inputStyle}/>
            <div className="grid grid-cols-2 gap-3">
              {/* Country searchable dropdown */}
              <div>
                <div className="text-xs font-medium mb-1.5" style={{color: t.textMuted}}>Thị trường</div>
                <div ref={adcopyCountryRef} className="relative">
                  <button type="button" onClick={() => { setAdcopyCountryOpen(o => !o); setAdcopyCountrySearch(""); }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none transition-colors"
                    style={{...inputStyle, borderColor: adcopyCountryOpen ? "#7C3AED" : t.inputBorder}}>
                    <span className="truncate">{COUNTRIES.find(c => c.code === adcopyCountry)?.label || adcopyCountry}</span>
                    <span className="text-xs ml-2 flex-shrink-0" style={{color: t.textMuted}}>{adcopyCountryOpen ? "▲" : "▼"}</span>
                  </button>
                  {adcopyCountryOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                      <div className="p-2 border-b" style={{borderColor: t.border}}>
                        <input autoFocus value={adcopyCountrySearch} onChange={e => setAdcopyCountrySearch(e.target.value)}
                          placeholder="🔍 Tìm quốc gia..."
                          className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500"
                          style={inputStyle}/>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {COUNTRIES.filter(c => c.label.toLowerCase().includes(adcopyCountrySearch.toLowerCase()) || c.code.toLowerCase().includes(adcopyCountrySearch.toLowerCase())).map(c => (
                          <button key={c.code} type="button"
                            onClick={() => { setAdcopyCountry(c.code); setAdcopyCountryOpen(false); setAdcopyCountrySearch(""); const defaultLang = COUNTRY_DEFAULT_LANG[c.code]; if (defaultLang) setAdcopyLang(defaultLang); }}
                            className="w-full text-left px-4 py-2 text-sm transition-colors"
                            style={{backgroundColor: adcopyCountry === c.code ? "#7C3AED22" : "transparent", color: adcopyCountry === c.code ? "#A78BFA" : t.text}}>
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* Language searchable dropdown */}
              <div>
                <div className="text-xs font-medium mb-1.5" style={{color: t.textMuted}}>Ngôn ngữ</div>
                <div ref={adcopyLangRef} className="relative">
                  <button type="button" onClick={() => { setAdcopyLangOpen(o => !o); setAdcopyLangSearch(""); }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none transition-colors"
                    style={{...inputStyle, borderColor: adcopyLangOpen ? "#7C3AED" : t.inputBorder}}>
                    <span className="truncate">{LANGUAGES.find(l => l.code === adcopyLang)?.label || adcopyLang}</span>
                    <span className="text-xs ml-2 flex-shrink-0" style={{color: t.textMuted}}>{adcopyLangOpen ? "▲" : "▼"}</span>
                  </button>
                  {adcopyLangOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                      <div className="p-2 border-b" style={{borderColor: t.border}}>
                        <input autoFocus value={adcopyLangSearch} onChange={e => setAdcopyLangSearch(e.target.value)}
                          placeholder="🔍 Tìm ngôn ngữ..."
                          className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500"
                          style={inputStyle}/>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {LANGUAGES.filter(l => l.label.toLowerCase().includes(adcopyLangSearch.toLowerCase()) || l.code.toLowerCase().includes(adcopyLangSearch.toLowerCase())).map(l => (
                          <button key={l.code} type="button"
                            onClick={() => { setAdcopyLang(l.code); setAdcopyLangOpen(false); setAdcopyLangSearch(""); }}
                            className="w-full text-left px-4 py-2 text-sm transition-colors"
                            style={{backgroundColor: adcopyLang === l.code ? "#7C3AED22" : "transparent", color: adcopyLang === l.code ? "#A78BFA" : t.text}}>
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <button onClick={handleAdCopyGenerate} disabled={adcopyLoading || !adcopyAppName.trim()}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-3 px-4 rounded-xl transition-all font-semibold flex items-center justify-center gap-2">
              {adcopyLoading ? <><span className="animate-spin">⏳</span> Đang tạo...</> : <>✨ Generate Ad Copy</>}
            </button>

            {adcopyResult && (
              <div className="space-y-4 pt-2">
                <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
                  <div className="px-4 py-3 text-xs font-bold border-b flex items-center gap-2" style={{backgroundColor: t.tabBg, borderColor: t.border, color: t.text}}>
                    📣 Headlines <span className="font-normal" style={{color: t.textMuted}}>(≤30 ký tự)</span>
                  </div>
                  {adcopyResult.headlines.map((h, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 gap-2 border-b last:border-0" style={{borderColor: t.border}}>
                      <span className="text-sm flex-1" style={{color: t.text}}>{h}</span>
                      <button onClick={() => copyText(h)} className="text-xs px-2 py-0.5 rounded flex-shrink-0 transition-colors" style={{backgroundColor: adcopyCopied===h ? "#10B98122" : t.tabBg, color: adcopyCopied===h ? "#10B981" : t.textMuted}}>
                        {adcopyCopied===h ? "✓" : "copy"}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
                  <div className="px-4 py-3 text-xs font-bold border-b" style={{backgroundColor: t.tabBg, borderColor: t.border, color: t.text}}>
                    📝 Descriptions <span className="font-normal" style={{color: t.textMuted}}>(≤90 ký tự)</span>
                  </div>
                  {adcopyResult.descriptions.map((d, i) => (
                    <div key={i} className="flex items-start justify-between px-4 py-2.5 gap-2 border-b last:border-0" style={{borderColor: t.border}}>
                      <span className="text-sm leading-relaxed flex-1" style={{color: t.text}}>{d}</span>
                      <button onClick={() => copyText(d)} className="text-xs px-2 py-0.5 rounded mt-0.5 flex-shrink-0 transition-colors" style={{backgroundColor: adcopyCopied===d ? "#10B98122" : t.tabBg, color: adcopyCopied===d ? "#10B981" : t.textMuted}}>
                        {adcopyCopied===d ? "✓" : "copy"}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
                  <div className="px-4 py-3 text-xs font-bold border-b" style={{backgroundColor: t.tabBg, borderColor: t.border, color: t.text}}>🎯 Call to Action</div>
                  <div className="p-4 flex flex-wrap gap-2">
                    {adcopyResult.ctas.map((c, i) => (
                      <button key={i} onClick={() => copyText(c)} className="text-sm px-4 py-2 rounded-xl border transition-all"
                        style={{borderColor: adcopyCopied===c ? "#10B981" : t.border, color: adcopyCopied===c ? "#10B981" : t.text, backgroundColor: t.tabBg}}>
                        {adcopyCopied===c ? "✓ Copied" : c}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleAdCopyGenerate} className="w-full text-sm py-2 rounded-xl border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>🔄 Tạo lại</button>
              </div>
            )}
          </div>
        )}

        {/* AUTO GEN PAGE */}
        {activePage === "autogen" && (
          <div className="space-y-6 max-w-2xl">

            {/* Step indicator */}
            <div className="flex items-center gap-2 text-xs" style={{color: t.textMuted}}>
              {(["input","analyzing","brief","generating","preview"] as AutoGenStep[]).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${agStep===s?"bg-violet-600 text-white":["preview","generating","brief"].includes(agStep)&&i<["input","analyzing","brief","generating","preview"].indexOf(agStep)?"bg-violet-600/40 text-violet-400":"text-current"}`}
                    style={agStep!==s?{backgroundColor:t.tabBg}:{}}>{i+1}</span>
                  <span style={agStep===s?{color:"#A78BFA"}:{}}>{s==="input"?"Nhập URL":s==="analyzing"?"Phân tích":s==="brief"?"Review brief":s==="generating"?"Tạo ảnh":"Kết quả"}</span>
                  {i<4&&<span>→</span>}
                </div>
              ))}
            </div>

            {/* STEP 1: Input */}
            {agStep === "input" && (
              <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{color: t.textMuted}}>
                    🔗 URL App Store / Play Store <span className="text-violet-400">*</span>
                  </label>
                  <input value={agUrl} onChange={e => setAgUrl(e.target.value)}
                    placeholder="https://apps.apple.com/... hoặc https://play.google.com/..."
                    className="w-full text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500"
                    style={inputStyle}/>
                  <p className="text-xs mt-1.5" style={{color: t.textMuted}}>AI sẽ tự lấy tên app, mô tả, screenshot và icon từ URL này</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{color: t.textMuted}}>
                    🎯 Keywords / điểm bán hàng
                  </label>
                  <input value={agKeywords} onChange={e => setAgKeywords(e.target.value)}
                    placeholder="VD: AI photo editor, remove background, free filters..."
                    className="w-full text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500"
                    style={inputStyle}/>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Thị trường</label>
                    <div ref={agCountryRef} className="relative">
                      <button type="button" onClick={() => { setAgCountryOpen(o => !o); setAgCountrySearch(""); }}
                        className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between"
                        style={{...inputStyle, borderColor: agCountryOpen ? "#7C3AED" : t.inputBorder}}>
                        <span className="truncate">{COUNTRIES.find(c => c.code === agCountry)?.label || agCountry}</span>
                        <span className="text-xs ml-2 flex-shrink-0" style={{color: t.textMuted}}>{agCountryOpen ? "▲" : "▼"}</span>
                      </button>
                      {agCountryOpen && (
                        <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                          <div className="p-2 border-b" style={{borderColor: t.border}}>
                            <input autoFocus value={agCountrySearch} onChange={e => setAgCountrySearch(e.target.value)}
                              placeholder="🔍 Tìm quốc gia..." className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {COUNTRIES.filter(c => c.label.toLowerCase().includes(agCountrySearch.toLowerCase()) || c.code.toLowerCase().includes(agCountrySearch.toLowerCase())).map(c => (
                              <button key={c.code} type="button"
                                onClick={() => { setAgCountry(c.code); setAgCountryOpen(false); setAgCountrySearch(""); const dl = COUNTRY_DEFAULT_LANG[c.code]; if (dl) setAgLang(dl); }}
                                className="w-full text-left px-4 py-2 text-sm"
                                style={{backgroundColor: agCountry === c.code ? "#7C3AED22" : "transparent", color: agCountry === c.code ? "#A78BFA" : t.text}}>
                                {c.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Ngôn ngữ</label>
                    <div ref={agLangRef} className="relative">
                      <button type="button" onClick={() => { setAgLangOpen(o => !o); setAgLangSearch(""); }}
                        className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between"
                        style={{...inputStyle, borderColor: agLangOpen ? "#7C3AED" : t.inputBorder}}>
                        <span className="truncate">{LANGUAGES.find(l => l.code === agLang)?.label || agLang}</span>
                        <span className="text-xs ml-2 flex-shrink-0" style={{color: t.textMuted}}>{agLangOpen ? "▲" : "▼"}</span>
                      </button>
                      {agLangOpen && (
                        <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                          <div className="p-2 border-b" style={{borderColor: t.border}}>
                            <input autoFocus value={agLangSearch} onChange={e => setAgLangSearch(e.target.value)}
                              placeholder="🔍 Tìm ngôn ngữ..." className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {LANGUAGES.filter(l => l.label.toLowerCase().includes(agLangSearch.toLowerCase()) || l.code.toLowerCase().includes(agLangSearch.toLowerCase())).map(l => (
                              <button key={l.code} type="button"
                                onClick={() => { setAgLang(l.code); setAgLangOpen(false); setAgLangSearch(""); }}
                                className="w-full text-left px-4 py-2 text-sm"
                                style={{backgroundColor: agLang === l.code ? "#7C3AED22" : "transparent", color: agLang === l.code ? "#A78BFA" : t.text}}>
                                {l.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {agError && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{agError}</p>}

                <button onClick={handleAgAnalyze} disabled={!agUrl.trim()}
                  className="w-full py-3 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white flex items-center justify-center gap-2">
                  ⚡ Phân tích app & tạo brief →
                </button>
              </div>
            )}

            {/* STEP 2: Analyzing */}
            {agStep === "analyzing" && (
              <div className="text-center py-20 space-y-4">
                <div className="text-5xl animate-pulse">⚡</div>
                <div className="text-lg font-bold" style={{color: t.text}}>Đang phân tích app...</div>
                <div className="text-sm space-y-1" style={{color: t.textMuted}}>
                  <div>📱 Lấy thông tin từ App Store...</div>
                  <div>🖼️ Tải screenshot & icon...</div>
                  <div>🤖 Claude đang tạo brief...</div>
                </div>
              </div>
            )}

            {/* STEP 3: Brief review */}
            {agStep === "brief" && agBrief && (
              <div className="space-y-4">
                {/* App info card */}
                {agAppMeta && (
                  <div className="flex items-center gap-4 p-4 rounded-2xl border" style={cardStyle}>
                    {agIcon && <img src={agIcon} alt="" className="w-16 h-16 rounded-2xl flex-shrink-0 shadow"/>}
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm" style={{color: t.text}}>{agAppMeta.name}</div>
                      <div className="text-xs mt-0.5" style={{color: t.textMuted}}>{agAppMeta.category} · {agAppMeta.platform}</div>
                      {agAppMeta.rating > 0 && <div className="text-xs mt-0.5" style={{color: t.textMuted}}>⭐ {agAppMeta.rating.toFixed(1)} ({agAppMeta.ratingCount?.toLocaleString()} ratings)</div>}
                      {agScreenshot && <div className="text-xs mt-0.5 text-emerald-500">✓ Screenshot tải thành công</div>}
                    </div>
                  </div>
                )}

                {/* Brief editor */}
                <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>Review & chỉnh brief</div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {key:"app_name",label:"Tên app"},
                      {key:"cta_text",label:"CTA"},
                      {key:"headline",label:"Headline",full:true},
                      {key:"subheadline",label:"Subheadline",full:true},
                    ].map(f => (
                      <div key={f.key} className={f.full?"col-span-2":""}>
                        <label className="block text-xs mb-1" style={{color: t.textMuted}}>{f.label}</label>
                        <input value={(agBrief as unknown as Record<string,string>)[f.key]||""}
                          onChange={e => setAgBrief(p => p ? {...p, [f.key]: e.target.value} : p)}
                          className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-5">
                    {[{key:"primary_color",label:"Primary"},{key:"secondary_color",label:"Secondary"},{key:"accent_color",label:"Accent"}].map(c => (
                      <div key={c.key} className="flex items-center gap-2">
                        <input type="color" value={(agBrief as unknown as Record<string,string>)[c.key]||"#7B2FBE"}
                          onChange={e => setAgBrief(p => p ? {...p, [c.key]: e.target.value} : p)}
                          className="w-8 h-8 rounded cursor-pointer border" style={{borderColor: t.border}}/>
                        <span className="text-xs" style={{color: t.textMuted}}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                  {/* Screenshot preview */}
                  {agScreenshot && (
                    <div>
                      <div className="text-xs mb-1.5" style={{color: t.textMuted}}>Background (screenshot app)</div>
                      <img src={agScreenshot} alt="" className="h-24 rounded-xl object-cover border" style={{borderColor: t.border}}/>
                    </div>
                  )}
                </div>

                {agError && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{agError}</p>}

                <div className="flex gap-3">
                  <button onClick={resetAg} className="px-4 py-3 rounded-xl border text-sm transition-colors" style={{borderColor: t.border, color: t.textMuted}}>← Nhập lại</button>
                  <button onClick={handleAgGenerate} className="flex-1 py-3 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 transition-all text-white">
                    Gen {AD_SIZES.length} banner PNG →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: Generating */}
            {agStep === "generating" && (
              <div className="text-center py-20 space-y-6">
                <div className="text-5xl animate-pulse">🎨</div>
                <div className="text-xl font-bold" style={{color: t.text}}>Đang tạo {AD_SIZES.length} banner...</div>
                <div className="w-48 h-1 rounded-full overflow-hidden mx-auto" style={{backgroundColor: t.border}}>
                  <div className="h-full bg-violet-500 animate-pulse w-2/3"/>
                </div>
              </div>
            )}

            {/* STEP 5: Preview */}
            {agStep === "preview" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-bold" style={{color: t.text}}>✅ {agPreviews.length} banner đã sẵn sàng</div>
                    <div className="text-xs mt-0.5" style={{color: t.textMuted}}>{agBrief?.app_name} · {agCountry}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={resetAg} className="text-xs px-3 py-2 rounded-lg border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>🔄 Gen lại</button>
                    <button onClick={handleAgDownloadAll} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all">
                      ⬇ Tải tất cả (.zip)
                    </button>
                  </div>
                </div>
                <div className="flex gap-1 rounded-xl p-1 w-fit" style={{backgroundColor: t.tabBg}}>
                  {([["top5","⭐ Top 5"],["all",`Tất cả (${agPreviews.length})`]] as const).map(([tab,label])=>(
                    <button key={tab} onClick={() => setAgActiveTab(tab)}
                      className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
                      style={agActiveTab===tab?{backgroundColor:t.tabActive,color:t.text}:{color:t.textMuted}}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {agDisplayed.map(p => {
                    const scale = Math.min(1, 340/Math.max(p.width, p.height));
                    return (
                      <div key={p.key} onClick={() => setSelectedPreview(p)}
                        className="group rounded-2xl p-4 cursor-pointer transition-all border"
                        style={cardStyle}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = t.cardShadowHover; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(139,92,246,0.4)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = t.cardShadow; (e.currentTarget as HTMLDivElement).style.borderColor = t.border; }}>
                        <div className="flex items-center justify-center mb-3" style={{height: Math.round(p.height*scale)+16}}>
                          <img src={p.dataUrl} alt={p.label} style={{width:Math.round(p.width*scale),height:Math.round(p.height*scale)}} className="rounded shadow-lg"/>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-semibold" style={{color: t.text}}>{p.key}</div>
                            <div className="text-xs" style={{color: t.textMuted}}>{p.label}</div>
                          </div>
                          <button onClick={e => { e.stopPropagation(); const a=document.createElement("a"); a.href=p.dataUrl; a.download=`${p.key}.png`; a.click(); }}
                            className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded-lg transition-all hover:bg-violet-600 hover:text-white"
                            style={{backgroundColor: t.tabBg, color: t.textSub}}>⬇</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* KEYWORD RESEARCH PAGE */}
        {activePage === "keywords" && (
          <div className="max-w-2xl space-y-5">
            {/* Input form */}
            <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
              <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>Thông tin app</div>
              <div>
                <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Tên app</label>
                <input value={kwAppName} onChange={e => setKwAppName(e.target.value)}
                  placeholder="VD: Canva, PhotoRoom, Snapseed..."
                  className="w-full text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500"
                  style={inputStyle}/>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1" style={{backgroundColor: t.border}}/>
                <span className="text-xs" style={{color: t.textMuted}}>hoặc</span>
                <div className="h-px flex-1" style={{backgroundColor: t.border}}/>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>URL App Store / Play Store</label>
                <input value={kwAppUrl} onChange={e => setKwAppUrl(e.target.value)}
                  placeholder="https://apps.apple.com/... hoặc https://play.google.com/..."
                  className="w-full text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500"
                  style={inputStyle}/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Country */}
                <div>
                  <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Thị trường</label>
                  <div ref={kwCountryRef} className="relative">
                    <button type="button" onClick={() => { setKwCountryOpen(o => !o); setKwCountrySearch(""); }}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none"
                      style={{...inputStyle, borderColor: kwCountryOpen ? "#7C3AED" : t.inputBorder}}>
                      <span className="truncate">{COUNTRIES.find(c => c.code === kwCountry)?.label || kwCountry}</span>
                      <span className="text-xs ml-2 flex-shrink-0" style={{color: t.textMuted}}>{kwCountryOpen ? "▲" : "▼"}</span>
                    </button>
                    {kwCountryOpen && (
                      <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                        <div className="p-2 border-b" style={{borderColor: t.border}}>
                          <input autoFocus value={kwCountrySearch} onChange={e => setKwCountrySearch(e.target.value)}
                            placeholder="🔍 Tìm quốc gia..." className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {COUNTRIES.filter(c => c.label.toLowerCase().includes(kwCountrySearch.toLowerCase()) || c.code.toLowerCase().includes(kwCountrySearch.toLowerCase())).map(c => (
                            <button key={c.code} type="button"
                              onClick={() => { setKwCountry(c.code); setKwCountryOpen(false); setKwCountrySearch(""); const dl = COUNTRY_DEFAULT_LANG[c.code]; if (dl) setKwLang(dl); }}
                              className="w-full text-left px-4 py-2 text-sm"
                              style={{backgroundColor: kwCountry === c.code ? "#7C3AED22" : "transparent", color: kwCountry === c.code ? "#A78BFA" : t.text}}>
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Language */}
                <div>
                  <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Ngôn ngữ</label>
                  <div ref={kwLangRef} className="relative">
                    <button type="button" onClick={() => { setKwLangOpen(o => !o); setKwLangSearch(""); }}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none"
                      style={{...inputStyle, borderColor: kwLangOpen ? "#7C3AED" : t.inputBorder}}>
                      <span className="truncate">{LANGUAGES.find(l => l.code === kwLang)?.label || kwLang}</span>
                      <span className="text-xs ml-2 flex-shrink-0" style={{color: t.textMuted}}>{kwLangOpen ? "▲" : "▼"}</span>
                    </button>
                    {kwLangOpen && (
                      <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                        <div className="p-2 border-b" style={{borderColor: t.border}}>
                          <input autoFocus value={kwLangSearch} onChange={e => setKwLangSearch(e.target.value)}
                            placeholder="🔍 Tìm ngôn ngữ..." className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {LANGUAGES.filter(l => l.label.toLowerCase().includes(kwLangSearch.toLowerCase()) || l.code.toLowerCase().includes(kwLangSearch.toLowerCase())).map(l => (
                            <button key={l.code} type="button"
                              onClick={() => { setKwLang(l.code); setKwLangOpen(false); setKwLangSearch(""); }}
                              className="w-full text-left px-4 py-2 text-sm"
                              style={{backgroundColor: kwLang === l.code ? "#7C3AED22" : "transparent", color: kwLang === l.code ? "#A78BFA" : t.text}}>
                              {l.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {kwError && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{kwError}</p>}
              <button onClick={handleKwGenerate}
                disabled={kwLoading || (!kwAppName.trim() && !kwAppUrl.trim())}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white flex items-center justify-center gap-2">
                {kwLoading ? <><span className="animate-spin">⏳</span> Đang phân tích...</> : <>🔑 Tìm Keywords</>}
              </button>
            </div>

            {/* Results */}
            {kwResult && (
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-bold" style={{color: t.text}}>{kwResult.app_name}</div>
                    <div className="text-xs" style={{color: t.textMuted}}>{kwResult.keywords.length} keywords · {kwCountry !== "Global" ? kwCountry : "Global"} · ước tính bởi AI</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={kwSort} onChange={e => setKwSort(e.target.value as typeof kwSort)}
                      className="text-xs rounded-lg px-2 py-1.5 border focus:outline-none" style={inputStyle}>
                      <option value="relevance">Sắp xếp: Relevance</option>
                      <option value="competition_index">Sắp xếp: Competition ↑</option>
                      <option value="cpc_max">Sắp xếp: CPC ↓</option>
                    </select>
                    <button onClick={copyKwList}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-all active:scale-95"
                      style={kwCopied ? {borderColor:"#10B981",color:"#10B981",backgroundColor:"#10B98111"} : {borderColor:t.border,color:t.textMuted}}>
                      {kwCopied ? "✓ Đã copy!" : "📋 Copy list"}
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div className="rounded-2xl border overflow-hidden" style={{borderColor: t.border}}>
                  {/* Table header */}
                  <div className="grid text-xs font-bold uppercase tracking-wider px-4 py-2.5 border-b"
                    style={{gridTemplateColumns:"1fr 110px 90px 80px 90px", backgroundColor: t.tabBg, borderColor: t.border, color: t.textMuted}}>
                    <div>Keyword</div>
                    <div className="text-center">Volume/tháng</div>
                    <div className="text-center">Competition</div>
                    <div className="text-center">CPC (USD)</div>
                    <div className="text-center">Intent</div>
                  </div>
                  {/* Rows */}
                  {[...kwResult.keywords].sort((a, b) => {
                    if (kwSort === "relevance") return b.relevance - a.relevance;
                    if (kwSort === "competition_index") return a.competition_index - b.competition_index;
                    return b.cpc_max - a.cpc_max;
                  }).map((kw, i) => (
                    <div key={i} className="grid items-center px-4 py-2.5 border-b last:border-0 hover:bg-violet-500/5 transition-colors"
                      style={{gridTemplateColumns:"1fr 110px 90px 80px 90px", borderColor: t.border}}>
                      <div>
                        <div className="text-sm font-medium" style={{color: t.text}}>{kw.keyword}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <div className="h-1 rounded-full overflow-hidden" style={{width:48, backgroundColor: t.progress}}>
                            <div className="h-full bg-violet-500 rounded-full" style={{width:`${kw.relevance}%`}}/>
                          </div>
                          <span className="text-xs" style={{color: t.textMuted}}>{kw.relevance}%</span>
                        </div>
                      </div>
                      <div className="text-xs text-center font-medium" style={{color: t.text}}>{kw.monthly_searches}</div>
                      <div className="text-center">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: kw.competition === "Low" ? "#10B98122" : kw.competition === "Medium" ? "#F59E0B22" : "#EF444422",
                            color: kw.competition === "Low" ? "#10B981" : kw.competition === "Medium" ? "#F59E0B" : "#EF4444",
                          }}>
                          {kw.competition}
                        </span>
                      </div>
                      <div className="text-xs text-center" style={{color: t.text}}>${kw.cpc_min.toFixed(2)}–${kw.cpc_max.toFixed(2)}</div>
                      <div className="text-center">
                        <span className="text-xs px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: kw.intent === "Install" ? "#7C3AED22" : kw.intent === "Branded" ? "#3B82F622" : kw.intent === "Compare" ? "#F59E0B22" : "#64748B22",
                            color: kw.intent === "Install" ? "#A78BFA" : kw.intent === "Branded" ? "#60A5FA" : kw.intent === "Compare" ? "#F59E0B" : t.textMuted,
                          }}>
                          {kw.intent}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Disclaimer */}
                <p className="text-xs text-center" style={{color: t.textMuted}}>
                  ⚠️ Volume & CPC là ước tính AI, không phải dữ liệu thực từ Google Keyword Planner.
                  Dùng để định hướng chiến lược, không dùng để báo cáo.
                </p>

                <button onClick={handleKwGenerate} className="w-full text-sm py-2 rounded-xl border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>
                  🔄 Tạo lại
                </button>
              </div>
            )}
          </div>
        )}

        {/* COMPETITOR PAGE */}
        {activePage === "competitor" && (
          <div className="max-w-xl space-y-4">
            <div className="text-xs" style={{color: t.textMuted}}>Nhập link App Store hoặc Play Store của app đối thủ</div>
            <input value={compQuery} onChange={e => {
              const val = e.target.value; setCompQuery(val); setCompAppName(""); setCompAppIcon("");
              if (val.trim().startsWith("http")) lookupAppNamePreview(val.trim());
            }}
              placeholder="https://apps.apple.com/... hoặc https://play.google.com/..."
              className="w-full text-sm rounded-xl px-4 py-3 border focus:outline-none focus:border-violet-500"
              style={inputStyle}/>
            {compQuery.trim().startsWith("http") && (
              <div className="flex items-center gap-2 px-1">
                {compNameLoading ? <span className="text-xs" style={{color: t.textMuted}}>⏳ Đang nhận diện app...</span>
                  : compAppName ? (
                    <>
                      {compAppIcon && <img src={compAppIcon} alt="" className="w-8 h-8 rounded-xl flex-shrink-0"/>}
                      <span className="text-sm font-semibold" style={{color: t.text}}>{compAppName}</span>
                    </>
                  ) : null}
              </div>
            )}
            {compQuery.trim() && (
              <button onClick={handleCompetitorSearch} disabled={compLoading || compNameLoading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-3 px-4 rounded-xl transition-all font-semibold flex items-center justify-center gap-2">
                {compLoading ? <><span>⏳</span> Đang mở...</> : <>🔎 Xem quảng cáo trên Google</>}
              </button>
            )}
            <div className="text-xs font-semibold mt-6" style={{color: t.textMuted}}>Ví dụ nhanh</div>
            {["https://apps.apple.com/us/app/canva/id897446215","https://play.google.com/store/apps/details?id=com.canva.editor"].map(ex => (
              <button key={ex} onClick={() => setCompQuery(ex)}
                className="w-full text-left text-sm px-4 py-3 rounded-xl border transition-colors"
                style={cardStyle}>
                {ex.includes("apple") ? "🍎 App Store — Canva" : "🤖 Play Store — Canva"}
              </button>
            ))}
          </div>
        )}

        {/* LAUNCH CAMPAIGN PAGE */}
        {activePage === "launch" && (
          <div className="space-y-5">
            {/* Connect Google Ads */}
            <div className="p-5 border rounded-2xl" style={cardStyle}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold text-sm" style={{color: t.text}}>Kết nối Google Ads</div>
                  <div className="text-xs mt-0.5" style={{color: t.textMuted}}>Authorize để tạo campaign trực tiếp</div>
                </div>
                {adsConnected === null ? (
                  <div className="text-xs" style={{color: t.textMuted}}>Đang kiểm tra...</div>
                ) : adsConnected ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-500 font-medium">✓ Đã kết nối</span>
                    <button onClick={async()=>{ await fetch("/api/google-ads/auth?action=disconnect"); setAdsConnected(false); setAdsAccounts([]); }}
                      className="text-xs px-2 py-1 rounded-lg border" style={{color:t.textMuted,borderColor:t.border}}>Ngắt kết nối</button>
                  </div>
                ) : (
                  <a href="/api/google-ads/auth?action=connect"
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors">
                    🔗 Connect Google Ads
                  </a>
                )}
              </div>
            </div>

            {adsConnected && (
              <>
                {/* Select Account */}
                <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
                  <label className="block text-xs font-semibold uppercase tracking-wider" style={labelStyle}>Chọn tài khoản Google Ads</label>
                  {adsAccountsError ? (
                    <div className="space-y-2">
                      <div className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2 break-all">{adsAccountsError}</div>
                      <button onClick={loadAdsAccounts} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white">Thử lại</button>
                    </div>
                  ) : adsAccountsLoading ? (
                    <div className="text-xs" style={{color:t.textMuted}}>⏳ Đang tải tài khoản...</div>
                  ) : adsAccounts.length === 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="text-xs" style={{color:t.textMuted}}>Không có tài khoản nào</div>
                      <button onClick={loadAdsAccounts} className="text-xs px-2 py-1 rounded-lg border" style={{borderColor:t.border,color:t.textMuted}}>Tải lại</button>
                    </div>
                  ) : (
                    <select value={adsSelectedAccount} onChange={e=>{ setAdsSelectedAccount(e.target.value); if(e.target.value) loadAdsCampaigns(e.target.value); }}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none" style={inputStyle}>
                      <option value="">-- Chọn account --</option>
                      {adsAccounts.map(a=>(
                        <option key={a.id} value={a.id}>{a.name} ({a.id}) — {a.currency}</option>
                      ))}
                    </select>
                  )}
                </div>

                {adsSelectedAccount && (
                  <>
                    {/* Campaign Settings */}
                    <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
                      <div className="font-semibold text-sm" style={{color:t.text}}>Cấu hình Campaign</div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold mb-1.5 block" style={labelStyle}>Tên campaign</label>
                          <input value={adsCampaignName} onChange={e=>setAdsCampaignName(e.target.value)}
                            placeholder="VD: Pix Editor - VN Q1" className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                        </div>
                        <div>
                          <label className="text-xs font-semibold mb-1.5 block" style={labelStyle}>Budget/ngày (VNĐ)</label>
                          <input value={adsBudget} onChange={e=>setAdsBudget(e.target.value)} type="number"
                            placeholder="200000" className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold mb-1.5 block" style={labelStyle}>App ID</label>
                          <input value={adsAppId} onChange={e=>setAdsAppId(e.target.value)}
                            placeholder="com.apero.pixeditor" className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                        </div>
                        <div>
                          <label className="text-xs font-semibold mb-1.5 block" style={labelStyle}>Store</label>
                          <select value={adsAppStore} onChange={e=>setAdsAppStore(e.target.value as "GOOGLE_APP_STORE"|"APPLE_APP_STORE")}
                            className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}>
                            <option value="GOOGLE_APP_STORE">🤖 Google Play</option>
                            <option value="APPLE_APP_STORE">🍎 App Store</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Headlines & Descriptions */}
                    <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
                      <div className="font-semibold text-sm" style={{color:t.text}}>Ad Copy</div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold" style={labelStyle}>Headlines (tối đa 5, mỗi cái ≤30 ký tự)</label>
                        {adsHeadlines.map((h,i)=>(
                          <div key={i} className="flex gap-2 items-center">
                            <input value={h} onChange={e=>{ const arr=[...adsHeadlines]; arr[i]=e.target.value.slice(0,30); setAdsHeadlines(arr); }}
                              placeholder={`Headline ${i+1}`} className="flex-1 rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                            <span className="text-xs w-8 text-right" style={{color:t.textMuted}}>{h.length}/30</span>
                          </div>
                        ))}
                        {adsHeadlines.length < 5 && (
                          <button onClick={()=>setAdsHeadlines([...adsHeadlines,""])} className="text-xs" style={{color:"#7C3AED"}}>+ Thêm headline</button>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold" style={labelStyle}>Descriptions (tối đa 5, mỗi cái ≤90 ký tự)</label>
                        {adsDescriptions.map((d,i)=>(
                          <div key={i} className="flex gap-2 items-center">
                            <input value={d} onChange={e=>{ const arr=[...adsDescriptions]; arr[i]=e.target.value.slice(0,90); setAdsDescriptions(arr); }}
                              placeholder={`Description ${i+1}`} className="flex-1 rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                            <span className="text-xs w-8 text-right" style={{color:t.textMuted}}>{d.length}/90</span>
                          </div>
                        ))}
                        {adsDescriptions.length < 5 && (
                          <button onClick={()=>setAdsDescriptions([...adsDescriptions,""])} className="text-xs" style={{color:"#7C3AED"}}>+ Thêm description</button>
                        )}
                      </div>
                    </div>

                    {/* Select Banners from history */}
                    {previews.length > 0 && (
                      <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-sm" style={{color:t.text}}>Chọn banner để upload ({adsSelectedBanners.length} đã chọn)</div>
                          <button onClick={()=>setAdsSelectedBanners(previews.filter(p=>p.isTop5).map(p=>p.dataUrl))} className="text-xs" style={{color:"#7C3AED"}}>Chọn Top 5</button>
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          {previews.slice(0,20).map((p,i)=>{
                            const sel = adsSelectedBanners.includes(p.dataUrl);
                            return (
                              <div key={i} onClick={()=>setAdsSelectedBanners(sel ? adsSelectedBanners.filter(x=>x!==p.dataUrl) : [...adsSelectedBanners,p.dataUrl])}
                                className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${sel?"border-violet-500":"border-transparent"}`}>
                                <img src={p.dataUrl} alt={p.key} className="w-full h-16 object-contain" style={{background:"#111"}}/>
                                {sel && <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center text-white text-[9px]">✓</div>}
                                <div className="text-[9px] text-center truncate px-1 py-0.5" style={{color:t.textMuted}}>{p.key}</div>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-xs" style={{color:t.textMuted}}>💡 Gen banner ở trang Gen Banner trước rồi quay lại đây chọn</p>
                      </div>
                    )}

                    {/* Launch Button */}
                    {adsResult && (
                      <div className={`px-4 py-3 rounded-xl text-sm ${adsResult.success?"bg-green-500/10 text-green-500":"bg-red-500/10 text-red-400"}`}>
                        {adsResult.success ? `✅ ${adsResult.message}` : `❌ ${adsResult.error}`}
                      </div>
                    )}

                    <button onClick={handleAdsLaunch} disabled={adsLaunching || !adsCampaignName || !adsAppId}
                      className="w-full py-3.5 rounded-xl font-semibold text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 transition-all">
                      {adsLaunching ? "⏳ Đang tạo campaign..." : "🚀 Tạo Campaign Google Ads"}
                    </button>

                    {/* Existing Campaigns */}
                    {adsCampaigns.length > 0 && (
                      <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
                        <div className="font-semibold text-sm" style={{color:t.text}}>App Campaigns hiện có</div>
                        <div className="space-y-2">
                          {adsCampaigns.map(c=>(
                            <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-xl border" style={{borderColor:t.border}}>
                              <div>
                                <div className="text-sm font-medium" style={{color:t.text}}>{c.name}</div>
                                <div className="text-xs" style={{color:t.textMuted}}>Budget: {c.budgetPerDay.toLocaleString()}đ/ngày</div>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.status==="ENABLED"?"bg-green-500/15 text-green-500":c.status==="PAUSED"?"bg-yellow-500/15 text-yellow-500":"bg-gray-500/15 text-gray-400"}`}>
                                {c.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {!adsConnected && adsConnected !== null && (
              <div className="p-6 border rounded-2xl text-center space-y-3" style={cardStyle}>
                <div className="text-3xl">🔗</div>
                <div className="font-semibold" style={{color:t.text}}>Chưa kết nối Google Ads</div>
                <div className="text-sm" style={{color:t.textMuted}}>Bấm "Connect Google Ads" ở trên để authorize</div>
              </div>
            )}
          </div>
        )}

        {/* HISTORY PAGE */}
        {activePage === "history" && (
          <div className="space-y-4">
            {history.length === 0 ? (
              <div className="text-center py-20" style={{color: t.textMuted}}>
                <div className="text-4xl mb-3">🕐</div>
                <div className="text-sm">Chưa có lịch sử. Gen banner đầu tiên để lưu ở đây.</div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {history.map(h => (
                  <div key={h.id} className="rounded-2xl border overflow-hidden" style={cardStyle}>
                    {h.thumbnail && <img src={h.thumbnail} alt="" className="w-full object-cover" style={{height:96}}/>}
                    <div className="p-4">
                      <div className="font-semibold text-sm truncate" style={{color: t.text}}>{h.appName || "Untitled"}</div>
                      <div className="text-xs mt-0.5 mb-3" style={{color: t.textMuted}}>{h.date} · {h.count} ảnh</div>
                      <button onClick={() => deleteHistory(h.id)} className="text-xs px-2.5 py-1.5 rounded-lg border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>🗑 Xóa</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* YOUTUBE UPLOAD PAGE */}
        {activePage === "youtube" && (
          <div className="space-y-6 max-w-3xl">
            {!ytAuthenticated ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-6">
                <div className="text-6xl">▶️</div>
                <div className="text-center">
                  <div className="text-xl font-bold mb-2" style={{color: t.text}}>Upload video lên YouTube</div>
                  <div className="text-sm" style={{color: t.textMuted}}>Đăng nhập Google để bắt đầu upload hàng loạt</div>
                </div>
                <a href="/api/auth/google"
                  className="flex items-center gap-3 px-6 py-3 rounded-xl font-semibold text-sm transition-all border"
                  style={{backgroundColor: t.card, borderColor: t.border, color: t.text, boxShadow: t.cardShadow}}>
                  <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                  Đăng nhập với Google
                </a>
                <p className="text-xs text-center" style={{color: t.textMuted}}>Chỉ cấp quyền upload video lên YouTube của bạn</p>
              </div>
            ) : (
              <>
                {/* Top bar */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>
                    <span className="text-sm" style={{color: t.textMuted}}>Đã kết nối Google</span>
                  </div>
                  <button onClick={ytLogout} className="text-xs px-3 py-1.5 rounded-lg border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>
                    Đăng xuất
                  </button>
                </div>

                {/* Drop zone */}
                <div onClick={() => ytFileRef.current?.click()}
                  className="border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all"
                  style={{borderColor: t.border}}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#7C3AED")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = t.border)}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#7C3AED"; }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = t.border; if (e.dataTransfer.files.length) addYtFiles(e.dataTransfer.files); }}>
                  <div className="text-3xl mb-2">🎬</div>
                  <div className="text-sm font-medium mb-1" style={{color: t.text}}>Kéo thả video vào đây hoặc click để chọn</div>
                  <div className="text-xs" style={{color: t.textMuted}}>MP4, MOV, AVI, MKV — nhiều file cùng lúc</div>
                  <input ref={ytFileRef} type="file" accept="video/*" multiple className="hidden" onChange={e => e.target.files && addYtFiles(e.target.files)}/>
                </div>

                {/* Video list */}
                {ytVideos.length > 0 && (
                  <div className="space-y-3">
                    {ytVideos.map((v, i) => (
                      <div key={i} className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                        <div className="flex items-center gap-3">
                          <div className="text-2xl flex-shrink-0">🎬</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate" style={{color: t.text}}>{v.title || v.file.name}</div>
                            <div className="text-xs" style={{color: t.textMuted}}>{(v.file.size/1024/1024).toFixed(1)} MB</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {v.status === "done" && <span className="text-xs font-bold text-green-400">✓ Done</span>}
                            {v.status === "done" && v.videoId && (
                              ytCopiedIndex === i ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs px-2 py-1 rounded-lg border font-medium"
                                    style={{borderColor:"#6D28D9",color:"#A78BFA",backgroundColor:"#6D28D922",
                                      animation:"popIn 0.2s ease-out"}}>
                                    ✓ Đã copy!
                                  </span>
                                  <button onClick={() => setYtCopiedIndex(null)}
                                    className="text-xs px-1.5 py-1 rounded-lg border transition-all hover:bg-slate-100"
                                    style={{borderColor:t.border,color:t.textMuted}}
                                    title="Reset">↺</button>
                                </div>
                              ) : (
                                <button onClick={() => {
                                  const url = `https://youtu.be/${v.videoId}`;
                                  try { navigator.clipboard.writeText(url); } catch { /* fallback */ }
                                  setYtCopiedIndex(i);
                                }}
                                  className="text-xs px-2 py-1 rounded-lg border transition-all duration-150 active:scale-95"
                                  style={{borderColor:"#10B981",color:"#10B981",backgroundColor:"#10B98111"}}
                                  title={`https://youtu.be/${v.videoId}`}>
                                  🔗 Copy link
                                </button>
                              )
                            )}
                            {v.status === "error" && <span className="text-xs font-bold text-red-400">✗ Lỗi</span>}
                            {v.status === "uploading" && <span className="text-xs" style={{color: t.textMuted}}>{v.progress}%</span>}
                            {v.status !== "uploading" && (
                              <button onClick={() => setYtVideos(prev => prev.filter((_, j) => j !== i))}
                                className="text-xs px-2 py-1 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>✕</button>
                            )}
                          </div>
                        </div>

                        {/* Progress bar */}
                        {v.status === "uploading" && (
                          <div className="h-1.5 rounded-full overflow-hidden" style={{backgroundColor: t.progress}}>
                            <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-300" style={{width: `${v.progress}%`}}/>
                          </div>
                        )}
                        {v.status === "error" && <div className="text-xs text-red-400">{v.errorMsg}</div>}

                        {/* Metadata */}
                        {(v.status === "idle" || v.status === "error") && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="col-span-2">
                              <input value={v.title} onChange={e => setYtVideos(prev => prev.map((x,j)=>j===i?{...x,title:e.target.value}:x))}
                                placeholder="Tiêu đề video *"
                                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500"
                                style={inputStyle}/>
                            </div>
                            <div className="col-span-2">
                              <textarea value={v.description} onChange={e => setYtVideos(prev => prev.map((x,j)=>j===i?{...x,description:e.target.value}:x))}
                                placeholder="Mô tả (tuỳ chọn)" rows={2}
                                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-none"
                                style={inputStyle}/>
                            </div>
                            <div>
                              <input value={v.tags} onChange={e => setYtVideos(prev => prev.map((x,j)=>j===i?{...x,tags:e.target.value}:x))}
                                placeholder="Tags (cách nhau bởi dấu phẩy)"
                                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500"
                                style={inputStyle}/>
                            </div>
                            <div>
                              <select value={v.privacy} onChange={e => setYtVideos(prev => prev.map((x,j)=>j===i?{...x,privacy:e.target.value as "public"|"unlisted"|"private"}:x))}
                                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500"
                                style={inputStyle}>
                                <option value="unlisted">🔗 Unlisted (có link xem được)</option>
                                <option value="private">🔒 Private (chỉ mình tôi)</option>
                                <option value="public">🌍 Public (công khai)</option>
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Upload button */}
                    <div className="flex gap-3">
                      <button onClick={handleYtUploadAll}
                        disabled={ytUploading || ytVideos.every(v => v.status === "done")}
                        className="flex-1 py-3 rounded-xl font-semibold text-sm bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white flex items-center justify-center gap-2">
                        {ytUploading
                          ? <><span className="animate-spin">⏳</span> Đang upload {ytVideos.filter(v=>v.status==="uploading").length > 0 ? `(${ytVideos.filter(v=>v.status==="uploading")[0]?.progress}%)` : ""}...</>
                          : <>▶️ Upload {ytVideos.filter(v=>v.status==="idle"||v.status==="error").length} video lên YouTube</>}
                      </button>
                      <button onClick={() => setYtVideos([])} disabled={ytUploading}
                        className="px-4 py-3 rounded-xl border text-sm transition-colors disabled:opacity-40"
                        style={{borderColor: t.border, color: t.textMuted}}>
                        Xóa tất cả
                      </button>
                    </div>

                    {/* Summary */}
                    {ytVideos.some(v => v.status === "done") && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        ✓ {ytVideos.filter(v=>v.status==="done").length}/{ytVideos.length} video đã upload thành công
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </main>

      {/* LOCALIZE PAGE */}
      {activePage === "localize" && (
        <div className="space-y-6 max-w-5xl">
          {/* Input Section */}
          <div className="rounded-2xl border p-6 space-y-5" style={{...cardStyle}}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center text-lg">🌏</div>
              <div>
                <div className="font-bold text-sm" style={{color: t.text}}>Multi-market Ad Copy Localizer</div>
                <div className="text-xs" style={{color: t.textMuted}}>Dịch ad copy sang nhiều thị trường cùng lúc, tối ưu cho Google App Campaigns</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{color: t.textSub}}>Tên App *</label>
                <input
                  value={lcAppName} onChange={e => setLcAppName(e.target.value)}
                  placeholder="VD: Photo Editor Pro"
                  className="w-full px-3 py-2.5 rounded-xl text-sm border outline-none"
                  style={{backgroundColor: t.input, borderColor: t.inputBorder, color: t.text}}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{color: t.textSub}}>Ngôn ngữ nguồn</label>
                <select
                  value={lcSourceLang} onChange={e => setLcSourceLang(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm border outline-none"
                  style={{backgroundColor: t.input, borderColor: t.inputBorder, color: t.text}}>
                  {["English","Vietnamese","Indonesian","Thai","Korean","Japanese","Chinese Simplified"].map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 flex items-center justify-between" style={{color: t.textSub}}>
                  <span>Headlines <span className="font-normal">(mỗi dòng 1 headline)</span></span>
                  <span className="text-[10px]" style={{color: t.textMuted}}>≤30 ký tự/cái</span>
                </label>
                <textarea
                  value={lcHeadlines} onChange={e => setLcHeadlines(e.target.value)}
                  rows={4} placeholder={"Download now and explore\nBoost your productivity\nTry it free today"}
                  className="w-full px-3 py-2.5 rounded-xl text-sm border outline-none resize-none"
                  style={{backgroundColor: t.input, borderColor: t.inputBorder, color: t.text}}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 flex items-center justify-between" style={{color: t.textSub}}>
                  <span>Descriptions</span>
                  <span className="text-[10px]" style={{color: t.textMuted}}>≤90 ký tự/cái</span>
                </label>
                <textarea
                  value={lcDescriptions} onChange={e => setLcDescriptions(e.target.value)}
                  rows={4} placeholder={"The best app for your daily tasks\nMillions of users trust us every day"}
                  className="w-full px-3 py-2.5 rounded-xl text-sm border outline-none resize-none"
                  style={{backgroundColor: t.input, borderColor: t.inputBorder, color: t.text}}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 flex items-center justify-between" style={{color: t.textSub}}>
                  <span>CTAs</span>
                  <span className="text-[10px]" style={{color: t.textMuted}}>≤15 ký tự/cái</span>
                </label>
                <textarea
                  value={lcCtas} onChange={e => setLcCtas(e.target.value)}
                  rows={4} placeholder={"Install Free\nDownload Now\nGet Started"}
                  className="w-full px-3 py-2.5 rounded-xl text-sm border outline-none resize-none"
                  style={{backgroundColor: t.input, borderColor: t.inputBorder, color: t.text}}
                />
              </div>
            </div>

            {/* Market selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold" style={{color: t.textSub}}>Chọn thị trường ({lcMarkets.length}/{LOCALIZE_MARKETS.length})</label>
                <div className="flex gap-2">
                  <button onClick={lcSelectAll} className="text-xs px-2 py-1 rounded-lg border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>Tất cả</button>
                  <button onClick={lcSelectNone} className="text-xs px-2 py-1 rounded-lg border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>Bỏ chọn</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {LOCALIZE_MARKETS.map(m => {
                  const selected = lcMarkets.includes(m.code);
                  return (
                    <button key={m.code} onClick={() => lcToggleMarket(m.code)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all"
                      style={selected
                        ? {backgroundColor: "#7C3AED22", borderColor: "#7C3AED", color: "#A78BFA"}
                        : {backgroundColor: t.tabBg, borderColor: t.border, color: t.textMuted}}>
                      <span>{m.flag}</span> {m.code}
                    </button>
                  );
                })}
              </div>
            </div>

            {lcError && <div className="text-xs px-4 py-2.5 rounded-xl" style={{backgroundColor: "#EF444420", color: "#EF4444"}}>{lcError}</div>}

            <button
              onClick={handleLocalize}
              disabled={lcLoading || !lcAppName.trim() || lcMarkets.length === 0}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              style={{backgroundColor: "#7C3AED", color: "white"}}>
              {lcLoading ? "⏳ Đang dịch..." : `🌏 Dịch sang ${lcMarkets.length} thị trường`}
            </button>
          </div>

          {/* Results */}
          {lcResults && lcResults.length > 0 && (
            <div className="rounded-2xl border p-6 space-y-4" style={{...cardStyle}}>
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm" style={{color: t.text}}>Kết quả — {lcResults.length} thị trường</div>
                <button
                  onClick={lcCopyAll}
                  className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors"
                  style={{borderColor: t.border, color: lcCopied==="all" ? "#10B981" : t.textMuted}}>
                  {lcCopied==="all" ? "✓ Đã copy" : "📋 Copy tất cả"}
                </button>
              </div>

              {/* Market tabs */}
              <div className="flex flex-wrap gap-2">
                {lcResults.map(m => (
                  <button key={m.code} onClick={() => setLcActiveMarket(m.code)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all"
                    style={lcActiveMarket===m.code
                      ? {backgroundColor: "#7C3AED22", borderColor: "#7C3AED", color: "#A78BFA"}
                      : {backgroundColor: t.tabBg, borderColor: t.border, color: t.textMuted}}>
                    <span>{m.flag}</span> {m.code}
                  </button>
                ))}
              </div>

              {/* Active market detail */}
              {lcActiveMarket && (() => {
                const m = lcResults.find(r => r.code === lcActiveMarket);
                if (!m) return null;
                return (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{m.flag}</span>
                        <div>
                          <div className="font-semibold text-sm" style={{color: t.text}}>{m.name}</div>
                          <div className="text-xs" style={{color: t.textMuted}}>{m.language}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => lcCopyAllForMarket(m)}
                        className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                        style={{borderColor: t.border, color: lcCopied===`all-${m.code}` ? "#10B981" : t.textMuted}}>
                        {lcCopied===`all-${m.code}` ? "✓ Đã copy" : "📋 Copy market này"}
                      </button>
                    </div>

                    {/* Headlines */}
                    <div className="rounded-xl border p-4 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                      <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{color: t.textMuted}}>Headlines <span className="font-normal normal-case">(≤30 ký tự)</span></div>
                      {m.headlines.map((h, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg" style={{backgroundColor: t.card}}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] w-4 flex-shrink-0" style={{color: t.textMuted}}>{i+1}.</span>
                            <span className="text-sm font-medium truncate" style={{color: t.text}}>{h}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px]" style={{color: h.length > 30 ? "#EF4444" : t.textMuted}}>{h.length}/30</span>
                            <button onClick={() => lcCopyText(h, `h-${m.code}-${i}`)} className="text-xs px-2 py-0.5 rounded transition-colors" style={{backgroundColor: lcCopied===`h-${m.code}-${i}` ? "#10B98122" : t.tabBg, color: lcCopied===`h-${m.code}-${i}` ? "#10B981" : t.textMuted}}>
                              {lcCopied===`h-${m.code}-${i}` ? "✓" : "copy"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Descriptions */}
                    <div className="rounded-xl border p-4 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                      <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{color: t.textMuted}}>Descriptions <span className="font-normal normal-case">(≤90 ký tự)</span></div>
                      {m.descriptions.map((d, i) => (
                        <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg" style={{backgroundColor: t.card}}>
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="text-[10px] w-4 flex-shrink-0 mt-0.5" style={{color: t.textMuted}}>{i+1}.</span>
                            <span className="text-sm" style={{color: t.text}}>{d}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px]" style={{color: d.length > 90 ? "#EF4444" : t.textMuted}}>{d.length}/90</span>
                            <button onClick={() => lcCopyText(d, `d-${m.code}-${i}`)} className="text-xs px-2 py-0.5 rounded transition-colors" style={{backgroundColor: lcCopied===`d-${m.code}-${i}` ? "#10B98122" : t.tabBg, color: lcCopied===`d-${m.code}-${i}` ? "#10B981" : t.textMuted}}>
                              {lcCopied===`d-${m.code}-${i}` ? "✓" : "copy"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* CTAs */}
                    <div className="rounded-xl border p-4 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                      <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{color: t.textMuted}}>CTAs <span className="font-normal normal-case">(≤15 ký tự)</span></div>
                      <div className="flex flex-wrap gap-2">
                        {m.ctas.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border" style={{backgroundColor: t.card, borderColor: t.border}}>
                            <span className="text-sm font-medium" style={{color: t.text}}>{c}</span>
                            <span className="text-[10px]" style={{color: c.length > 15 ? "#EF4444" : t.textMuted}}>{c.length}/15</span>
                            <button onClick={() => lcCopyText(c, `c-${m.code}-${i}`)} className="text-xs px-1.5 py-0.5 rounded transition-colors" style={{backgroundColor: lcCopied===`c-${m.code}-${i}` ? "#10B98122" : t.tabBg, color: lcCopied===`c-${m.code}-${i}` ? "#10B981" : t.textMuted}}>
                              {lcCopied===`c-${m.code}-${i}` ? "✓" : "copy"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* All markets summary table */}
              <div className="mt-4">
                <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{color: t.textMuted}}>Tổng quan tất cả thị trường</div>
                <div className="overflow-x-auto rounded-xl border" style={{borderColor: t.border}}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{backgroundColor: t.tabBg}}>
                        <th className="text-left px-3 py-2.5 font-semibold" style={{color: t.textSub}}>Thị trường</th>
                        <th className="text-left px-3 py-2.5 font-semibold" style={{color: t.textSub}}>Headline #1</th>
                        <th className="text-left px-3 py-2.5 font-semibold" style={{color: t.textSub}}>Description #1</th>
                        <th className="text-left px-3 py-2.5 font-semibold" style={{color: t.textSub}}>CTA #1</th>
                        <th className="px-3 py-2.5"/>
                      </tr>
                    </thead>
                    <tbody>
                      {lcResults.map((m, idx) => (
                        <tr key={m.code}
                          onClick={() => setLcActiveMarket(m.code)}
                          className="cursor-pointer transition-colors"
                          style={{backgroundColor: lcActiveMarket===m.code ? "#7C3AED11" : idx%2===0 ? t.card : t.tabBg, borderTop: `1px solid ${t.border}`}}>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span>{m.flag}</span>
                              <span className="font-medium" style={{color: t.text}}>{m.code}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 max-w-[160px] truncate" style={{color: t.textSub}}>{m.headlines[0]}</td>
                          <td className="px-3 py-2.5 max-w-[200px] truncate" style={{color: t.textSub}}>{m.descriptions[0]}</td>
                          <td className="px-3 py-2.5" style={{color: t.textSub}}>{m.ctas[0]}</td>
                          <td className="px-3 py-2.5">
                            <button onClick={e => { e.stopPropagation(); lcCopyAllForMarket(m); }}
                              className="text-[10px] px-2 py-0.5 rounded transition-colors"
                              style={{backgroundColor: lcCopied===`all-${m.code}` ? "#10B98122" : t.tabBg, color: lcCopied===`all-${m.code}` ? "#10B981" : t.textMuted}}>
                              {lcCopied===`all-${m.code}` ? "✓" : "copy"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Frame Lightbox */}
      {lightboxFrame && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={()=>setLightboxFrame(null)}>
          <div className="relative max-w-4xl w-full" onClick={e=>e.stopPropagation()}>
            <button onClick={()=>setLightboxFrame(null)} className="absolute -top-10 right-0 text-white/70 hover:text-white text-2xl">✕</button>
            <img src={lightboxFrame} alt="Frame preview" className="w-full rounded-xl shadow-2xl" style={{maxHeight:"80vh",objectFit:"contain"}}/>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {selectedPreview && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={()=>setSelectedPreview(null)}>
          <div className="rounded-2xl p-6 max-w-3xl w-full space-y-4 border" style={{...cardStyle, boxShadow:"0 25px 80px rgba(0,0,0,0.4)"}} onClick={e=>e.stopPropagation()}>
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
      </div>{/* end inner flex */}
    </div>
  );
}
