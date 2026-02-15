import type { ExpenseRow } from "./types";

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

export function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim();
  return text ? text : null;
}

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
