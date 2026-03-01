import type { ExpenseRow } from "./types";

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export { asNumber, asOptionalString, asString } from "@/lib/module-helpers";

export function safeIsoDate(value: string): string {
  return ISO_DATE_RE.test(value) ? value : "";
}

export function shortId(value: string): string {
  const text = value.trim();
  if (text.length <= 14) return text;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

export function sumByCurrency(rows: ExpenseRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const currency = (row.currency || "PYG").toUpperCase();
    totals[currency] = (totals[currency] ?? 0) + (row.amount ?? 0);
  }
  return totals;
}

export function sumAsPyg(rows: ExpenseRow[]): number | null {
  let total = 0;
  for (const row of rows) {
    const currency = (row.currency || "PYG").toUpperCase();
    const amount = row.amount ?? 0;
    if (!Number.isFinite(amount)) continue;
    if (currency === "PYG") {
      total += amount;
      continue;
    }
    if (currency === "USD") {
      const fx = row.fx_rate_to_pyg;
      if (!(typeof fx === "number" && Number.isFinite(fx) && fx > 0)) {
        return null;
      }
      total += amount * fx;
      continue;
    }
    return null;
  }
  return total;
}
