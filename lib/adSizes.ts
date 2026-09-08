export interface AdSize {
  key: string;
  width: number;
  height: number;
  label: string;
  isTop5: boolean;
  group: "landscape" | "square" | "portrait";
}

// Google Ads standard sizes — 3 UAC + 5 Display Network
export const AD_SIZES: AdSize[] = [
  // UAC (App Campaign) — AI generated directly
  { key: "1200x628",  width: 1200, height: 628,  label: "Landscape 1.91:1",   isTop5: true, group: "landscape" },
  { key: "1200x1200", width: 1200, height: 1200, label: "Square 1:1",         isTop5: true, group: "square"    },
  { key: "1080x1920", width: 1080, height: 1920, label: "Portrait 9:16",      isTop5: true, group: "portrait"  },
  // Display Network — resized from UAC images
  { key: "300x250",   width: 300,  height: 250,  label: "Rectangle 300×250",  isTop5: true, group: "square"    },
  { key: "336x280",   width: 336,  height: 280,  label: "Rectangle 336×280",  isTop5: true, group: "square"    },
  { key: "728x90",    width: 728,  height: 90,   label: "Leaderboard 728×90", isTop5: true, group: "landscape" },
  { key: "300x600",   width: 300,  height: 600,  label: "Half Page 300×600",  isTop5: true, group: "portrait"  },
  { key: "320x50",    width: 320,  height: 50,   label: "Mobile Banner 320×50", isTop5: true, group: "landscape" },
];

export const TOP5 = AD_SIZES.filter(s => s.isTop5);
export const ALL_SIZES = AD_SIZES;
