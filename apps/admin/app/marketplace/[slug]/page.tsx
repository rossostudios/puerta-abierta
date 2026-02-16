import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import { Suspense } from "react";

import { ListingGalleryLightbox } from "@/components/marketplace/listing-gallery-lightbox";
import { ListingInquiryForm } from "@/components/marketplace/listing-inquiry-form";
import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { TrustBadges } from "@/components/marketplace/trust-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

async function resolveListing(slug: string): Promise<Record<string, unknown>> {
  try {
    return await fetchPublicListing(slug);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("(404)")) {
      notFound();
    }
    throw err;
  }
}

export async function generateMetadata({
  params,
}: MarketplaceListingPageProps): Promise<Metadata> {
  const locale = await getActiveLocale();
  const { slug } = await params;

  try {
    const listing = await resolveListing(slug);
    const vm = toMarketplaceListingViewModel({ listing, locale });

    const title = `${vm.title} | Stoa`;
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
        siteName: "Stoa",
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
  } catch {
    return {
      title: "Marketplace listing | Stoa",
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
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <PublicHeader locale={locale} />

      <main className="mx-auto w-full max-w-[1320px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
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

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          {/* Main content */}
          <div className="space-y-8">
            {listing.description ? (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>
                    {isEn ? "About this listing" : "Sobre este anuncio"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {listing.description}
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <ListingAmenities amenities={listing.amenities} isEn={isEn} />

            <ListingAvailability
              availableFrom={listing.availableFrom}
              isEn={isEn}
              minimumLeaseMonths={listing.minimumLeaseMonths}
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
            <div className="sticky top-20 space-y-4">
              <ListingMoveInCard isEn={isEn} listing={listing} slug={slug} />
              <ListingInquiryForm isEn={isEn} slug={slug} />
            </div>
          </div>
        </div>

        <Suspense>
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
      />

      <RecentlyViewedTracker slug={slug} />

      <Script id="marketplace-listing-jsonld" type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </Script>
      <PublicFooter locale={locale} />
    </div>
  );
}
