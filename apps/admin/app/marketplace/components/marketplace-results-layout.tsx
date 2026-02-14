"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapsLocation01Icon } from "@hugeicons/core-free-icons";

import { MarketplaceListingCard } from "@/components/marketplace/listing-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <section>
      <div className="flex items-center justify-between px-1 pb-3">
        <p className="text-muted-foreground text-sm">
          {listings.length} {isEn ? "results" : "resultados"}
        </p>

        {hasMapToken ? (
          <button
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors lg:inline-flex",
              showMap
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/80 text-muted-foreground hover:text-foreground"
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
      ) : listings.length ? (
        <div
          className={cn(
            "grid gap-4",
            showMap
              ? "lg:grid-cols-[minmax(380px,1fr)_minmax(0,1.2fr)]"
              : ""
          )}
        >
          <div
            className={cn(
              "grid gap-4",
              showMap
                ? "sm:grid-cols-1 lg:max-h-[75vh] lg:overflow-y-auto lg:pr-2"
                : "sm:grid-cols-2 lg:grid-cols-3"
            )}
          >
            {listings.map((listing) => (
              <MarketplaceListingCard
                key={marketplaceListingKey(listing.raw)}
                listing={listing.raw}
                locale={locale}
              />
            ))}
          </div>

          {showMap ? (
            <div className="sticky top-20 hidden h-[75vh] lg:block">
              <InteractiveMap listings={listings} locale={locale} />
            </div>
          ) : null}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "No listings found" : "No se encontraron anuncios"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {isEn
              ? "Try different filters or check back soon."
              : "Prueba otros filtros o vuelve pronto."}
          </CardContent>
        </Card>
      )}

      {/* Mobile map FAB */}
      {hasMapToken && !showMap && listings.length > 0 ? (
        <MobileMapFab isEn={isEn} listings={listings} locale={locale} />
      ) : null}
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
        className="fixed bottom-6 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-5 py-3 font-medium text-background text-sm shadow-lg transition-transform hover:scale-105 lg:hidden"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Icon icon={MapsLocation01Icon} size={16} />
        {isEn ? "Map" : "Mapa"}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 bg-background lg:hidden">
          <div className="flex h-14 items-center justify-between border-b border-border/70 px-4">
            <p className="font-medium text-sm">
              {isEn ? "Map view" : "Vista mapa"}
            </p>
            <button
              className="rounded-lg border border-border/70 px-3 py-1.5 text-sm"
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
