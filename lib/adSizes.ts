export interface AdSize {
  key: string;
  width: number;
  height: number;
  label: string;
  isTop5: boolean;
  group: "landscape" | "square" | "portrait";
}

// Google UAC (App Install) — 5 kích thước chuẩn, mỗi loại khác nhau thật sự
export const AD_SIZES: AdSize[] = [
  { key: "1200x628",  width: 1200, height: 628,  label: "Landscape 1.91:1",  isTop5: true, group: "landscape" }, // Banner ngang chuẩn
  { key: "1200x1200", width: 1200, height: 1200, label: "Square 1:1",        isTop5: true, group: "square"    }, // Vuông
  { key: "1080x1920", width: 1080, height: 1920, label: "Portrait 9:16",     isTop5: true, group: "portrait"  }, // Dọc full
  { key: "960x1200",  width: 960,  height: 1200, label: "Portrait 4:5",      isTop5: true, group: "portrait"  }, // Dọc 4:5 (Facebook/Instagram)
  { key: "300x250",   width: 300,  height: 250,  label: "Rectangle 300×250", isTop5: true, group: "square"    }, // Banner hình chữ nhật phổ biến
];

export const TOP5 = AD_SIZES.filter(s => s.isTop5);
export const ALL_SIZES = AD_SIZES;
