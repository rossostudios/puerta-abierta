import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import Script from "next/script";
import { cache, Suspense } from "react";

import { ListingGalleryLightbox } from "@/components/marketplace/listing-gallery-lightbox";
import { ListingInquiryForm } from "@/components/marketplace/listing-inquiry-form";
import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { TrustBadges } from "@/components/marketplace/trust-badges";
import { fetchPublicListing, fetchUsdPygRate } from "@/lib/api";
import { toMarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";
import { getActiveLocale } from "@/lib/i18n/server";
import { ListingAmenities } from "./components/listing-amenities";
import { ListingAvailability } from "./components/listing-availability";
import { ListingFeesCard } from "./components/listing-fees-card";
import { ListingHeader } from "./components/listing-header";
import { ListingLocation } from "./components/listing-location";
import { ListingMobileCta } from "./components/listing-mobile-cta";
import { ListingMoveInCard } from "./components/listing-move-in-card";
import { ListingShareButton } from "./components/listing-share-button";
import { RecentlyViewedTracker } from "./components/recently-viewed-tracker";
import { SimilarListings } from "./components/similar-listings";

type MarketplaceListingPageProps = {
  params: Promise<{ slug: string }>;
};

const resolveListing = cache(
  async (slug: string): Promise<Record<string, unknown>> => {
    let is404 = false;
    try {
      return await fetchPublicListing(slug);
    } catch (err) {
      unstable_rethrow(err);
      const message = err instanceof Error ? err.message : String(err);
      is404 = message.includes("(404)");
      if (!is404) throw err;
    }
    notFound();
  }
);

export async function generateMetadata({
  params,
}: MarketplaceListingPageProps): Promise<Metadata> {
  const locale = await getActiveLocale();
  const { slug } = await params;

  try {
    const listing = await resolveListing(slug);
    const vm = toMarketplaceListingViewModel({ listing, locale });

    const title = `${vm.title} | Casaora`;
    const description =
      vm.summary ||
      "Anuncio de alquiler de largo plazo con desglose transparente de costos.";
    const images = vm.coverImageUrl
      ? [{ url: vm.coverImageUrl, width: 1200, height: 630, alt: vm.title }]
      : [];

    return {
      title,
      description,
      alternates: {
        canonical: `/marketplace/${slug}`,
        languages: {
          "es-PY": `/marketplace/${slug}`,
          "en-US": `/marketplace/${slug}`,
        },
      },
      openGraph: {
        title,
        description,
        type: "article",
        siteName: "Casaora",
        locale: "es_PY",
        alternateLocale: "en_US",
        images,
      },
      twitter: {
        card: images.length > 0 ? "summary_large_image" : "summary",
        title,
        description,
        images: vm.coverImageUrl ? [vm.coverImageUrl] : [],
      },
    };
  } catch (err) {
    unstable_rethrow(err);
    return {
      title: "Marketplace listing | Casaora",
    };
  }
}

export default async function MarketplaceListingPage({
  params,
}: MarketplaceListingPageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const defaultOrgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID?.trim();
  const { slug } = await params;

  const [rawListing, usdPygRate] = await Promise.all([
    resolveListing(slug),
    fetchUsdPygRate(),
  ]);
  const listing = toMarketplaceListingViewModel({
    listing: rawListing,
    locale,
    usdPygRate,
  });

  if (
    defaultOrgId &&
    listing.organizationId &&
    listing.organizationId !== defaultOrgId
  ) {
    notFound();
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Residence",
    name: listing.title,
    description: listing.summary || listing.description,
    address: {
      "@type": "PostalAddress",
      addressLocality: listing.city,
      addressRegion: listing.neighborhood || undefined,
      addressCountry: "PY",
    },
    image: [listing.coverImageUrl, ...listing.galleryImageUrls].filter(Boolean),
    ...(listing.latitude && listing.longitude
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: listing.latitude,
            longitude: listing.longitude,
          },
        }
      : {}),
    ...(listing.monthlyRecurring > 0
      ? {
          offers: {
            "@type": "Offer",
            price: listing.monthlyRecurring,
            priceCurrency: listing.currency || "PYG",
            availability: "https://schema.org/InStock",
            description: isEn ? "Monthly rent" : "Alquiler mensual",
          },
        }
      : {}),
    numberOfRooms: listing.raw.bedrooms
      ? Number(listing.raw.bedrooms)
      : undefined,
    numberOfBathroomsTotal: listing.raw.bathrooms
      ? Number(listing.raw.bathrooms)
      : undefined,
    floorSize: listing.raw.square_meters
      ? {
          "@type": "QuantitativeValue",
          value: Number(listing.raw.square_meters),
          unitCode: "MTK",
        }
      : undefined,
    petsAllowed: listing.petPolicy === "allowed",
    amenityFeature: listing.amenities.map((a) => ({
      "@type": "LocationFeatureSpecification",
      name: a,
      value: true,
    })),
  };

  return (
    <div className="pa-marketplace-root min-h-dvh">
      <PublicHeader locale={locale} />

      <main className="mx-auto w-full max-w-[1400px] space-y-10 px-4 py-8 sm:px-6 lg:px-8">
        <ListingHeader
          city={listing.city}
          isEn={isEn}
          neighborhood={listing.neighborhood}
          specsLong={listing.specsLong}
          summary={listing.summary}
          title={listing.title}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <TrustBadges
            isEn={isEn}
            isTransparent={!!listing.raw.fee_breakdown_complete}
          />
          <ListingShareButton isEn={isEn} title={listing.title} />
        </div>

        <ListingGalleryLightbox
          coverImageUrl={listing.coverImageUrl}
          galleryImageUrls={listing.galleryImageUrls}
          isEn={isEn}
          title={listing.title}
        />

        <div className="grid min-w-0 gap-8 lg:grid-cols-[1fr_400px]">
          {/* Main content */}
          <div className="space-y-10">
            {listing.description ? (
              <section className="min-w-0">
                <h2 className="mb-4 font-medium font-serif text-[var(--marketplace-text)] text-xl tracking-tight">
                  {isEn ? "About this listing" : "Sobre este anuncio"}
                </h2>
                <div className="h-px bg-[#e8e4df]" />
                <p className="mt-4 whitespace-pre-wrap text-[var(--marketplace-text-muted)] text-sm leading-relaxed">
                  {listing.description}
                </p>
              </section>
            ) : null}

            <ListingAmenities amenities={listing.amenities} isEn={isEn} />

            <ListingAvailability
              availableFrom={listing.availableFrom}
              isEn={isEn}
              minimumLeaseMonths={listing.minimumLeaseMonths}
              slug={slug}
              unitId={
                typeof listing.raw.unit_id === "string"
                  ? listing.raw.unit_id
                  : undefined
              }
            />

            <ListingFeesCard isEn={isEn} listing={listing} />

            <ListingLocation
              city={listing.city}
              isEn={isEn}
              latitude={listing.latitude}
              longitude={listing.longitude}
              neighborhood={listing.neighborhood}
            />
          </div>

          {/* Sticky sidebar */}
          <div className="hidden lg:block">
            <div className="sticky top-20 space-y-5">
              <ListingMoveInCard isEn={isEn} listing={listing} slug={slug} />
              <ListingInquiryForm isEn={isEn} slug={slug} />
            </div>
          </div>
        </div>

        <Suspense
          fallback={
            <section className="space-y-4">
              <div className="h-6 w-48 animate-pulse rounded bg-muted" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from(
                  { length: 3 },
                  (_, index) => `similar-${index}`
                ).map((similarKey) => (
                  <div
                    className="h-64 animate-pulse rounded-2xl bg-muted"
                    key={similarKey}
                  />
                ))}
              </div>
            </section>
          }
        >
          <SimilarListings
            city={listing.city}
            currentSlug={slug}
            isEn={isEn}
            locale={locale}
            orgId={defaultOrgId || undefined}
            propertyType={listing.propertyType}
          />
        </Suspense>
      </main>

      <ListingMobileCta
        isEn={isEn}
        monthlyLabel={listing.monthlyRecurringLabel}
        monthlyUsdApprox={listing.monthlyRecurringUsdApprox}
        slug={slug}
        whatsappUrl={listing.whatsappUrl}
        bookingUrl={
          listing.bookingEnabled && listing.organizationSlug
            ? `/booking/${encodeURIComponent(listing.organizationSlug)}`
            : null
        }
      />

      <RecentlyViewedTracker slug={slug} />

      <Script id="marketplace-listing-jsonld" type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </Script>
      <PublicFooter locale={locale} />
    </div>
  );
}
