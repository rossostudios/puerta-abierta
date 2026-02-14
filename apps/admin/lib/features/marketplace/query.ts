import {
  asNumber,
  asText,
  type MarketplaceListingRecord,
} from "@/components/marketplace/marketplace-types";

export type MarketplaceSortKey =
  | "featured"
  | "newest"
  | "move_in_desc"
  | "move_in_asc"
  | "monthly_desc"
  | "monthly_asc";

export type MarketplaceSearchFilters = {
  q: string;
  city: string;
  neighborhood: string;
  propertyType: string;
  furnished: boolean | undefined;
  petPolicy: string;
  minParking: number | undefined;
  minMonthly: number | undefined;
  maxMonthly: number | undefined;
  minBedrooms: number | undefined;
  minBathrooms: number | undefined;
  sort: MarketplaceSortKey;
};

type QueryInput = Record<string, string | string[] | undefined>;

const SORT_OPTIONS: readonly MarketplaceSortKey[] = [
  "featured",
  "newest",
  "move_in_desc",
  "move_in_asc",
  "monthly_desc",
  "monthly_asc",
];

const MAX_INTEGER_FILTER = 99;
const MAX_MONEY_FILTER = 999_999_999;

function readText(query: QueryInput, key: string): string {
  const value = query[key];
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNumber(
  query: QueryInput,
  key: string,
  bounds: { min: number; max: number }
): number | undefined {
  const raw = readText(query, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return clamp(parsed, bounds.min, bounds.max);
}

function readBoolean(query: QueryInput, key: string): boolean | undefined {
  const value = readText(query, key).toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes"].includes(value)) return true;
  if (["0", "false", "no"].includes(value)) return false;
  return undefined;
}

function readSort(query: QueryInput): MarketplaceSortKey {
  const raw = readText(query, "sort") as MarketplaceSortKey;
  return SORT_OPTIONS.includes(raw) ? raw : "featured";
}

export function parseMarketplaceSearchFilters(
  query: QueryInput
): MarketplaceSearchFilters {
  const minMonthly = readNumber(query, "min_monthly", {
    min: 0,
    max: MAX_MONEY_FILTER,
  });
  const maxMonthly = readNumber(query, "max_monthly", {
    min: 0,
    max: MAX_MONEY_FILTER,
  });

  const normalizedMinMonthly =
    minMonthly !== undefined &&
    maxMonthly !== undefined &&
    minMonthly > maxMonthly
      ? maxMonthly
      : minMonthly;

  return {
    q: readText(query, "q"),
    city: readText(query, "city"),
    neighborhood: readText(query, "neighborhood"),
    propertyType: readText(query, "property_type"),
    furnished: readBoolean(query, "furnished"),
    petPolicy: readText(query, "pet_policy"),
    minParking: readNumber(query, "min_parking", {
      min: 0,
      max: MAX_INTEGER_FILTER,
    }),
    minMonthly: normalizedMinMonthly,
    maxMonthly,
    minBedrooms: readNumber(query, "min_bedrooms", {
      min: 0,
      max: MAX_INTEGER_FILTER,
    }),
    minBathrooms: readNumber(query, "min_bathrooms", {
      min: 0,
      max: MAX_INTEGER_FILTER,
    }),
    sort: readSort(query),
  };
}

export function countMarketplaceActiveFilters(
  filters: MarketplaceSearchFilters
): number {
  let count = 0;
  if (filters.q) count += 1;
  if (filters.city) count += 1;
  if (filters.neighborhood) count += 1;
  if (filters.propertyType) count += 1;
  if (filters.furnished !== undefined) count += 1;
  if (filters.petPolicy) count += 1;
  if (filters.minParking !== undefined) count += 1;
  if (filters.minMonthly !== undefined) count += 1;
  if (filters.maxMonthly !== undefined) count += 1;
  if (filters.minBedrooms !== undefined) count += 1;
  if (filters.minBathrooms !== undefined) count += 1;
  return count;
}

export function toMarketplaceListParams(
  filters: MarketplaceSearchFilters,
  orgId?: string
): {
  city?: string;
  neighborhood?: string;
  q?: string;
  propertyType?: string;
  furnished?: boolean;
  petPolicy?: string;
  minParking?: number;
  minMonthly?: number;
  maxMonthly?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  orgId?: string;
  limit: number;
} {
  return {
    city: filters.city || undefined,
    neighborhood: filters.neighborhood || undefined,
    q: filters.q || undefined,
    propertyType: filters.propertyType || undefined,
    furnished: filters.furnished,
    petPolicy: filters.petPolicy || undefined,
    minParking: filters.minParking,
    minMonthly: filters.minMonthly,
    maxMonthly: filters.maxMonthly,
    minBedrooms: filters.minBedrooms,
    minBathrooms: filters.minBathrooms,
    orgId,
    limit: 120,
  };
}

export function sortMarketplaceListings(
  listings: MarketplaceListingRecord[],
  sort: MarketplaceSortKey
): MarketplaceListingRecord[] {
  if (sort === "featured") return listings;

  const sorted = [...listings];
  if (sort === "newest") {
    sorted.sort((a, b) => {
      const dateA = asText(a.available_from) || asText(a.created_at) || "";
      const dateB = asText(b.available_from) || asText(b.created_at) || "";
      return dateB.localeCompare(dateA);
    });
    return sorted;
  }
  if (sort === "move_in_desc") {
    sorted.sort(
      (a, b) => asNumber(b.total_move_in) - asNumber(a.total_move_in)
    );
    return sorted;
  }
  if (sort === "move_in_asc") {
    sorted.sort(
      (a, b) => asNumber(a.total_move_in) - asNumber(b.total_move_in)
    );
    return sorted;
  }
  if (sort === "monthly_desc") {
    sorted.sort(
      (a, b) =>
        asNumber(b.monthly_recurring_total) -
        asNumber(a.monthly_recurring_total)
    );
    return sorted;
  }

  sorted.sort(
    (a, b) =>
      asNumber(a.monthly_recurring_total) - asNumber(b.monthly_recurring_total)
  );
  return sorted;
}

export function marketplaceSortLabel(
  sort: MarketplaceSortKey,
  isEn: boolean
): string {
  switch (sort) {
    case "newest":
      return isEn ? "Newest first" : "Más nuevos";
    case "move_in_desc":
      return isEn ? "Move-in (high to low)" : "Ingreso (mayor a menor)";
    case "move_in_asc":
      return isEn ? "Move-in (low to high)" : "Ingreso (menor a mayor)";
    case "monthly_desc":
      return isEn ? "Monthly (high to low)" : "Mensual (mayor a menor)";
    case "monthly_asc":
      return isEn ? "Monthly (low to high)" : "Mensual (menor a mayor)";
    default:
      return isEn ? "Featured" : "Destacados";
  }
}
