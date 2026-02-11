export type MarketplaceListingRecord = Record<string, unknown>;

export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asOptionalNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
