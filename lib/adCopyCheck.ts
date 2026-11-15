/**
 * Checks on ad copy that are not just length: is a line really written in the
 * market's own script, or did English creep in ("AI से Free English Course").
 * Shared by the localize route and the Claude connector.
 */

/**
 * True when a line is not really in the expected script: no native character
 * at all, or more Latin letters than native ones ("AI से Free English Course").
 * The app name and "AI" are allowed to stay Latin and are not counted.
 */
export function mostlyLatin(line: string, script: RegExp, appName: string): boolean {
  let rest = line.replace(/\bAI\b/g, "");
  for (const word of appName.split(/\s+/).filter(w => w.length > 1)) rest = rest.split(word).join("");
  const native = Array.from(rest).filter(ch => script.test(ch)).length;
  const latin = (rest.match(/[A-Za-z]/g) || []).length;
  return native === 0 || latin > native * 0.5;
}

/** The script a language is written in, for languages that have their own. */
export function scriptOf(language: string): RegExp | null {
  const l = language.toLowerCase();
  if (l.includes("hindi")) return /[\u0900-\u097F]/;
  if (l.includes("bengali") || l.includes("bangla")) return /[\u0980-\u09FF]/;
  if (l.includes("thai")) return /[\u0E00-\u0E7F]/;
  if (l.includes("arabic")) return /[\u0600-\u06FF]/;
  if (l.includes("japanese")) return /[\u3040-\u30FF\u4E00-\u9FFF]/;
  if (l.includes("korean")) return /[\uAC00-\uD7AF]/;
  if (l.includes("chinese")) return /[\u4E00-\u9FFF]/;
  if (l.includes("russian") || l.includes("ukrainian")) return /[\u0400-\u04FF]/;
  if (l.includes("nepali")) return /[\u0900-\u097F]/;
  if (l.includes("urdu") || l.includes("persian")) return /[\u0600-\u06FF]/;
  if (l.includes("hebrew")) return /[\u0590-\u05FF]/;
  if (l.includes("greek")) return /[\u0370-\u03FF]/;
  if (l.includes("burmese")) return /[\u1000-\u109F]/;
  if (l.includes("khmer")) return /[\u1780-\u17FF]/;
  if (l.includes("lao")) return /[\u0E80-\u0EFF]/;
  if (l.includes("sinhala")) return /[\u0D80-\u0DFF]/;
  if (l.includes("amharic")) return /[\u1200-\u137F]/;
  return null;
}
