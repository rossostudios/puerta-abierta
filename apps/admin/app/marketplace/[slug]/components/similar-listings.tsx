import { MarketplaceListingCard } from "@/components/marketplace/listing-card";
import { fetchPublicMarketplaceListings } from "@/lib/api";
import {
  toMarketplaceListingViewModel,
  type MarketplaceListingViewModel,
} from "@/lib/features/marketplace/view-model";
import type { Locale } from "@/lib/i18n";

type SimilarListingsProps = {
  currentSlug: string;
  city: string;
  propertyType: string;
  locale: Locale;
  isEn: boolean;
  orgId?: string;
};

export async function SimilarListings({
  currentSlug,
  city,
  propertyType,
  locale,
  isEn,
  orgId,
}: SimilarListingsProps) {
  let similar: MarketplaceListingViewModel[] = [];

  try {
    const response = await fetchPublicMarketplaceListings({
      city: city || undefined,
      propertyType: propertyType || undefined,
      orgId,
      limit: 8,
    });
    const records = (response.data ?? []) as Record<string, unknown>[];
    similar = records
      .filter((r) => String(r.public_slug ?? "") !== currentSlug)
      .slice(0, 4)
      .map((record, index) =>
        toMarketplaceListingViewModel({ listing: record, locale, index })
      );
  } catch {
    return null;
  }

  if (!similar.length) return null;

  return (
    <section>
      <h2 className="mb-3 font-semibold text-lg tracking-tight">
        {isEn ? "Similar listings" : "Anuncios similares"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {similar.map((listing) => (
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
