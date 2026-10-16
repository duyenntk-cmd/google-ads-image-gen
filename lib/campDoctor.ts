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

export interface CampAnalysis {
  row: CampRow;
  /** est ROAS / target ROAS */
  ratio: number | null;
  health: Severity;
  suggestions: Suggestion[];
}

/** Tunable thresholds. */
export const RULES = {
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

export function analyze(row: CampRow, rules = RULES): CampAnalysis {
  const out: Suggestion[] = [];
  const reasons = row.statusReasons.toLowerCase();
  const learning = reasons.includes("learning");
  const policyMost = reasons.includes("most ads limited by policy");
  const policySome = reasons.includes("some ads limited by policy");
  const budgetLimited = reasons.includes("limited by budget") || reasons.includes("budget constrained");
  const bidConstrained = reasons.includes("bidding strategy constrained");
  const ratio = row.estRoas !== null && row.tRoas ? row.estRoas / row.tRoas : null;
  const cost = row.cost ?? 0, budget = row.budget ?? 0;
  const enoughData = cost >= Math.max(rules.minCost, budget * rules.minBudgetShare) || (row.conversions ?? 0) >= rules.minConversions;
  const used = budget ? cost / budget : 0;
  /** Budget raise, or a wait when the budget is not actually being spent yet. */
  const raise = (step: number, vs: string, why: string): Suggestion => used < rules.minBudgetUsedToRaise
    ? { kind: "keep", severity: "good", title: "Đạt target — chờ hết ngày rồi mới tăng budget",
        detail: `${vs}. Google báo limited by budget nhưng mới tiêu ${Math.round(used * 100)}% budget ($${money(cost)}/$${budget}) — nếu là dữ liệu giữa ngày, xem lại khi đủ ngày; tiêu ≥ ${Math.round(rules.minBudgetUsedToRaise * 100)}% thì tăng ${Math.round(step * 100)}%.` }
    : { kind: "budget_up", severity: "good", title: `Tăng budget ${Math.round(step * 100)}%`, from: budget, to: Math.round(budget * (1 + step)), unit: "$",
        detail: `${vs}, ${why}` };

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
  } else if (ratio !== null && row.tRoas) {
    const t = row.tRoas;
    const est = row.estRoas!;
    const vs = `est ROAS ${fmtPct(est)} so với target ${fmtPct(t)} (${fmtPct(ratio)} target)`;
    if (ratio >= rules.scaleAt) {
      if (budgetLimited) {
        out.push(raise(rules.maxStep, vs, "đang bị giới hạn budget → scale."));
      } else {
        const to = Math.max(0.1, t * (1 - 0.1));
        out.push({ kind: "troas_down", severity: "good", title: "Hạ tROAS 10% để lấy thêm volume", from: pct(t), to: pct(to), unit: "%",
          detail: `${vs}${bidConstrained ? ", bidding strategy constrained" : ", không hết budget"} → hạ target để thắng thêm đấu giá.` });
      }
    } else if (ratio >= 1) {
      if (budgetLimited) out.push(raise(0.1, vs, "đạt target và đang bị giới hạn budget → tăng nhẹ."));
      else out.push({ kind: "keep", severity: "good", title: "Đạt target — giữ nguyên", detail: `${vs}.` });
    } else if (ratio >= rules.tightenBelow) {
      out.push({ kind: "keep", severity: "warn", title: "Gần target — theo dõi, chưa tăng budget",
        detail: `${vs}. Xem thêm 1–2 ngày; nếu vẫn dưới target thì siết tROAS.` });
    } else if (ratio >= rules.cutBelow) {
      const to = t * 1.1;
      out.push({ kind: "troas_up", severity: "warn", title: "Nâng tROAS 10% (siết hiệu quả)", from: pct(t), to: pct(to), unit: "%",
        detail: `${vs} → nâng target để Google chọn traffic chất lượng hơn${budgetLimited ? "; không tăng budget" : ""}.` });
    } else {
      out.push({ kind: "budget_down", severity: "bad", title: "Giảm budget 20%", from: budget, to: Math.max(1, Math.round(budget * (1 - rules.maxStep))), unit: "$",
        detail: `${vs} — lỗ nặng. Giảm budget để cắt lỗ.` });
      out.push({ kind: "troas_up", severity: "bad", title: "Nâng tROAS 15%", from: pct(t), to: pct(t * 1.15), unit: "%",
        detail: "Siết target cùng lúc. Nếu 3 ngày liên tiếp vẫn < 50% target thì cân nhắc tạm dừng camp." });
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

/** Bad first, then warn, then good, then info; bigger spend first within a group. */
export function analyzeAll(rows: CampRow[], rules = RULES): CampAnalysis[] {
  const rank: Record<Severity, number> = { bad: 0, warn: 1, good: 2, info: 3 };
  return rows.map(r => analyze(r, rules)).sort((a, b) => rank[a.health] - rank[b.health] || (b.row.cost ?? 0) - (a.row.cost ?? 0));
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
