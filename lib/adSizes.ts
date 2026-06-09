export interface AdSize {
  key: string;
  width: number;
  height: number;
  label: string;
  isTop5: boolean;
  group: "rectangle" | "square" | "mobile" | "leaderboard" | "skyscraper";
}

export const AD_SIZES: AdSize[] = [
  // Top 5
  { key: "300x250", width: 300, height: 250, label: "Medium Rectangle", isTop5: true, group: "rectangle" },
  { key: "728x90",  width: 728, height: 90,  label: "Leaderboard",      isTop5: true, group: "leaderboard" },
  { key: "300x600", width: 300, height: 600, label: "Half Page",        isTop5: true, group: "rectangle" },
  { key: "320x50",  width: 320, height: 50,  label: "Mobile Banner",    isTop5: true, group: "mobile" },
  { key: "320x100", width: 320, height: 100, label: "Large Mobile",     isTop5: true, group: "mobile" },
  // Extended
  { key: "336x280", width: 336, height: 280, label: "Large Rectangle",  isTop5: false, group: "rectangle" },
  { key: "250x250", width: 250, height: 250, label: "Square",           isTop5: false, group: "square" },
  { key: "200x200", width: 200, height: 200, label: "Small Square",     isTop5: false, group: "square" },
  { key: "160x600", width: 160, height: 600, label: "Wide Skyscraper",  isTop5: false, group: "skyscraper" },
  { key: "970x90",  width: 970, height: 90,  label: "Large Leaderboard",isTop5: false, group: "leaderboard" },
  { key: "970x250", width: 970, height: 250, label: "Billboard",        isTop5: false, group: "leaderboard" },
];

export const TOP5 = AD_SIZES.filter(s => s.isTop5);
export const ALL_SIZES = AD_SIZES;
