import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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
  markets: string[];
  sourceLanguage?: string;
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
  sourceLanguage: string
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

  return parsed.map(item => {
    const market = markets.find(m => m.code === item.code)!;
    return {
      code: item.code,
      name: market.name,
      language: market.language,
      flag: market.flag,
      headlines: item.headlines.map(h => h.slice(0, 30)),
      descriptions: item.descriptions.map(d => d.slice(0, 90)),
      ctas: item.ctas.map(c => c.slice(0, 15)),
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const body: LocalizeRequest = await req.json();
    const { appName, headlines, descriptions, ctas, markets, sourceLanguage = "English" } = body;

    if (!appName || !headlines?.length || !descriptions?.length || !ctas?.length || !markets?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const targetMarkets = MARKETS.filter(m => markets.includes(m.code));
    if (targetMarkets.length === 0) {
      return NextResponse.json({ error: "No valid markets selected" }, { status: 400 });
    }

    // Batch into groups of 5 to avoid token limits
    const BATCH_SIZE = 5;
    const results: MarketResult[] = [];
    for (let i = 0; i < targetMarkets.length; i += BATCH_SIZE) {
      const batch = targetMarkets.slice(i, i + BATCH_SIZE);
      const batchResults = await translateBatch(batch, appName, headlines, descriptions, ctas, sourceLanguage);
      results.push(...batchResults);
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error("Localize error:", err);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}

export { MARKETS };
