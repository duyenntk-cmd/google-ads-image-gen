export interface AdSize {
  key: string;
  width: number;
  height: number;
  label: string;
  isTop5: boolean;
  group: "landscape" | "square" | "portrait";
}

// Google UAC (App Install) - tối đa 20 ảnh, 3 tỉ lệ: landscape 1.91:1 | square 1:1 | portrait 9:16
export const AD_SIZES: AdSize[] = [
  // Landscape 1.91:1 (7 ảnh)
  { key: "1200x628",   width: 1200, height: 628,  label: "Landscape Standard",  isTop5: true,  group: "landscape" },
  { key: "1200x628_2", width: 1200, height: 628,  label: "Landscape Variant 2", isTop5: false, group: "landscape" },
  { key: "1200x628_3", width: 1200, height: 628,  label: "Landscape Variant 3", isTop5: false, group: "landscape" },
  { key: "1200x628_4", width: 1200, height: 628,  label: "Landscape Variant 4", isTop5: false, group: "landscape" },
  { key: "1200x628_5", width: 1200, height: 628,  label: "Landscape Variant 5", isTop5: false, group: "landscape" },
  { key: "1200x628_6", width: 1200, height: 628,  label: "Landscape Variant 6", isTop5: false, group: "landscape" },
  { key: "1200x628_7", width: 1200, height: 628,  label: "Landscape Variant 7", isTop5: false, group: "landscape" },
  // Square 1:1 (7 ảnh)
  { key: "1200x1200",   width: 1200, height: 1200, label: "Square Standard",     isTop5: true,  group: "square" },
  { key: "1200x1200_2", width: 1200, height: 1200, label: "Square Variant 2",    isTop5: false, group: "square" },
  { key: "1200x1200_3", width: 1200, height: 1200, label: "Square Variant 3",    isTop5: false, group: "square" },
  { key: "1200x1200_4", width: 1200, height: 1200, label: "Square Variant 4",    isTop5: false, group: "square" },
  { key: "1200x1200_5", width: 1200, height: 1200, label: "Square Variant 5",    isTop5: false, group: "square" },
  { key: "1200x1200_6", width: 1200, height: 1200, label: "Square Variant 6",    isTop5: false, group: "square" },
  { key: "1200x1200_7", width: 1200, height: 1200, label: "Square Variant 7",    isTop5: false, group: "square" },
  // Portrait 9:16 (6 ảnh)
  { key: "1080x1920",   width: 1080, height: 1920, label: "Portrait Standard",   isTop5: true,  group: "portrait" },
  { key: "1080x1920_2", width: 1080, height: 1920, label: "Portrait Variant 2",  isTop5: false, group: "portrait" },
  { key: "1080x1920_3", width: 1080, height: 1920, label: "Portrait Variant 3",  isTop5: false, group: "portrait" },
  { key: "1080x1920_4", width: 1080, height: 1920, label: "Portrait Variant 4",  isTop5: false, group: "portrait" },
  { key: "1080x1920_5", width: 1080, height: 1920, label: "Portrait Variant 5",  isTop5: false, group: "portrait" },
  { key: "1080x1920_6", width: 1080, height: 1920, label: "Portrait Variant 6",  isTop5: false, group: "portrait" },
];

export const TOP5 = AD_SIZES.filter(s => s.isTop5);
export const ALL_SIZES = AD_SIZES;
