"use client";

import { useState } from "react";

import { MarketplaceListingCard } from "@/components/marketplace/listing-card";
import type { MarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";
import {
  clearRecentlyViewed,
  getRecentlyViewed,
} from "@/lib/features/marketplace/recently-viewed";
import type { Locale } from "@/lib/i18n";

type RecentlyViewedSectionProps = {
  listings: MarketplaceListingViewModel[];
  locale: Locale;
  isEn: boolean;
};

export function RecentlyViewedSection({
  listings,
  locale,
  isEn,
}: RecentlyViewedSectionProps) {
  const [recentSlugs, setRecentSlugs] = useState(() =>
    typeof window !== "undefined" ? getRecentlyViewed() : []
  );

  const recentListings = recentSlugs
    .map((slug) => listings.find((l) => l.slug === slug))
    .filter((l): l is MarketplaceListingViewModel => l !== undefined)
    .slice(0, 4);

  if (!recentListings.length) return null;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-2xl font-medium tracking-tight text-[var(--marketplace-text)]">
          {isEn ? "Recently viewed" : "Vistos recientemente"}
        </h2>
        <button
          className="text-xs text-[var(--marketplace-text-muted)] transition-colors hover:text-primary"
          onClick={() => {
            clearRecentlyViewed();
            setRecentSlugs([]);
          }}
          type="button"
        >
          {isEn ? "Clear" : "Limpiar"}
        </button>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {recentListings.map((listing) => (
          <MarketplaceListingCard
            key={listing.id || listing.slug}
            listing={listing.raw}
            locale={locale}
          />
        ))}
      </div>
    </section>
  );
}
