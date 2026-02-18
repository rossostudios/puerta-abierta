"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapsLocation01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { MarketplaceListingCard } from "@/components/marketplace/listing-card";
import {
  CompareCheckbox,
  ComparisonBar,
  useListingComparison,
} from "@/components/marketplace/listing-comparison";
import { Icon } from "@/components/ui/icon";
import {
  marketplaceListingKey,
  type MarketplaceListingViewModel,
} from "@/lib/features/marketplace/view-model";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const InteractiveMap = dynamic(
  () =>
    import("@/components/marketplace/interactive-map").then(
      (mod) => mod.InteractiveMap
    ),
  { ssr: false }
);

type MarketplaceResultsLayoutProps = {
  locale: Locale;
  isEn: boolean;
  apiError: string | null;
  listings: MarketplaceListingViewModel[];
};

export function MarketplaceResultsLayout({
  locale,
  isEn,
  apiError,
  listings,
}: MarketplaceResultsLayoutProps) {
  const [showMap, setShowMap] = useState(false);
  const hasMapToken = !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const comparison = useListingComparison();

  return (
    <section>
      <div className="flex items-center justify-between px-1 pb-4">
        <p className="text-sm text-[var(--marketplace-text-muted)]">
          <span className="font-serif text-lg font-medium text-[var(--marketplace-text)]">
            {listings.length}
          </span>{" "}
          {isEn ? "properties" : "propiedades"}
        </p>

        {hasMapToken ? (
          <button
            className={cn(
              "hidden items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors lg:inline-flex",
              showMap
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-[#e8e4df] text-[var(--marketplace-text-muted)] hover:text-[var(--marketplace-text)]"
            )}
            onClick={() => setShowMap((v) => !v)}
            type="button"
          >
            <Icon icon={MapsLocation01Icon} size={13} />
            {showMap
              ? isEn
                ? "Hide map"
                : "Ocultar mapa"
              : isEn
                ? "Show map"
                : "Ver mapa"}
          </button>
        ) : null}
      </div>

      {apiError ? (
        <div className="rounded-2xl bg-white p-6 shadow-[var(--marketplace-card-shadow)]">
          <h3 className="font-serif text-lg font-medium text-[var(--marketplace-text)]">
            {isEn
              ? "Could not load listings"
              : "No se pudieron cargar anuncios"}
          </h3>
          <p className="mt-2 text-sm text-[var(--marketplace-text-muted)]">
            {apiError}
          </p>
        </div>
      ) : listings.length ? (
        <div
          className={cn(
            "grid gap-6",
            showMap
              ? "lg:grid-cols-[minmax(380px,1fr)_minmax(0,1.2fr)]"
              : ""
          )}
        >
          <div
            className={cn(
              "@container grid gap-6",
              showMap
                ? "sm:grid-cols-1 lg:max-h-[75vh] lg:overflow-y-auto lg:pr-2"
                : "sm:grid-cols-2 lg:grid-cols-3 @[900px]:grid-cols-3"
            )}
          >
            {listings.map((listing) => (
              <div className="relative" key={marketplaceListingKey(listing.raw)}>
                <MarketplaceListingCard
                  listing={listing.raw}
                  locale={locale}
                />
                <div className="absolute left-2 top-2 z-10">
                  <CompareCheckbox
                    isEn={isEn}
                    isSelected={comparison.isSelected(listing.raw)}
                    listing={listing.raw}
                    onToggle={comparison.toggle}
                  />
                </div>
              </div>
            ))}
          </div>

          {showMap ? (
            <div className="sticky top-20 hidden h-[75vh] lg:block">
              <InteractiveMap listings={listings} locale={locale} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--marketplace-bg-muted)]">
            <Icon className="text-[var(--marketplace-text-muted)]" icon={Search01Icon} size={24} />
          </div>
          <h3 className="mb-2 font-serif text-xl font-medium text-[var(--marketplace-text)]">
            {isEn
              ? "No listings match your filters"
              : "Ningún anuncio coincide con tus filtros"}
          </h3>
          <p className="mb-6 max-w-sm text-sm text-[var(--marketplace-text-muted)]">
            {isEn
              ? "Try broadening your search or resetting filters."
              : "Intentá ampliar tu búsqueda o restablecer los filtros."}
          </p>
          <Link
            className="inline-flex h-10 items-center rounded-xl border border-[#e8e4df] bg-white px-5 text-sm font-medium text-[var(--marketplace-text)] transition-colors hover:bg-[var(--marketplace-bg-muted)]"
            href="/marketplace"
          >
            {isEn ? "Reset all filters" : "Restablecer filtros"}
          </Link>
        </div>
      )}

      {/* Mobile map FAB */}
      {hasMapToken && !showMap && listings.length > 0 ? (
        <MobileMapFab isEn={isEn} listings={listings} locale={locale} />
      ) : null}

      <ComparisonBar
        isEn={isEn}
        locale={locale}
        onClear={comparison.clear}
        onRemove={comparison.remove}
        selected={comparison.selected}
      />
    </section>
  );
}

function MobileMapFab({
  isEn,
  listings,
  locale,
}: {
  isEn: boolean;
  listings: MarketplaceListingViewModel[];
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="fixed bottom-6 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--marketplace-text)] px-5 py-3 font-medium text-white text-sm shadow-lg transition-transform hover:scale-105 lg:hidden"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Icon icon={MapsLocation01Icon} size={16} />
        {isEn ? "Map" : "Mapa"}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 bg-[var(--marketplace-bg)] lg:hidden">
          <div className="flex h-14 items-center justify-between border-b border-[#e8e4df] px-4">
            <p className="font-serif font-medium text-sm">
              {isEn ? "Map view" : "Vista mapa"}
            </p>
            <button
              className="rounded-lg border border-[#e8e4df] px-3 py-1.5 text-sm"
              onClick={() => setOpen(false)}
              type="button"
            >
              {isEn ? "Close" : "Cerrar"}
            </button>
          </div>
          <div className="h-[calc(100dvh-56px)]">
            <InteractiveMap listings={listings} locale={locale} />
          </div>
        </div>
      ) : null}
    </>
  );
}
