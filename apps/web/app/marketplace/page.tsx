import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SavedSearches } from "@/components/marketplace/saved-searches";
import { fetchPublicListings, fetchUsdPygRate } from "@/lib/api";
import {
  countMarketplaceActiveFilters,
  parseMarketplaceSearchFilters,
  sortMarketplaceListings,
  toMarketplaceListParams,
} from "@/lib/features/marketplace/query";
import {
  type MarketplaceListingViewModel,
  toMarketplaceListingViewModel,
} from "@/lib/features/marketplace/view-model";
import { getActiveLocale } from "@/lib/i18n/server";
import { CategoryPills } from "./components/category-pills";
import { FeaturedListings } from "./components/featured-listings";
import { MarketplaceFiltersForm } from "./components/marketplace-filters-form";
import { MarketplaceHero } from "./components/marketplace-hero";
import { MarketplaceResultsLayout } from "./components/marketplace-results-layout";
import { RecentlyViewedSection } from "./components/recently-viewed-section";

type MarketplacePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const title = "Casaora Marketplace";
  const description =
    "Alquileres de largo plazo con precios transparentes en Paraguay. Long-term rentals with transparent pricing in Paraguay.";

  return {
    title,
    description,
    alternates: {
      languages: {
        "es-PY": "/marketplace",
        "en-US": "/marketplace",
      },
    },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Casaora",
      locale: "es_PY",
      alternateLocale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function MarketplacePage({
  searchParams,
}: MarketplacePageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const defaultOrgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID?.trim();

  const query = await searchParams;
  const filters = parseMarketplaceSearchFilters(query);

  let listings: MarketplaceListingViewModel[] = [];
  let apiError: string | null = null;

  const orgIdParam = defaultOrgId || undefined;
  try {
    const [response, usdPygRate] = await Promise.all([
      fetchPublicListings(toMarketplaceListParams(filters, orgIdParam)),
      fetchUsdPygRate(),
    ]);
    const rawData = response.data;
    let dataArr: Record<string, unknown>[] = [];
    if (rawData != null) dataArr = rawData as Record<string, unknown>[];
    const records = sortMarketplaceListings(dataArr, filters.sort);
    listings = records.map((record, index) =>
      toMarketplaceListingViewModel({
        listing: record,
        locale,
        index,
        usdPygRate,
      })
    );
  } catch (err) {
    let msg = String(err);
    if (err instanceof Error) msg = err.message;
    apiError = msg;
  }

  const availableNow =
    typeof query.available_now === "string" && query.available_now === "true";
  if (availableNow) {
    const today = new Date().toISOString().slice(0, 10);
    listings = listings.filter(
      (l) => l.availableFrom && l.availableFrom <= today
    );
  }

  const activeFilters = countMarketplaceActiveFilters(filters);
  const hasActiveFilters = activeFilters > 0 || availableNow;

  return (
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <SiteHeader />

      <main className="mx-auto w-full max-w-[1560px] space-y-10 px-4 py-8 sm:px-6 sm:py-10 lg:space-y-14 lg:px-8 lg:py-12">
        <MarketplaceHero
          defaultCity={filters.city || undefined}
          defaultMaxBudget={filters.maxMonthly?.toString()}
          isEn={isEn}
        />

        <Suspense
          fallback={
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 6 }, (_, index) => `pill-${index}`).map(
                (pillKey) => (
                  <div
                    className="h-9 w-24 shrink-0 animate-pulse rounded-full bg-muted"
                    key={pillKey}
                  />
                )
              )}
            </div>
          }
        >
          <CategoryPills locale={locale} />
        </Suspense>

        {hasActiveFilters ? null : (
          <FeaturedListings isEn={isEn} listings={listings} locale={locale} />
        )}

        <Suspense
          fallback={
            <div className="h-10 w-48 animate-pulse rounded-lg bg-muted" />
          }
        >
          <SavedSearches isEn={isEn} />
        </Suspense>

        <section className="overflow-hidden rounded-2xl bg-white shadow-[var(--marketplace-card-shadow)]">
          <MarketplaceFiltersForm
            activeFilters={activeFilters}
            filters={filters}
            isEn={isEn}
          />

          <div className="p-4 sm:p-5 lg:p-6">
            <MarketplaceResultsLayout
              apiError={apiError}
              isEn={isEn}
              listings={listings}
              locale={locale}
              sortValue={filters.sort}
            />
          </div>
        </section>

        <RecentlyViewedSection
          isEn={isEn}
          listings={listings}
          locale={locale}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
