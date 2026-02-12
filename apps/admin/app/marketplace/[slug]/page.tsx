import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Script from "next/script";

import { ListingGallery } from "@/components/marketplace/listing-gallery";
import {
  asNumber,
  asOptionalNumber,
  asText,
} from "@/components/marketplace/marketplace-types";
import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { WhatsAppContactButton } from "@/components/marketplace/whatsapp-contact-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPublicMarketplaceListing } from "@/lib/api";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

type MarketplaceListingPageProps = {
  params: Promise<{ slug: string }>;
};

async function resolveListing(slug: string): Promise<Record<string, unknown>> {
  try {
    return await fetchPublicMarketplaceListing(slug);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("(404)")) {
      notFound();
    }
    throw err;
  }
}

function specsText(
  listing: Record<string, unknown>,
  locale: "es-PY" | "en-US"
): string {
  const isEn = locale === "en-US";
  const bedrooms = asOptionalNumber(listing.bedrooms);
  const bathrooms = asOptionalNumber(listing.bathrooms);
  const squareMeters = asOptionalNumber(listing.square_meters);
  const parts: string[] = [];

  if (bedrooms !== null)
    parts.push(`${bedrooms} ${isEn ? "bedrooms" : "habitaciones"}`);
  if (bathrooms !== null)
    parts.push(`${bathrooms} ${isEn ? "bathrooms" : "baños"}`);
  if (squareMeters !== null) parts.push(`${squareMeters} m²`);

  return parts.join(" · ");
}

export async function generateMetadata({
  params,
}: MarketplaceListingPageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const listing = await resolveListing(slug);
    const title = asText(listing.title) || "Marketplace listing";
    const summary = asText(listing.summary);
    return {
      title: `${title} | Puerta Abierta`,
      description:
        summary ||
        "Anuncio de alquiler de largo plazo con desglose transparente de costos.",
    };
  } catch {
    return {
      title: "Marketplace listing | Puerta Abierta",
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

  const listing = await resolveListing(slug);
  const listingOrgId = asText(listing.organization_id);
  if (defaultOrgId && listingOrgId && listingOrgId !== defaultOrgId) {
    notFound();
  }

  const title = asText(listing.title) || (isEn ? "Listing" : "Anuncio");
  const summary = asText(listing.summary);
  const description = asText(listing.description);
  const city = asText(listing.city) || "Asuncion";
  const neighborhood = asText(listing.neighborhood);
  const currency = asText(listing.currency) || "PYG";
  const coverImageUrl = asText(listing.cover_image_url);
  const galleryImageUrls = Array.isArray(listing.gallery_image_urls)
    ? listing.gallery_image_urls
    : [];
  const totalMoveIn = formatCurrency(
    asNumber(listing.total_move_in),
    currency,
    locale
  );
  const recurring = formatCurrency(
    asNumber(listing.monthly_recurring_total),
    currency,
    locale
  );
  const feeLines = Array.isArray(listing.fee_lines)
    ? (listing.fee_lines as Record<string, unknown>[])
    : [];
  const specs = specsText(listing, locale);
  const whatsappUrl = asText(listing.whatsapp_contact_url);
  const propertyType = asText(listing.property_type);
  const furnished = listing.furnished === true;
  const petPolicy = asText(listing.pet_policy);
  const parkingSpaces = asOptionalNumber(listing.parking_spaces);
  const minimumLeaseMonths = asOptionalNumber(listing.minimum_lease_months);
  const availableFrom = asText(listing.available_from);
  const maintenanceFee = asNumber(listing.maintenance_fee);
  const amenities = Array.isArray(listing.amenities)
    ? (listing.amenities as unknown[])
        .map((item) => asText(item).trim())
        .filter(Boolean)
    : [];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Residence",
    name: title,
    description: summary || description,
    address: {
      "@type": "PostalAddress",
      addressLocality: city,
      addressRegion: neighborhood || undefined,
      addressCountry: "PY",
    },
    image: [coverImageUrl, ...galleryImageUrls].filter(Boolean),
  };

  return (
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <PublicHeader locale={locale} />

      <main className="mx-auto w-full max-w-[1320px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="space-y-3">
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            href="/marketplace"
          >
            {isEn ? "Back to marketplace" : "Volver al marketplace"}
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{city}</Badge>
            {neighborhood ? (
              <Badge variant="outline">{neighborhood}</Badge>
            ) : null}
          </div>

          <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
            {title}
          </h1>
          {summary ? (
            <p className="max-w-3xl text-muted-foreground">{summary}</p>
          ) : null}
          {specs ? (
            <p className="text-muted-foreground text-sm">{specs}</p>
          ) : null}
        </header>

        <ListingGallery
          coverImageUrl={coverImageUrl}
          galleryImageUrls={galleryImageUrls}
          title={title}
        />

        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>
                {isEn ? "Transparent fee breakdown" : "Desglose transparente"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {feeLines.map((line) => (
                <div
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2 text-sm"
                  key={`${asText(line.fee_type)}-${asText(line.label)}-${asNumber(line.amount)}`}
                >
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-medium">
                      {asText(line.label)}
                    </p>
                    <p className="line-clamp-1 text-muted-foreground text-xs">
                      {humanizeKey(asText(line.fee_type))}
                    </p>
                  </div>
                  <p className="shrink-0 text-right font-medium">
                    {formatCurrency(asNumber(line.amount), currency, locale)}
                  </p>
                </div>
              ))}
              {feeLines.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {isEn
                    ? "No fee lines configured yet."
                    : "Todavía no hay líneas de costo configuradas."}
                </p>
              ) : null}

              <div className="mt-4 rounded-xl border border-border/70 bg-muted/15 p-3">
                <p className="mb-2 font-medium text-sm">
                  {isEn ? "Rental details" : "Detalles del alquiler"}
                </p>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <p>
                    {isEn ? "Property type" : "Tipo"}:{" "}
                    <span className="text-muted-foreground">
                      {propertyType || (isEn ? "Not set" : "Sin definir")}
                    </span>
                  </p>
                  <p>
                    {isEn ? "Furnished" : "Amoblado"}:{" "}
                    <span className="text-muted-foreground">
                      {furnished ? (isEn ? "Yes" : "Sí") : isEn ? "No" : "No"}
                    </span>
                  </p>
                  <p>
                    {isEn ? "Parking spaces" : "Estacionamiento"}:{" "}
                    <span className="text-muted-foreground">
                      {parkingSpaces ?? 0}
                    </span>
                  </p>
                  <p>
                    {isEn ? "Minimum lease" : "Contrato mínimo"}:{" "}
                    <span className="text-muted-foreground">
                      {minimumLeaseMonths
                        ? `${minimumLeaseMonths} ${isEn ? "months" : "meses"}`
                        : isEn
                          ? "Not set"
                          : "Sin definir"}
                    </span>
                  </p>
                  <p>
                    {isEn ? "Available from" : "Disponible desde"}:{" "}
                    <span className="text-muted-foreground">
                      {availableFrom || (isEn ? "Not set" : "Sin definir")}
                    </span>
                  </p>
                  <p>
                    {isEn ? "Pet policy" : "Mascotas"}:{" "}
                    <span className="text-muted-foreground">
                      {petPolicy || (isEn ? "Not set" : "Sin definir")}
                    </span>
                  </p>
                </div>
                {amenities.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {amenities.map((amenity) => (
                      <Badge key={amenity} variant="outline">
                        {amenity}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>
                {isEn ? "Move-in summary" : "Resumen de ingreso"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Total move-in" : "Costo total de ingreso"}
                </p>
                <p className="font-semibold text-2xl">{totalMoveIn}</p>
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Monthly recurring" : "Mensual recurrente"}:{" "}
                  {recurring}
                </p>
                {maintenanceFee > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    {isEn ? "Maintenance fee" : "Costo de mantenimiento"}:{" "}
                    {formatCurrency(maintenanceFee, currency, locale)}
                  </p>
                ) : null}
              </div>

              <Link
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                  "w-full"
                )}
                href={`/marketplace/apply/${encodeURIComponent(slug)}`}
              >
                {isEn ? "Apply now" : "Aplicar ahora"}
              </Link>

              {whatsappUrl ? (
                <WhatsAppContactButton
                  label={
                    isEn ? "Contact via WhatsApp" : "Contactar por WhatsApp"
                  }
                  listingSlug={slug}
                  whatsappUrl={whatsappUrl}
                />
              ) : null}
            </CardContent>
          </Card>
        </section>

        {description ? (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>
                {isEn ? "Listing details" : "Detalles del anuncio"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {description}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </main>

      <Script id="marketplace-listing-jsonld" type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </Script>
      <PublicFooter locale={locale} />
    </div>
  );
}
