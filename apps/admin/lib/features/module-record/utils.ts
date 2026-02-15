export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function asDateLabel(
  value: string,
  locale: "en-US" | "es-PY"
): string | null {
  if (!(ISO_DATE_TIME_RE.test(value) || ISO_DATE_RE.test(value))) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;

  if (ISO_DATE_RE.test(value)) {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date
    );
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function sortKeys(keys: string[]): string[] {
  const priority = [
    "id",
    "name",
    "title",
    "code",
    "status",
    "kind",
    "organization_id",
    "property_id",
    "unit_id",
    "integration_id",
    "guest_id",
    "reservation_id",
    "template_id",
    "created_at",
    "updated_at",
  ];

  const score = new Map(priority.map((key, index) => [key, index * 10]));
  const scoreFor = (key: string): number => {
    const direct = score.get(key);
    if (direct !== undefined) return direct;

    if (key.endsWith("_name")) {
      const idKey = `${key.slice(0, -5)}_id`;
      const idScore = score.get(idKey);
      if (idScore !== undefined) return idScore + 1;
    }

    return Number.POSITIVE_INFINITY;
  };

  return [...keys].sort((a, b) => {
    const aScore = scoreFor(a);
    const bScore = scoreFor(b);
    if (aScore !== bScore) return aScore - bScore;
    return a.localeCompare(b);
  });
}

export function toLabel(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function recordTitle(
  record: Record<string, unknown>,
  fallbackTitle: string
): string {
  const candidate = (record.name ??
    record.title ??
    record.public_name ??
    record.code ??
    record.id) as unknown;
  const text =
    typeof candidate === "string" && candidate.trim() ? candidate.trim() : "";
  if (text) return text;
  return fallbackTitle;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizedStatus(value: unknown): string {
  return asString(value).toLowerCase();
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

export function toDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function getFirstValue(
  row: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = asString(row[key]);
    if (value) return value;
  }
  return null;
}

export function getAmountInPyg(row: Record<string, unknown>): number {
  const amount = toNumber(row.amount);
  if (amount === null) return 0;

  const currency = asString(row.currency).toUpperCase();
  if (currency === "PYG" || !currency) return amount;

  if (currency === "USD") {
    const fx = toNumber(row.fx_rate_to_pyg);
    if (fx !== null && fx > 0) return amount * fx;
  }

  return 0;
}

export function convertAmountToPyg(
  amount: number,
  currency: string,
  fxRate?: number | null
): number {
  if (!Number.isFinite(amount)) return 0;
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!normalizedCurrency || normalizedCurrency === "PYG") return amount;
  if (normalizedCurrency === "USD") {
    if (typeof fxRate === "number" && fxRate > 0) return amount * fxRate;
    // Fallback only for dashboard estimates when FX is missing.
    return amount * 7300;
  }
  return amount;
}

export function daysUntilDate(target: Date, from: Date): number {
  const diffMs = target.getTime() - from.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function toRecordArray(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> =>
    Boolean(row && typeof row === "object")
  );
}
