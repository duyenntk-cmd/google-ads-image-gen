/**
 * Google ad template conventions on MKT System (Google++), shared by the web
 * page's logic and the Claude connector.
 *
 *   Ad Template <day> Gen<n> <market>   e.g. "Ad Template 20261005 Gen1 US"
 *
 * Creatives of the same batch carry the tags "<day> Gen<n>" and "<market>", so
 * Google++ matches them to the template by name. Google++ compares names
 * ignoring case, spaces, "_" and "[ ]"; two templates that match that way make
 * the mapping "Ambiguous". The Gen is the day's highest Gen already on MKT + 1.
 */

/** Market (ISO code) → its name and the language ads there are written in. */
export const MARKETS: Record<string, { name: string; language: string }> = {
  VN: { name: "Vietnam", language: "Vietnamese" },
  ID: { name: "Indonesia", language: "Indonesian" },
  TH: { name: "Thailand", language: "Thai" },
  PH: { name: "Philippines", language: "Filipino (Tagalog)" },
  MY: { name: "Malaysia", language: "Malay" },
  SG: { name: "Singapore", language: "English" },
  MM: { name: "Myanmar", language: "Burmese" },
  KH: { name: "Cambodia", language: "Khmer" },
  JP: { name: "Japan", language: "Japanese" },
  KR: { name: "South Korea", language: "Korean" },
  CN: { name: "China", language: "Simplified Chinese" },
  TW: { name: "Taiwan", language: "Traditional Chinese" },
  HK: { name: "Hong Kong", language: "Traditional Chinese" },
  IN: { name: "India", language: "Hindi" },
  PK: { name: "Pakistan", language: "Urdu" },
  BD: { name: "Bangladesh", language: "Bengali" },
  LK: { name: "Sri Lanka", language: "Sinhala" },
  SA: { name: "Saudi Arabia", language: "Arabic" },
  AE: { name: "UAE", language: "Arabic" },
  EG: { name: "Egypt", language: "Arabic" },
  IQ: { name: "Iraq", language: "Arabic" },
  TR: { name: "Turkey", language: "Turkish" },
  IL: { name: "Israel", language: "Hebrew" },
  US: { name: "United States", language: "English" },
  CA: { name: "Canada", language: "English" },
  GB: { name: "United Kingdom", language: "English" },
  AU: { name: "Australia", language: "English" },
  MX: { name: "Mexico", language: "Spanish" },
  BR: { name: "Brazil", language: "Portuguese (BR)" },
  AR: { name: "Argentina", language: "Spanish" },
  CO: { name: "Colombia", language: "Spanish" },
  CL: { name: "Chile", language: "Spanish" },
  PE: { name: "Peru", language: "Spanish" },
  DE: { name: "Germany", language: "German" },
  FR: { name: "France", language: "French" },
  IT: { name: "Italy", language: "Italian" },
  ES: { name: "Spain", language: "Spanish" },
  PT: { name: "Portugal", language: "Portuguese" },
  NL: { name: "Netherlands", language: "Dutch" },
  PL: { name: "Poland", language: "Polish" },
  RU: { name: "Russia", language: "Russian" },
  UA: { name: "Ukraine", language: "Ukrainian" },
  NG: { name: "Nigeria", language: "English" },
  ZA: { name: "South Africa", language: "English" },
  GLOBAL: { name: "Global", language: "English" },
};

/** "vn", "Vietnam", "VN" → "VN"; unknown → the input upper-cased. */
export function marketCode(m: string): string {
  const s = String(m || "").trim();
  const up = s.toUpperCase();
  if (MARKETS[up]) return up;
  const hit = Object.entries(MARKETS).find(([, v]) => v.name.toLowerCase() === s.toLowerCase());
  return hit ? hit[0] : up;
}

/** Today as 20261005 in Vietnam time — the team's working day, whatever the server's zone. */
export function todayVN(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).replace(/-/g, "");
}

export const normTplName = (s: string) => s.toLowerCase().replace(/[\s_[\]]/g, "");

export const templateName = (date: string, gen: number, market: string) => `Ad Template ${date} Gen${gen} ${market}`;

/** Gen number in any spelling of a template name for that day, or 0. */
export function genOf(name: string, date: string): number {
  const m = /^(?:adtemplate)?(\d{8})gen(\d+)/.exec(normTplName(name || ""));
  return m && m[1] === date ? Number(m[2]) : 0;
}
