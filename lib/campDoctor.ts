/**
 * Campaign analysis for Google App campaigns (tROAS).
 *
 * Two sources are joined by campaign name:
 * - the Google Ads campaign report (status, status reasons, budget, target
 *   ROAS, cost, conversions, CTR, optimization score), and
 * - the system report, whose est_roas is the ROAS that counts.
 *
 * The rules follow Google's guidance for App campaigns: leave a campaign in
 * learning alone, move budget or target by at most ~20% at a time, scale what
 * beats its target and is budget-limited, tighten what misses it.
 */

export interface CampRow {
  name: string;
  campaignId?: string;
  status: string;
  statusReasons: string;
  budget: number | null;
  /** Target ROAS as a fraction: 110% → 1.1 */
  tRoas: number | null;
  /** Google's conv. value / cost */
  gRoas: number | null;
  conversions: number | null;
  cost: number | null;
  impressions: number | null;
  /** CTR as a fraction */
  ctr: number | null;
  optScore: number | null;
  // From the system report
  estRoas: number | null;
  estRoasH1: number | null;
  sysSpend: number | null;
  sysRevenue: number | null;
  sysEstRevenue: number | null;
  installs: number | null;
  cpi: number | null;
  inSystem: boolean;
}

export type Severity = "good" | "warn" | "bad" | "info";

export interface Suggestion {
  kind: "budget_up" | "budget_down" | "troas_up" | "troas_down" | "wait" | "assets" | "creative" | "pause" | "check" | "no_data" | "keep";
  title: string;
  detail: string;
  /** Current and proposed value, for one-glance edits. */
  from?: number;
  to?: number;
  unit?: "$" | "%";
  severity: Severity;
}

/** One day of a campaign, kept by the page across analyses. */
export interface DayPoint {
  date: string;              // YYYY-MM-DD, the report's day
  estRoas: number | null;
  cost: number | null;
  budget: number | null;
  conversions: number | null;
  limited: boolean;          // "limited by budget" that day
}

export interface CampAnalysis {
  row: CampRow;
  /** est ROAS / target ROAS */
  ratio: number | null;
  health: Severity;
  suggestions: Suggestion[];
}

/** Tunable thresholds. */
export const RULES = {
  /** Business target for the system's est ROAS (D0): 100%. */
  targetD0: 1.0,
  /** Share of budget spent that counts as "tiêu hết budget". */
  fullSpend: 0.9,
  /** Days in a row of full spend + ROAS ≥ target before scaling harder. */
  stableDays: 3,
  /** ROAS over recent days varying more than this (coefficient of variation) is "dao động". */
  volatileCv: 0.3,
  /** Fewer conversions than this with good ROAS → check tracking / optimisation event. */
  lowVolumeConversions: 10,
  /** Biggest single change Google recommends for budget / target. */
  maxStep: 0.2,
  /** est ROAS ≥ target × this → scale. */
  scaleAt: 1.2,
  /** est ROAS < target × this → tighten. */
  tightenBelow: 0.8,
  /** est ROAS < target × this → cut. */
  cutBelow: 0.5,
  /** Minimum data before judging: spend ≥ max(minCost, budget × minBudgetShare) or conversions ≥ minConversions. */
  minCost: 5,
  minBudgetShare: 0.1,
  minConversions: 30,
  /**
   * "Limited by budget" is Google's forecast. Below this share of the budget
   * actually spent (typically a mid-day export), a budget raise waits for the
   * day to finish.
   */
  minBudgetUsedToRaise: 0.5,
  /** CTR below this with enough impressions → creative fatigue. */
  lowCtr: 0.01,
  lowCtrImpressions: 2000,
  /** Optimization score below this → look at Google's recommendations. */
  lowOptScore: 85,
};

// ── Parsing ──

/**
 * Numbers as Google Sheets and Google Ads exports write them: "1,4", "3523,86",
 * "110%", "45,11%", "1.606", "--", "". Percentages become fractions.
 */
export function parseNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s || s === "--" || s === "-") return null;
  const pct = s.endsWith("%");
  s = s.replace(/[%\s$]/g, "");
  if (s.includes(",") && s.includes(".")) {
    // Whichever comes last is the decimal mark.
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/** Target ROAS written either as a fraction (1.1) or a percent (110 / "110%"). */
function parseRoasTarget(v: unknown): number | null {
  const n = parseNum(v);
  if (n === null) return null;
  return n > 10 ? n / 100 : n;
}

export function normName(s: string): string {
  return s.replace(/\\#/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Finds the header row: the first row that has every one of these labels. */
function findHeader(rows: unknown[][], must: string[]): number {
  return rows.findIndex(r => {
    const cells = r.map(c => String(c ?? "").trim().toLowerCase());
    return must.every(m => cells.includes(m));
  });
}

function indexer(header: unknown[]) {
  const cells = header.map(c => String(c ?? "").trim().toLowerCase());
  return (...names: string[]) => {
    for (const n of names) {
      const i = cells.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
}

const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);

export interface SystemRow {
  campaignId: string; name: string;
  estRoas: number | null; estRoasH1: number | null;
  spend: number | null; revenue: number | null; installs: number | null; cpi: number | null;
  /** Estimated cohort revenue (d0); est_roas = this / spend. */
  estRevenue: number | null;
}

export function parseSystemSheet(rows: unknown[][]): SystemRow[] {
  const h = findHeader(rows, ["campaign_name", "est_roas"]);
  if (h < 0) throw new Error("File data system: không thấy cột campaign_name và est_roas.");
  const col = indexer(rows[h]);
  const iName = col("campaign_name"), iId = col("campaign_id"), iEst = col("est_roas"), iEstH1 = col("est_roas_h1");
  const iSpend = col("total_spen", "total_spend"), iRev = col("total_revenue"), iInst = col("total_install_mmp"), iCpi = col("cpi");
  const iEstRev = col("sum_metric_est_cohort_revenue_d0");
  return rows.slice(h + 1)
    .filter(r => String(cell(r, iName) ?? "").trim())
    .map(r => ({
      campaignId: String(cell(r, iId) ?? "").trim(),
      name: String(cell(r, iName)).trim(),
      estRoas: parseNum(cell(r, iEst)),
      estRoasH1: parseNum(cell(r, iEstH1)),
      spend: parseNum(cell(r, iSpend)),
      revenue: parseNum(cell(r, iRev)),
      installs: parseNum(cell(r, iInst)),
      cpi: parseNum(cell(r, iCpi)),
      estRevenue: parseNum(cell(r, iEstRev)),
    }));
}

export interface AdsRow {
  name: string; status: string; statusReasons: string;
  budget: number | null; tRoas: number | null; gRoas: number | null;
  conversions: number | null; cost: number | null; impressions: number | null; ctr: number | null; optScore: number | null;
  campaignStatus: string;
}

export function parseAdsSheet(rows: unknown[][]): AdsRow[] {
  const h = findHeader(rows, ["campaign", "budget"]);
  if (h < 0) throw new Error("File GG Ads: không thấy dòng tiêu đề có cột Campaign và Budget.");
  const col = indexer(rows[h]);
  const iName = col("campaign"), iBudget = col("budget"), iStatus = col("status"), iReasons = col("status reasons");
  const iCampStatus = col("campaign status"), iOpt = col("optimization score"), iT = col("avg. target roas", "target roas");
  const iG = col("conv. value / cost"), iConv = col("conversions"), iCost = col("cost"), iImpr = col("impr.", "impressions"), iCtr = col("ctr");
  return rows.slice(h + 1)
    .filter(r => {
      const n = String(cell(r, iName) ?? "").trim();
      const first = String(r[0] ?? "").toLowerCase();
      return n && n !== "--" && !first.startsWith("total");
    })
    .map(r => ({
      name: String(cell(r, iName)).trim(),
      campaignStatus: String(cell(r, iCampStatus) ?? "").trim(),
      status: String(cell(r, iStatus) ?? "").trim(),
      statusReasons: String(cell(r, iReasons) ?? "").trim(),
      budget: parseNum(cell(r, iBudget)),
      tRoas: parseRoasTarget(cell(r, iT)),
      gRoas: parseNum(cell(r, iG)),
      conversions: parseNum(cell(r, iConv)),
      cost: parseNum(cell(r, iCost)),
      impressions: parseNum(cell(r, iImpr)),
      ctr: parseNum(cell(r, iCtr)),
      optScore: parseNum(cell(r, iOpt)),
    }));
}

/** Joins the two reports on campaign name. Ads rows drive the list. */
export function joinReports(ads: AdsRow[], sys: SystemRow[]): CampRow[] {
  const byName = new Map(sys.map(s => [normName(s.name), s]));
  return ads.map(a => {
    const s = byName.get(normName(a.name));
    return {
      name: a.name, campaignId: s?.campaignId,
      status: a.status, statusReasons: a.statusReasons,
      budget: a.budget, tRoas: a.tRoas, gRoas: a.gRoas,
      conversions: a.conversions, cost: a.cost, impressions: a.impressions, ctr: a.ctr, optScore: a.optScore,
      estRoas: s?.estRoas ?? null, estRoasH1: s?.estRoasH1 ?? null,
      sysSpend: s?.spend ?? null, sysRevenue: s?.revenue ?? null, sysEstRevenue: s?.estRevenue ?? null, installs: s?.installs ?? null, cpi: s?.cpi ?? null,
      inSystem: Boolean(s),
    };
  });
}

// ── Rules ──

const pct = (n: number) => Math.round(n * 100);
const money = (n: number) => Math.round(n * 100) / 100;
const fmtPct = (n: number) => `${pct(n)}%`;

/**
 * @param history earlier days of this campaign (not the report's day), oldest
 *   first. Rules that need "3–7 days in a row" or "dao động" use it; without it
 *   the campaign is treated as new.
 */
export function analyze(row: CampRow, rules = RULES, history: DayPoint[] = [], reportDate = ""): CampAnalysis {
  const out: Suggestion[] = [];
  const reasons = row.statusReasons.toLowerCase();
  const learning = reasons.includes("learning");
  const policyMost = reasons.includes("most ads limited by policy");
  const policySome = reasons.includes("some ads limited by policy");
  const budgetLimited = reasons.includes("limited by budget") || reasons.includes("budget constrained");
  const bidConstrained = reasons.includes("bidding strategy constrained");
  const target = rules.targetD0;
  // Health and scaling are judged on the system's est ROAS (D0) against the
  // business target; the campaign's own tROAS is what gets adjusted.
  const ratio = row.estRoas !== null && target ? row.estRoas / target : null;
  const cost = row.cost ?? 0, budget = row.budget ?? 0;
  const enoughData = cost >= Math.max(rules.minCost, budget * rules.minBudgetShare) || (row.conversions ?? 0) >= rules.minConversions;
  const used = budget ? cost / budget : 0;
  const spentFull = used >= rules.fullSpend;

  // Recent days including this one, newest last.
  const today: DayPoint = { date: reportDate, estRoas: row.estRoas, cost: row.cost, budget: row.budget, conversions: row.conversions, limited: budgetLimited };
  const days = [...history.filter(d => d.date !== reportDate), today].slice(-7);
  const judged = days.filter(d => d.estRoas !== null && (d.cost ?? 0) >= rules.minCost);
  const isFull = (d: DayPoint) => d.budget ? (d.cost ?? 0) / d.budget >= rules.fullSpend || (d.limited && (d.cost ?? 0) / d.budget >= rules.minBudgetUsedToRaise) : false;
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.estRoas !== null && d.estRoas >= target && isFull(d)) streak++; else break;
  }
  const roasList = judged.map(d => d.estRoas!);
  const mean = roasList.reduce((x, y) => x + y, 0) / (roasList.length || 1);
  const cv = roasList.length >= 2 ? Math.sqrt(roasList.reduce((x, y) => x + (y - mean) ** 2, 0) / roasList.length) / (mean || 1) : 0;
  const volatile = roasList.length >= 2 && (cv > rules.volatileCv || roasList.some(v => v < target));
  const prev = days.length >= 2 ? days[days.length - 2] : null;

  if (policyMost) out.push({ kind: "assets", severity: "bad", title: "Phần lớn asset bị giới hạn bởi policy",
    detail: "Camp gần như không phân phối được. Vào Assets xem asset bị từ chối / giới hạn, gỡ và thay bằng asset mới (tạo ở trang Banner + Ad Copy)." });
  else if (policySome) out.push({ kind: "assets", severity: "warn", title: "Một số asset bị giới hạn bởi policy",
    detail: "Kiểm tra asset bị từ chối / giới hạn và thay thế để không mất lượt hiển thị." });

  if (learning) {
    out.push({ kind: "wait", severity: "info", title: "Đang learning — chưa chỉnh",
      detail: "Đổi budget hoặc tROAS lúc này làm camp học lại từ đầu. Đợi hết learning (thường 5–7 ngày) rồi mới đánh giá." });
  } else if (!row.inSystem || row.estRoas === null) {
    out.push({ kind: "check", severity: "info", title: "Chưa có est ROAS từ system",
      detail: row.inSystem ? "Campaign có trong data system nhưng est_roas trống (chưa có spend/doanh thu)." : "Không tìm thấy campaign này trong file data system — kiểm tra tên campaign có khớp không." });
  } else if (!enoughData) {
    out.push({ kind: "no_data", severity: "info", title: "Chưa đủ dữ liệu để kết luận",
      detail: `Mới tiêu $${money(cost)} / budget $${budget}, ${row.conversions ?? 0} conversion. Theo dõi thêm trước khi chỉnh.` });
  } else if (ratio !== null) {
    const t = row.tRoas ?? target;
    const est = row.estRoas!;
    const vs = `est ROAS D0 ${fmtPct(est)} / target ${fmtPct(target)}`;
    const spendNote = `đã tiêu ${Math.round(used * 100)}% budget ($${money(cost)}/$${budget})`;
    const hist = days.length > 1 ? ` · ${streak} ngày liên tiếp đạt target + hết budget, ${judged.length} ngày có dữ liệu` : " · chưa có lịch sử ngày trước";
    const up = (step: number, hi: number, title: string, why: string): Suggestion => ({
      kind: "budget_up", severity: "good", title: `${title}: tăng budget ${Math.round(step * 100)}–${Math.round(hi * 100)}%`,
      from: budget, to: Math.round(budget * (1 + step)), unit: "$", detail: `${vs}, ${spendNote}${hist}. ${why}` });

    if (ratio >= 1) {
      if (budgetLimited || spentFull) {
        if (used < rules.minBudgetUsedToRaise) {
          out.push({ kind: "keep", severity: "good", title: "Đạt target — chờ hết ngày rồi mới tăng budget",
            detail: `${vs}. Google báo limited by budget nhưng mới ${spendNote} — nếu là dữ liệu giữa ngày, xem lại khi đủ ngày.` });
        } else if (volatile) {
          out.push({ kind: "keep", severity: "good", title: "ROAS dao động: giữ nguyên (hoặc +tối đa 10%)",
            detail: `${vs}${hist}; ROAS các ngày gần đây dao động (CV ${Math.round(cv * 100)}%${roasList.some(v => v < target) ? ", có ngày dưới target" : ""}). Chờ thêm dữ liệu trước khi scale.` });
        } else if (ratio >= rules.scaleAt && streak >= rules.stableDays) {
          out.push(up(0.2, 0.3, "ROAS vượt target rõ rệt, volume ổn định", "Có thể tăng mạnh hơn (tới 30%) nếu chấp nhận biến động."));
        } else if (streak >= rules.stableDays) {
          out.push(up(0.15, 0.2, "ROAS tốt, tiêu hết budget nhiều ngày", "Scale từng bước."));
        } else {
          out.push(up(0.1, 0.15, "ROAS vừa đạt target", `Tăng thận trọng${streak < rules.stableDays ? `; đủ ${rules.stableDays} ngày ổn định thì tăng 15–20%` : ""}.`));
        }
      } else {
        // Good ROAS but the budget is not being spent: the target holds it back.
        out.push({ kind: "troas_down", severity: "good", title: "Tiêu ít hơn budget, ROAS tốt → kiểm tra tROAS có quá cao", from: pct(t), to: pct(t * 0.9), unit: "%",
          detail: `${vs}, ${spendNote}${bidConstrained ? ", bidding strategy constrained" : ""}. Hạ tROAS từng bước để mở rộng phân phối (khác với tăng budget). Dùng Bid Simulator của Google để ước tính trước.${used < rules.minBudgetUsedToRaise ? " Nếu đây là dữ liệu giữa ngày, xem lại cuối ngày." : ""}` });
      }
      if ((row.conversions ?? 0) < rules.lowVolumeConversions) {
        out.push({ kind: "check", severity: "info", title: "ROAS tốt nhưng volume conversion thấp",
          detail: `Chỉ ${row.conversions ?? 0} conversion. Kiểm tra tracking, event tối ưu và dữ liệu học máy trước khi scale.` });
      }
    } else if (ratio >= rules.tightenBelow) {
      out.push({ kind: "keep", severity: "warn", title: "Dưới target — không tăng budget, tối ưu trước khi scale",
        detail: `${vs}${spentFull ? ", tiêu hết budget nhưng ROAS chưa đạt → kiểm tra chất lượng user và hiệu quả" : ""}. Xem thêm 1–2 ngày; nếu vẫn dưới target thì siết tROAS.` });
    } else if (ratio >= rules.cutBelow) {
      out.push({ kind: "troas_up", severity: "warn", title: "Nâng tROAS 10% (siết hiệu quả)", from: pct(t), to: pct(t * 1.1), unit: "%",
        detail: `${vs} → không scale; nâng target để Google chọn user chất lượng hơn${spentFull || budgetLimited ? ". Tiêu hết budget nhưng ROAS thấp → kiểm tra chất lượng user" : ""}.` });
    } else {
      out.push({ kind: "budget_down", severity: "bad", title: "Giảm budget 20%", from: budget, to: Math.max(1, Math.round(budget * (1 - rules.maxStep))), unit: "$",
        detail: `${vs} — lỗ nặng. Giảm budget để cắt lỗ.` });
      out.push({ kind: "troas_up", severity: "bad", title: "Nâng tROAS 15%", from: pct(t), to: pct(t * 1.15), unit: "%",
        detail: "Siết target cùng lúc. Nếu 3 ngày liên tiếp vẫn < 50% target thì cân nhắc tạm dừng camp." });
    }

    // Budget went up since the last day seen, but spend did not follow.
    if (prev && prev.budget && budget > prev.budget && (prev.cost ?? 0) > 0 && cost <= (prev.cost ?? 0) * 1.05) {
      out.push({ kind: "check", severity: "warn", title: "Đã tăng budget nhưng volume không tăng",
        detail: `Budget $${prev.budget} → $${budget} nhưng cost $${money(prev.cost ?? 0)} → $${money(cost)}. Kiểm tra giới hạn đấu giá, tROAS và quy mô thị trường.` });
    }
  }

  if (!learning && row.ctr !== null && row.ctr < rules.lowCtr && (row.impressions ?? 0) >= rules.lowCtrImpressions) {
    out.push({ kind: "creative", severity: "warn", title: "CTR thấp — làm mới creative",
      detail: `CTR ${(row.ctr * 100).toFixed(2)}% trên ${row.impressions} impression. Thay asset hiệu quả LOW bằng banner / ad copy mới.` });
  }
  if (row.optScore !== null && row.optScore < rules.lowOptScore) {
    out.push({ kind: "check", severity: "info", title: `Optimization score ${row.optScore}`,
      detail: "Xem tab Recommendations của camp trên Google Ads để biết Google đề xuất gì thêm." });
  }

  const health: Severity = policyMost || (ratio !== null && ratio < rules.tightenBelow && enoughData && !learning) ? "bad"
    : ratio !== null && ratio >= 1 && enoughData && !learning ? "good"
    : out.some(s => s.severity === "warn") ? "warn" : "info";

  return { row, ratio, health, suggestions: out };
}

/** The day a Google Ads report covers, from its "October 16, 2026 - October 16, 2026" line (end date). */
export function parseReportDate(rows: unknown[][]): string {
  for (const r of rows.slice(0, 5)) {
    for (const c of r) {
      const m = String(c ?? "").match(/([A-Z][a-z]+ \d{1,2}, \d{4})\s*-\s*([A-Z][a-z]+ \d{1,2}, \d{4})/);
      if (m) {
        const d = new Date(`${m[2]} 12:00:00 UTC`);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
    }
  }
  return "";
}

/** Bad first, then warn, then good, then info; bigger spend first within a group. */
export function analyzeAll(rows: CampRow[], rules = RULES, history: Record<string, DayPoint[]> = {}, reportDate = ""): CampAnalysis[] {
  const rank: Record<Severity, number> = { bad: 0, warn: 1, good: 2, info: 3 };
  return rows.map(r => analyze(r, rules, history[normName(r.name)] || [], reportDate)).sort((a, b) => rank[a.health] - rank[b.health] || (b.row.cost ?? 0) - (a.row.cost ?? 0));
}

/** Minimal CSV/TSV reader for exported sheets (quotes, commas or tabs). */
export function parseDelimited(text: string): string[][] {
  const delim = text.split("\n", 1)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
