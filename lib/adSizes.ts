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

// 8 standard Google Ads output sizes (3 AI-native + 5 resized).
export const AD_SIZES: AdSize[] = [
  { key: "1200x628",  width: 1200, height: 628,  type: "landscape", usage: "Google UAC + Display",   group: "landscape", label: "Landscape 1.91:1",   isTop5: true },
  { key: "1200x1200", width: 1200, height: 1200, type: "square",    usage: "Google UAC + Display",   group: "square",    label: "Square 1:1",         isTop5: true },
  { key: "1080x1920", width: 1080, height: 1920, type: "portrait",  usage: "Google UAC Stories",     group: "portrait",  label: "Portrait 9:16",      isTop5: true },
  { key: "300x250",   width: 300,  height: 250,  type: "square",    usage: "Display (most common)",  group: "square",    label: "Rectangle 300×250",  isTop5: true },
  { key: "336x280",   width: 336,  height: 280,  type: "square",    usage: "Display",                group: "square",    label: "Rectangle 336×280",  isTop5: false },
  { key: "728x90",    width: 728,  height: 90,   type: "landscape", usage: "Leaderboard",            group: "landscape", label: "Leaderboard 728×90", isTop5: false },
  { key: "300x600",   width: 300,  height: 600,  type: "portrait",  usage: "Half Page",              group: "portrait",  label: "Half Page 300×600",  isTop5: false },
  { key: "320x50",    width: 320,  height: 50,   type: "landscape", usage: "Mobile Banner",          group: "landscape", label: "Mobile Banner 320×50", isTop5: false },
];

// Pick the best base ratio for a target output size, based on its aspect ratio.
export function pickBaseRatio(width: number, height: number): RatioKey {
  const ratio = width / height;
  if (ratio >= 1.5) return "landscape";
  if (ratio <= 0.75) return "portrait";
  return "square";
}
