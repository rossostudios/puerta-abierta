import {
  FilterHorizontalIcon,
  Home01Icon,
  Location01Icon,
  Search01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import type { Metadata } from "next";
import Link from "next/link";

import { MarketplaceListRow } from "@/components/marketplace/marketplace-list-row";
import { MarketplaceMap } from "@/components/marketplace/marketplace-map";
import {
  asNumber,
  type MarketplaceListingRecord,
} from "@/components/marketplace/marketplace-types";
import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { fetchPublicMarketplaceListings } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/server";

type MarketplacePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type SortKey =
  | "featured"
  | "move_in_desc"
  | "move_in_asc"
  | "monthly_desc"
  | "monthly_asc";

const SORT_OPTIONS: readonly SortKey[] = [
  "featured",
  "move_in_desc",
  "move_in_asc",
  "monthly_desc",
  "monthly_asc",
];

function listingKey(listing: Record<string, unknown>): string {
  return String(
    listing.id ??
      listing.public_slug ??
      `${String(listing.title ?? "")}-${String(listing.city ?? "")}`
  );
}

function queryText(
  query: Record<string, string | string[] | undefined>,
  key: string
): string {
  const value = query[key];
  return typeof value === "string" ? value.trim() : "";
}

function queryNumber(
  query: Record<string, string | string[] | undefined>,
  key: string
): number | undefined {
  const value = queryText(query, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function querySort(
  query: Record<string, string | string[] | undefined>
): SortKey {
  const raw = queryText(query, "sort") as SortKey;
  return SORT_OPTIONS.includes(raw) ? raw : "featured";
}

function sortListings(
  listings: MarketplaceListingRecord[],
  sort: SortKey
): MarketplaceListingRecord[] {
  if (sort === "featured") return listings;

  const sorted = [...listings];
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

function sortLabel(sort: SortKey, isEn: boolean): string {
  switch (sort) {
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

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Puerta Abierta Marketplace",
    description:
      "Alquileres de largo plazo con precios transparentes en Paraguay.",
  };
}

export default async function MarketplacePage({
  searchParams,
}: MarketplacePageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const defaultOrgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID?.trim();

  const query = await searchParams;
  const q = queryText(query, "q");
  const city = queryText(query, "city");
  const neighborhood = queryText(query, "neighborhood");
  const minMonthly = queryNumber(query, "min_monthly");
  const maxMonthly = queryNumber(query, "max_monthly");
  const minBedrooms = queryNumber(query, "min_bedrooms");
  const minBathrooms = queryNumber(query, "min_bathrooms");
  const sort = querySort(query);

  let listings: MarketplaceListingRecord[] = [];
  let apiError: string | null = null;

  try {
    const response = await fetchPublicMarketplaceListings({
      city,
      neighborhood,
      q,
      minMonthly,
      maxMonthly,
      minBedrooms,
      minBathrooms,
      orgId: defaultOrgId || undefined,
      limit: 120,
    });
    listings = (response.data ?? []) as MarketplaceListingRecord[];
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err);
  }

  const sortedListings = sortListings(listings, sort);

  let activeFilters = 0;
  if (q) activeFilters += 1;
  if (city) activeFilters += 1;
  if (neighborhood) activeFilters += 1;
  if (minMonthly !== undefined) activeFilters += 1;
  if (maxMonthly !== undefined) activeFilters += 1;
  if (minBedrooms !== undefined) activeFilters += 1;
  if (minBathrooms !== undefined) activeFilters += 1;

  return (
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <PublicHeader locale={locale} />

      <main className="mx-auto w-full max-w-[1560px] px-3 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h1 className="font-semibold text-[1.8rem] tracking-tight sm:text-[2.1rem]">
              {isEn ? "Property marketplace" : "Marketplace de propiedades"}
            </h1>
            <p className="text-muted-foreground text-sm sm:text-[0.95rem]">
              {isEn
                ? "Explore transparent long-term listings with map-first discovery."
                : "Explora anuncios de largo plazo con precios transparentes y descubrimiento por mapa."}
            </p>
          </div>

          <div className="rounded-full border border-border/70 bg-card/90 px-3 py-1.5 text-muted-foreground text-xs">
            {isEn ? "Results" : "Resultados"}: {sortedListings.length}
          </div>
        </header>

        <section className="pa-marketplace-shell overflow-hidden rounded-[30px] border border-border/75">
          <form
            className="border-border/70 border-b p-3 sm:p-4"
            id="marketplace-filters"
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex h-11 min-w-[240px] flex-1 items-center gap-2 rounded-2xl border border-border/80 bg-card/85 px-3">
                <Icon
                  className="text-muted-foreground"
                  icon={Search01Icon}
                  size={17}
                />
                <input
                  className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                  defaultValue={q}
                  name="q"
                  placeholder={
                    isEn
                      ? "Search title or neighborhood"
                      : "Buscar titulo o barrio"
                  }
                  type="text"
                />
              </label>

              <label className="inline-flex h-11 min-w-[170px] items-center gap-2 rounded-2xl border border-border/80 bg-card/85 px-3">
                <Icon
                  className="text-muted-foreground"
                  icon={Location01Icon}
                  size={16}
                />
                <input
                  className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                  defaultValue={city}
                  name="city"
                  placeholder={isEn ? "City" : "Ciudad"}
                  type="text"
                />
              </label>

              <label className="inline-flex h-11 min-w-[190px] items-center gap-2 rounded-2xl border border-border/80 bg-card/85 px-3">
                <Icon
                  className="text-muted-foreground"
                  icon={Home01Icon}
                  size={16}
                />
                <input
                  className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                  defaultValue={neighborhood}
                  name="neighborhood"
                  placeholder={isEn ? "Neighborhood" : "Barrio"}
                  type="text"
                />
              </label>

              <label className="inline-flex h-11 min-w-[170px] items-center gap-2 rounded-2xl border border-border/80 bg-card/85 px-3">
                <Icon
                  className="text-muted-foreground"
                  icon={Wallet02Icon}
                  size={16}
                />
                <input
                  className="h-full w-20 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                  defaultValue={minMonthly ?? ""}
                  min={0}
                  name="min_monthly"
                  placeholder={isEn ? "Min month" : "Min mes"}
                  type="number"
                />
                <span className="text-muted-foreground text-xs">-</span>
                <input
                  className="h-full w-20 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                  defaultValue={maxMonthly ?? ""}
                  min={0}
                  name="max_monthly"
                  placeholder={isEn ? "Max month" : "Max mes"}
                  type="number"
                />
              </label>

              <label className="inline-flex h-11 min-w-[150px] items-center gap-2 rounded-2xl border border-border/80 bg-card/85 px-3">
                <Icon
                  className="text-muted-foreground"
                  icon={FilterHorizontalIcon}
                  size={16}
                />
                <select
                  className="h-full w-full bg-transparent text-sm outline-none"
                  defaultValue={sort}
                  name="sort"
                >
                  <option value="featured">
                    {isEn ? "Featured" : "Destacados"}
                  </option>
                  <option value="move_in_desc">
                    {isEn ? "Move-in high" : "Ingreso mayor"}
                  </option>
                  <option value="move_in_asc">
                    {isEn ? "Move-in low" : "Ingreso menor"}
                  </option>
                  <option value="monthly_desc">
                    {isEn ? "Monthly high" : "Mensual mayor"}
                  </option>
                  <option value="monthly_asc">
                    {isEn ? "Monthly low" : "Mensual menor"}
                  </option>
                </select>
              </label>

              <label className="inline-flex h-11 min-w-[124px] items-center gap-2 rounded-2xl border border-border/80 bg-card/85 px-3">
                <span className="text-muted-foreground text-xs">
                  {isEn ? "Beds" : "Hab"}
                </span>
                <input
                  className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                  defaultValue={minBedrooms ?? ""}
                  min={0}
                  name="min_bedrooms"
                  placeholder="0"
                  type="number"
                />
              </label>

              <label className="inline-flex h-11 min-w-[124px] items-center gap-2 rounded-2xl border border-border/80 bg-card/85 px-3">
                <span className="text-muted-foreground text-xs">
                  {isEn ? "Baths" : "Banos"}
                </span>
                <input
                  className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                  defaultValue={minBathrooms ?? ""}
                  min={0}
                  name="min_bathrooms"
                  placeholder="0"
                  step="0.5"
                  type="number"
                />
              </label>

              <button
                className="inline-flex h-11 items-center rounded-2xl bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                type="submit"
              >
                {isEn ? "Apply" : "Aplicar"}
              </button>

              <Link
                className="inline-flex h-11 items-center rounded-2xl border border-border/80 bg-card/80 px-4 font-medium text-sm transition-colors hover:bg-accent"
                href="/marketplace"
              >
                {isEn ? "Reset" : "Limpiar"}
              </Link>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
              <span>
                {isEn ? "Active filters" : "Filtros activos"}: {activeFilters}
              </span>
              <span>
                {isEn ? "Sorted by" : "Orden"}: {sortLabel(sort, isEn)}
              </span>
            </div>
          </form>

          <div className="grid lg:grid-cols-[390px_minmax(0,1fr)]">
            <aside className="order-2 border-border/70 border-t lg:order-1 lg:max-h-[74vh] lg:overflow-hidden lg:border-t-0 lg:border-r">
              <div className="border-border/70 border-b px-4 py-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Listing feed" : "Listado"}
                </p>
                <p className="font-medium text-sm">
                  {isEn
                    ? "Sorted by potential and transparency"
                    : "Ordenado por potencial y transparencia"}
                </p>
              </div>

              <div className="grid gap-3 p-3 sm:p-4 lg:max-h-[calc(74vh-64px)] lg:overflow-y-auto">
                {apiError ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {isEn
                          ? "Could not load listings"
                          : "No se pudieron cargar anuncios"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-muted-foreground text-sm">
                      {apiError}
                    </CardContent>
                  </Card>
                ) : sortedListings.length ? (
                  sortedListings.map((listing) => (
                    <MarketplaceListRow
                      key={listingKey(listing)}
                      listing={listing}
                      locale={locale}
                    />
                  ))
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {isEn
                          ? "No listings found"
                          : "No se encontraron anuncios"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-muted-foreground text-sm">
                      {isEn
                        ? "Try different filters or publish listings from admin."
                        : "Prueba otros filtros o publica anuncios desde el admin."}
                    </CardContent>
                  </Card>
                )}
              </div>
            </aside>

            <section className="order-1 p-3 sm:p-4 lg:order-2 lg:p-5">
              <MarketplaceMap listings={sortedListings} locale={locale} />
            </section>
          </div>
        </section>
      </main>

      <PublicFooter locale={locale} />
    </div>
  );
}
