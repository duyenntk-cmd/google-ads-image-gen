// The 3 ratios gpt-image-1 can generate natively.
export type RatioKey = "portrait" | "square" | "landscape";

export interface GenSize {
  key: RatioKey;
  size: string; // gpt-image-1 accepted size string
  label: string;
}

// gpt-image-1 only supports these three sizes. Everything else is resized client-side.
export const GEN_SIZES: GenSize[] = [
  { key: "portrait", size: "1024x1536", label: "9:16 Portrait" },
  { key: "square", size: "1024x1024", label: "1:1 Square" },
  { key: "landscape", size: "1536x1024", label: "16:9 Landscape" },
];

export interface AdSize {
  key: string;
  width: number;
  height: number;
  type: RatioKey;
  usage: string;
  // Legacy aliases kept for canvasGen.ts compatibility
  group: RatioKey;
  label: string;
  isTop5: boolean;
}

// 20 standard Google Ads output sizes (UAC + Display Network).
export const AD_SIZES: AdSize[] = [
  // UAC (Universal App Campaigns) — required for app-install
  { key: "1200x628",  width: 1200, height: 628,  type: "landscape", usage: "UAC Landscape",         group: "landscape", label: "Landscape 1.91:1",      isTop5: true  },
  { key: "1200x1200", width: 1200, height: 1200, type: "square",    usage: "UAC Square",            group: "square",    label: "Square 1:1",            isTop5: true  },
  { key: "1080x1920", width: 1080, height: 1920, type: "portrait",  usage: "UAC Stories",           group: "portrait",  label: "Portrait 9:16",         isTop5: true  },
  // Display — Rectangles
  { key: "300x250",   width: 300,  height: 250,  type: "square",    usage: "Medium Rectangle",      group: "square",    label: "Rectangle 300×250",     isTop5: true  },
  { key: "336x280",   width: 336,  height: 280,  type: "square",    usage: "Large Rectangle",       group: "square",    label: "Rectangle 336×280",     isTop5: false },
  { key: "250x250",   width: 250,  height: 250,  type: "square",    usage: "Square",                group: "square",    label: "Square 250×250",        isTop5: false },
  { key: "200x200",   width: 200,  height: 200,  type: "square",    usage: "Small Square",          group: "square",    label: "Small Square 200×200",  isTop5: false },
  // Display — Leaderboards & Banners
  { key: "728x90",    width: 728,  height: 90,   type: "landscape", usage: "Leaderboard",           group: "landscape", label: "Leaderboard 728×90",    isTop5: false },
  { key: "970x250",   width: 970,  height: 250,  type: "landscape", usage: "Billboard",             group: "landscape", label: "Billboard 970×250",     isTop5: false },
  { key: "970x90",    width: 970,  height: 90,   type: "landscape", usage: "Large Leaderboard",     group: "landscape", label: "Lg Leaderboard 970×90", isTop5: false },
  { key: "930x180",   width: 930,  height: 180,  type: "landscape", usage: "Top Banner",            group: "landscape", label: "Top Banner 930×180",    isTop5: false },
  { key: "468x60",    width: 468,  height: 60,   type: "landscape", usage: "Banner",                group: "landscape", label: "Banner 468×60",         isTop5: false },
  { key: "980x120",   width: 980,  height: 120,  type: "landscape", usage: "Panorama",              group: "landscape", label: "Panorama 980×120",      isTop5: false },
  // Display — Skyscrapers
  { key: "160x600",   width: 160,  height: 600,  type: "portrait",  usage: "Wide Skyscraper",       group: "portrait",  label: "Wide Sky 160×600",      isTop5: false },
  { key: "120x600",   width: 120,  height: 600,  type: "portrait",  usage: "Skyscraper",            group: "portrait",  label: "Skyscraper 120×600",    isTop5: false },
  { key: "300x600",   width: 300,  height: 600,  type: "portrait",  usage: "Half Page",             group: "portrait",  label: "Half Page 300×600",     isTop5: false },
  { key: "300x1050",  width: 300,  height: 1050, type: "portrait",  usage: "Portrait",              group: "portrait",  label: "Portrait 300×1050",     isTop5: false },
  // Display — Mobile
  { key: "320x50",    width: 320,  height: 50,   type: "landscape", usage: "Mobile Banner",         group: "landscape", label: "Mobile Banner 320×50",  isTop5: true  },
  { key: "320x100",   width: 320,  height: 100,  type: "landscape", usage: "Large Mobile Banner",   group: "landscape", label: "Lg Mobile 320×100",     isTop5: false },
  { key: "300x50",    width: 300,  height: 50,   type: "landscape", usage: "Mobile Banner Alt",     group: "landscape", label: "Mobile Banner 300×50",  isTop5: false },
];

// Pick the best base ratio for a target output size, based on its aspect ratio.
export function pickBaseRatio(width: number, height: number): RatioKey {
  const ratio = width / height;
  if (ratio >= 1.5) return "landscape";
  if (ratio <= 0.75) return "portrait";
  return "square";
}
