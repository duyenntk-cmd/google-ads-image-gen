import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/apiAuth";

export const maxDuration = 60;

const client = new Anthropic();

const MARKETS = [
  { code: "VN", name: "Vietnam",      language: "Vietnamese",         flag: "🇻🇳" },
  { code: "ID", name: "Indonesia",    language: "Indonesian",          flag: "🇮🇩" },
  { code: "TH", name: "Thailand",     language: "Thai",                flag: "🇹🇭" },
  { code: "PH", name: "Philippines",  language: "Filipino (Tagalog)",  flag: "🇵🇭" },
  { code: "MY", name: "Malaysia",     language: "Malay",               flag: "🇲🇾" },
  { code: "SG", name: "Singapore",    language: "English",             flag: "🇸🇬" },
  { code: "KR", name: "South Korea",  language: "Korean",              flag: "🇰🇷" },
  { code: "JP", name: "Japan",        language: "Japanese",            flag: "🇯🇵" },
  { code: "TW", name: "Taiwan",       language: "Traditional Chinese", flag: "🇹🇼" },
  { code: "CN", name: "China",        language: "Simplified Chinese",  flag: "🇨🇳" },
  { code: "SA", name: "Saudi Arabia", language: "Arabic",              flag: "🇸🇦" },
  { code: "BD", name: "Bangladesh",   language: "Bengali",             flag: "🇧🇩" },
  { code: "BR", name: "Brazil",       language: "Portuguese (BR)",     flag: "🇧🇷" },
  { code: "DE", name: "Germany",      language: "German",              flag: "🇩🇪" },
  { code: "FR", name: "France",       language: "French",              flag: "🇫🇷" },
  { code: "ES", name: "Spain",        language: "Spanish",             flag: "🇪🇸" },
  { code: "US", name: "United States","language": "English",           flag: "🇺🇸" },
  { code: "IN", name: "India",        language: "Hindi",               flag: "🇮🇳" },
];

interface LocalizeRequest {
  appName: string;
  headlines: string[];
  descriptions: string[];
  ctas: string[];
  markets?: string[];
  /** Free-form targets instead of the fixed market list: {code, name, language}. */
  targets?: { code: string; name: string; language: string }[];
  sourceLanguage?: string;
  /** Free-text guidance from the operator, e.g. when redoing a translation. */
  instructions?: string;
}

interface MarketResult {
  code: string;
  name: string;
  language: string;
  flag: string;
  headlines: string[];
  descriptions: string[];
  ctas: string[];
}

async function translateBatch(
  markets: typeof MARKETS,
  appName: string,
  headlines: string[],
  descriptions: string[],
  ctas: string[],
  sourceLanguage: string,
  retryNote = "",
  instructions = ""
): Promise<MarketResult[]> {
  const marketsJson = markets.map(m => ({ code: m.code, name: m.name, language: m.language }));

  const prompt = `You are a Google App Campaign ad copy expert. Translate and localize the following ad copy for a mobile app called "${appName}" into multiple languages.

Source language: ${sourceLanguage}

Original ad copy:
Headlines (max 30 chars each): ${JSON.stringify(headlines)}
Descriptions (max 90 chars each): ${JSON.stringify(descriptions)}
CTAs (max 15 chars each): ${JSON.stringify(ctas)}

Target markets: ${JSON.stringify(marketsJson)}

Rules:
1. Headlines MUST be ≤30 characters (strict limit)
2. Descriptions MUST be ≤90 characters (strict limit)
3. CTAs MUST be ≤15 characters (strict limit)
4. If translation is too long, shorten/paraphrase to fit — never exceed the limit
5. Keep the tone natural and localized (not just literal translation)
6. For Arabic, use right-to-left friendly copy
7. Preserve the marketing intent and emotional appeal
8. Write EVERY line ENTIRELY in the market's target language. Do NOT mix in English or the source language — no Taglish, Hinglish, Singlish or similar code-mixing, even if local ads often do. Translate English loanwords such as "download", "free", "tutor", "course", "beginner", "expert", "users", "app" into the target language. Only the app/brand name "${appName}" and the word "AI" may stay as they are. (If the target language is English, write natural English.)
9. Use the language's native script (e.g. Devanagari for Hindi, Thai script for Thai), never a romanized transliteration.${retryNote ? `
10. ${retryNote}` : ""}${instructions ? `

Additional instructions from the marketer (follow them, within the rules above): ${instructions}` : ""}

Return ONLY a valid JSON array, no markdown, no explanation:
[
  {
    "code": "VN",
    "headlines": ["...", "...", "..."],
    "descriptions": ["...", "..."],
    "ctas": ["...", "..."]
  },
  ...
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Invalid response from AI");

  const parsed = JSON.parse(jsonMatch[0]) as { code: string; headlines: string[]; descriptions: string[]; ctas: string[] }[];

  // An item for a market that was not asked for is dropped rather than crashing the batch.
  return parsed.filter(item => markets.some(m => m.code === item.code)).map(item => {
    const market = markets.find(m => m.code === item.code)!;
    return {
      code: item.code,
      name: market.name,
      language: market.language,
      flag: market.flag,
      headlines: (item.headlines || []).map(h => h.slice(0, 30)),
      descriptions: (item.descriptions || []).map(d => d.slice(0, 90)),
      ctas: (item.ctas || []).map(c => c.slice(0, 15)),
    };
  });
}

/**
 * True when a line is not really in the expected script: no native character
 * at all, or more Latin letters than native ones ("AI से Free English Course").
 * The app name and "AI" are allowed to stay Latin and are not counted.
 */
function mostlyLatin(line: string, script: RegExp, appName: string): boolean {
  let rest = line.replace(/\bAI\b/g, "");
  for (const word of appName.split(/\s+/).filter(w => w.length > 1)) rest = rest.split(word).join("");
  const native = Array.from(rest).filter(ch => script.test(ch)).length;
  const latin = (rest.match(/[A-Za-z]/g) || []).length;
  return native === 0 || latin > native * 0.5;
}

/** The script a language is written in, for languages that have their own. */
function scriptOf(language: string): RegExp | null {
  const l = language.toLowerCase();
  if (l.includes("hindi")) return /[\u0900-\u097F]/;
  if (l.includes("bengali") || l.includes("bangla")) return /[\u0980-\u09FF]/;
  if (l.includes("thai")) return /[\u0E00-\u0E7F]/;
  if (l.includes("arabic")) return /[\u0600-\u06FF]/;
  if (l.includes("japanese")) return /[\u3040-\u30FF\u4E00-\u9FFF]/;
  if (l.includes("korean")) return /[\uAC00-\uD7AF]/;
  if (l.includes("chinese")) return /[\u4E00-\u9FFF]/;
  if (l.includes("russian")) return /[\u0400-\u04FF]/;
  return null;
}

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const body: LocalizeRequest = await req.json();
    const { appName, headlines, descriptions, ctas = [], markets = [], targets = [], sourceLanguage = "English" } = body;
    const instructions = String(body.instructions || "").slice(0, 500);

    // CTAs are optional: an ad-template block has headlines and descriptions only.
    if (!appName || !headlines?.length || !descriptions?.length || (!markets.length && !targets.length)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const targetMarkets = targets.length
      ? targets.filter(t => t?.code && t?.language).map(t => ({ code: String(t.code), name: String(t.name || t.code), language: String(t.language), flag: "" }))
      : MARKETS.filter(m => markets.includes(m.code));
    if (targetMarkets.length === 0) {
      return NextResponse.json({ error: "No valid markets selected" }, { status: 400 });
    }

    // Batch into groups of 5 to avoid token limits
    const BATCH_SIZE = 5;
    const results: MarketResult[] = [];
    for (let i = 0; i < targetMarkets.length; i += BATCH_SIZE) {
      const batch = targetMarkets.slice(i, i + BATCH_SIZE);
      const batchResults = await translateBatch(batch, appName, headlines, descriptions, ctas, sourceLanguage, "", instructions);
      results.push(...batchResults);
    }

    // Languages with their own script can be checked: a line without a single
    // character of that script came back in English (or romanized). Those
    // markets are translated once more with the problem spelled out.
    const wrong = results.filter(r => {
      const script = scriptOf(r.language);
      return script && [...r.headlines, ...r.descriptions].some(line => mostlyLatin(line, script, appName));
    });
    if (wrong.length) {
      const again = await translateBatch(
        targetMarkets.filter(m => wrong.some(w => w.code === m.code)),
        appName, headlines, descriptions, ctas, sourceLanguage,
        "A previous attempt left lines in English or in Latin letters. Every headline and description must be written in the target language's own script.",
        instructions,
      ).catch(() => [] as MarketResult[]);
      for (const r of again) {
        const i = results.findIndex(x => x.code === r.code);
        if (i >= 0) results[i] = r;
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error("Localize error:", err);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}

export { MARKETS };
