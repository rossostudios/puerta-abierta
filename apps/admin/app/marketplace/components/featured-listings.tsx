import { MarketplaceListingCard } from "@/components/marketplace/listing-card";
import type { MarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";
import type { Locale } from "@/lib/i18n";

type FeaturedListingsProps = {
  isEn: boolean;
  locale: Locale;
  listings: MarketplaceListingViewModel[];
};

export function FeaturedListings({
  isEn,
  locale,
  listings,
}: FeaturedListingsProps) {
  const featured = listings.slice(0, 6);

  if (!featured.length) return null;

  return (
    <section>
      <h2 className="mb-3 font-semibold text-lg tracking-tight">
        {isEn ? "Featured listings" : "Anuncios destacados"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featured.map((listing) => (
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
