export function formatCurrency(
  value: unknown,
  currency = "PYG",
  locale = "es-PY"
): string {
  const number = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(number)) {
    return "-";
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "PYG" ? 0 : 2,
  }).format(number);
}

export function formatCompactCurrency(
  value: number,
  currency = "PYG",
  locale = "es-PY"
): string {
  if (Number.isNaN(value)) {
    return "-";
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatRelativeTime(
  timestamp: Date | string,
  isEn: boolean
): string {
  const time = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  const deltaMs = Date.now() - time.getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / (1000 * 60)));

  if (minutes < 60) return isEn ? `${minutes}m ago` : `${minutes}m atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isEn ? `${hours}h ago` : `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return isEn ? `${days}d ago` : `hace ${days}d`;
}

const RTF_CACHE: Record<string, Intl.RelativeTimeFormat> = {};
function getRtf(locale: string): Intl.RelativeTimeFormat {
  const key = locale === "en-US" ? "en" : "es";
  if (!RTF_CACHE[key]) {
    RTF_CACHE[key] = new Intl.RelativeTimeFormat(key, { numeric: "auto" });
  }
  return RTF_CACHE[key];
}

export function toRelativeTimeIntl(
  value: string | null | undefined,
  locale: string
): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(deltaSeconds);
  const rtf = getRtf(locale);

  if (abs < 60) return rtf.format(deltaSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(deltaSeconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(deltaSeconds / 3600), "hour");
  return rtf.format(Math.round(deltaSeconds / 86_400), "day");
}

export function humanizeKey(key: string): string {
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
