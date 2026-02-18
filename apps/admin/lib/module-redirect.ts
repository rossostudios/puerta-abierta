export type LegacyRouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function buildRedirectPath(
  pathname: string,
  searchParams: LegacyRouteSearchParams,
  overrides: Record<string, string | undefined>
): string {
  const query = new URLSearchParams();

  for (const [key, raw] of Object.entries(searchParams)) {
    if (typeof raw === "string") {
      query.set(key, raw);
      continue;
    }
    if (Array.isArray(raw) && typeof raw[0] === "string") {
      query.set(key, raw[0]);
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string" && value.trim().length > 0) {
      query.set(key, value);
    } else {
      query.delete(key);
    }
  }

  const suffix = query.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}
