"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";

import { ListingAmenities } from "@/app/marketplace/[slug]/components/listing-amenities";
import { ListingAvailability } from "@/app/marketplace/[slug]/components/listing-availability";
import { ListingFeesCard } from "@/app/marketplace/[slug]/components/listing-fees-card";
import { ListingHeader } from "@/app/marketplace/[slug]/components/listing-header";
import { ListingMoveInCard } from "@/app/marketplace/[slug]/components/listing-move-in-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { authedFetch } from "@/lib/features/listings/listings-api";
import { toMarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";
import type { Locale } from "@/lib/i18n";

type ListingPreviewModalProps = {
  listingId: string;
  slug: string;
  isPublished: boolean;
  isEn: boolean;
  locale: Locale;
  onClose: () => void;
};

export function ListingPreviewModal({
  listingId,
  slug,
  isPublished,
  isEn,
  locale,
  onClose,
}: ListingPreviewModalProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["listing-preview", listingId],
    queryFn: () =>
      authedFetch<Record<string, unknown>>(
        `/listings/${encodeURIComponent(listingId)}`
      ),
  });

  const listing = data
    ? toMarketplaceListingViewModel({ listing: data, locale })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">
            {isEn ? "Preview" : "Vista previa"} &mdash;{" "}
            <span className="text-muted-foreground">casaora.co/{slug}</span>
          </span>
          {!isPublished && (
            <Badge variant="outline">
              {isEn ? "DRAFT" : "BORRADOR"}
            </Badge>
          )}
        </div>
        <Button onClick={onClose} size="sm" variant="ghost">
          <Icon icon={Cancel01Icon} size={18} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-muted-foreground">
              {isEn ? "Loading..." : "Cargando..."}
            </p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-destructive">
              {isEn
                ? "Failed to load listing"
                : "Error al cargar anuncio"}
            </p>
          </div>
        ) : listing ? (
          <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
            {/* Gallery preview */}
            {(listing.coverImageUrl || listing.galleryImageUrls.length > 0) && (
              <div className="grid gap-2 sm:grid-cols-2">
                {(listing.coverImageUrl
                  ? [listing.coverImageUrl, ...listing.galleryImageUrls]
                  : listing.galleryImageUrls
                )
                  .slice(0, 5)
                  .map((url, i) => (
                    <div
                      className={`relative overflow-hidden rounded-lg ${
                        i === 0 ? "sm:col-span-2 h-64 sm:h-80" : "h-64"
                      }`}
                      key={url}
                    >
                      <Image
                        alt={`${listing.title} ${i + 1}`}
                        className="object-cover"
                        fill
                        sizes="(max-width: 640px) 100vw, 50vw"
                        src={url}
                      />
                    </div>
                  ))}
              </div>
            )}

            <ListingHeader
              city={listing.city}
              isEn={isEn}
              neighborhood={listing.neighborhood}
              specsLong={listing.specsLong}
              summary={listing.summary}
              title={listing.title}
            />

            <div className="grid gap-8 lg:grid-cols-3">
              <div className="space-y-8 lg:col-span-2">
                {listing.description && (
                  <div className="prose max-w-none text-sm">
                    <p>{listing.description}</p>
                  </div>
                )}

                {listing.amenities.length > 0 && (
                  <ListingAmenities
                    amenities={listing.amenities}
                    isEn={isEn}
                  />
                )}

                {(listing.availableFrom ||
                  listing.minimumLeaseMonths) && (
                  <ListingAvailability
                    availableFrom={listing.availableFrom}
                    isEn={isEn}
                    minimumLeaseMonths={listing.minimumLeaseMonths}
                  />
                )}
              </div>

              <div className="space-y-4">
                <ListingFeesCard isEn={isEn} listing={listing} />
                <ListingMoveInCard
                  isEn={isEn}
                  listing={listing}
                  slug={slug}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
