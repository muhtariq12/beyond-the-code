import type { Preferences, Salary } from "../types";

/** Approximate reference rates (AED per 1 unit). AED is pegged to USD at 3.6725; others are editable in Settings. */
export const DEFAULT_FX_TO_AED: Record<string, number> = {
  AED: 1,
  USD: 3.6725,
  EUR: 4.0,
  GBP: 4.7,
  SAR: 0.9793,
  QAR: 1.0090,
  KWD: 11.95,
  BHD: 9.74,
  OMR: 9.54,
  EGP: 0.075,
  INR: 0.044,
  PKR: 0.013,
  CAD: 2.7,
};

const PERIOD_TO_MONTHLY: Record<Exclude<Salary["period"], "UNKNOWN">, number> = {
  HOUR: 2080 / 12,
  DAY: 260 / 12,
  WEEK: 52 / 12,
  MONTH: 1,
  YEAR: 1 / 12,
};

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/(?:AED|Dhs?\.?|د\.إ)/i, "AED"],
  [/\bUSD\b|US\$|\$/i, "USD"],
  [/\bEUR\b|€/i, "EUR"],
  [/\bGBP\b|£/i, "GBP"],
  [/\bSAR\b/i, "SAR"],
  [/\bQAR\b/i, "QAR"],
  [/\bKWD\b/i, "KWD"],
  [/\bBHD\b/i, "BHD"],
  [/\bOMR\b/i, "OMR"],
  [/\bEGP\b/i, "EGP"],
  [/\bINR\b|₹/i, "INR"],
  [/\bPKR\b/i, "PKR"],
  [/\bCAD\b/i, "CAD"],
];

export function detectCurrency(text: string): string | null {
  for (const [re, code] of CURRENCY_SYMBOLS) if (re.test(text)) return code;
  return null;
}

export function detectPeriod(text: string): Salary["period"] {
  if (/(per|a|\/|p\.?)\s*(hour|hr)\b|hourly/i.test(text)) return "HOUR";
  if (/(per|a|\/)\s*day\b|daily/i.test(text)) return "DAY";
  if (/(per|a|\/)\s*week\b|weekly/i.test(text)) return "WEEK";
  if (/(per|a|\/|p\.?)\s*(month|mo)\b|monthly|\bp\.?m\.?\b/i.test(text)) return "MONTH";
  if (/(per|a|\/|p\.?)\s*(year|yr|annum|annual)\b|annual|yearly|\bp\.?a\.?\b|per year/i.test(text)) return "YEAR";
  return "UNKNOWN";
}

export function detectBasis(text: string): Salary["basis"] {
  if (/total (compensation|package|comp|remuneration)|\bOTE\b|on[- ]target earnings|including (bonus|allowances?|commission)|all[- ]inclusive/i.test(text)) return "TOTAL";
  if (/base (salary|pay)|basic salary|fixed salary|base compensation/i.test(text)) return "BASE";
  return "UNKNOWN";
}

function parseAmount(raw: string, suffix?: string): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  const s = (suffix ?? "").toLowerCase();
  if (s === "k") return n * 1_000;
  if (s === "m") return n * 1_000_000;
  return n;
}

/**
 * Parse a published salary string such as "AED 15,000 - 20,000 per month" or "$120k–150k/yr".
 * Returns null when no numeric amount is present. Never invents a period or currency.
 */
export function parseSalaryText(text: string): Salary | null {
  const t = text.replace(/–|—|−/g, "-");
  const amountRe = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m)?\b/gi;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  const rangeCtx = t;
  while ((m = amountRe.exec(rangeCtx))) {
    const v = parseAmount(m[1], m[2]);
    // ignore tiny numbers that are likely years/percent unless currency-adjacent; require >= 100
    if (v >= 100) nums.push(v);
  }
  if (nums.length === 0) return null;
  const currency = detectCurrency(t);
  const [a, b] = [nums[0], nums[1] ?? nums[0]];
  return {
    min: Math.min(a, b),
    max: Math.max(a, b),
    currency,
    period: detectPeriod(t),
    basis: detectBasis(t),
    raw: text.trim().slice(0, 300),
  };
}

/** Pull published pay text out of a free-form job description. */
export function findSalaryInDescription(desc: string): Salary | null {
  const re = /((?:AED|USD|EUR|GBP|SAR|QAR|Dhs?\.?|US\$|[$€£])\s?\d[\d,.]*\s?(?:k|m)?(?:\s?(?:-|to)\s?(?:AED|USD|EUR|GBP|SAR|QAR|Dhs?\.?|US\$|[$€£])?\s?\d[\d,.]*\s?(?:k|m)?)?[^\n.]{0,60})/i;
  const m = desc.replace(/[–—]/g, "-").match(re);
  if (!m) return null;
  const ctx = desc.slice(Math.max(0, desc.indexOf(m[1]) - 40), desc.indexOf(m[1]) + m[1].length + 40);
  const s = parseSalaryText(m[1]);
  if (!s) return null;
  return { ...s, basis: s.basis === "UNKNOWN" ? detectBasis(ctx) : s.basis, period: s.period === "UNKNOWN" ? detectPeriod(ctx) : s.period, raw: m[1].trim() };
}

export interface MonthlyAed {
  min: number | null;
  max: number | null;
}

/** Normalise to AED per month. Returns null when currency or period is unknown (never guesses). */
export function toMonthlyAed(
  salary: Salary,
  fx: Record<string, number> = DEFAULT_FX_TO_AED,
): MonthlyAed | null {
  if (!salary.currency || salary.period === "UNKNOWN") return null;
  const rate = fx[salary.currency];
  if (!rate) return null;
  const f = rate * PERIOD_TO_MONTHLY[salary.period];
  return {
    min: salary.min == null ? null : Math.round(salary.min * f),
    max: salary.max == null ? null : Math.round(salary.max * f),
  };
}

export interface SalaryAssessment {
  result: "PASS" | "FAIL" | "UNKNOWN";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  reason: string;
  aed: MonthlyAed | null;
}

export function assessSalary(salary: Salary | null, prefs: Preferences): SalaryAssessment {
  const floor = prefs.minSalaryAedMonthly;
  if (!salary) {
    return { result: "UNKNOWN", confidence: "UNKNOWN", reason: "Salary not published (UNKNOWN, not treated as a match).", aed: null };
  }
  const aed = toMonthlyAed(salary, prefs.fxRatesToAed);
  if (!aed) {
    const why = !salary.currency ? "currency" : salary.period === "UNKNOWN" ? "pay period" : `exchange rate for ${salary.currency}`;
    return { result: "UNKNOWN", confidence: "LOW", reason: `Salary "${salary.raw}" published without a clear ${why}; cannot normalise.`, aed: null };
  }
  const top = aed.max ?? aed.min;
  const bottom = aed.min ?? aed.max;
  if (top == null || bottom == null) {
    return { result: "UNKNOWN", confidence: "LOW", reason: "Salary range incomplete.", aed };
  }
  const fmt = (n: number) => `AED ${n.toLocaleString("en-US")}`;
  const range = bottom === top ? fmt(top) : `${fmt(bottom)}–${fmt(top)}`;
  if (top < floor) {
    return {
      result: "FAIL",
      confidence: salary.basis === "TOTAL" ? "HIGH" : "HIGH",
      reason: `Published ${range}/month is below the ${fmt(floor)}/month minimum${salary.basis === "TOTAL" ? " even as total compensation" : ""}.`,
      aed,
    };
  }
  if (salary.basis === "TOTAL") {
    return {
      result: "UNKNOWN",
      confidence: "LOW",
      reason: `Published ${range}/month is total compensation; base salary is unconfirmed against the ${fmt(floor)} minimum.`,
      aed,
    };
  }
  const straddles = bottom < floor;
  return {
    result: "PASS",
    confidence: straddles ? "MEDIUM" : salary.basis === "BASE" ? "HIGH" : "MEDIUM",
    reason: straddles
      ? `Published ${range}/month straddles the ${fmt(floor)} minimum; top of range qualifies.`
      : `Published ${range}/month meets the ${fmt(floor)} minimum${salary.basis === "UNKNOWN" ? " (base vs total not stated)" : ""}.`,
    aed,
  };
}
