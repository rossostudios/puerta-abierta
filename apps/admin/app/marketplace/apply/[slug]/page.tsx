import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  asNumber,
  asOptionalNumber,
  asText,
} from "@/components/marketplace/marketplace-types";
import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPublicMarketplaceListing } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

import { MarketplaceApplyForm } from "./apply-form";

type MarketplaceApplyPageProps = {
  params: Promise<{ slug: string }>;
};

function specsText(
  listing: Record<string, unknown>,
  locale: "es-PY" | "en-US"
): string {
  const isEn = locale === "en-US";
  const bedrooms = asOptionalNumber(listing.bedrooms);
  const bathrooms = asOptionalNumber(listing.bathrooms);
  const squareMeters = asOptionalNumber(listing.square_meters);
  const parts: string[] = [];
  if (bedrooms !== null) parts.push(`${bedrooms} ${isEn ? "bed" : "hab"}`);
  if (bathrooms !== null) parts.push(`${bathrooms} ${isEn ? "bath" : "baño"}`);
  if (squareMeters !== null) parts.push(`${squareMeters} m²`);
  return parts.join(" · ");
}

export async function generateMetadata({
  params,
}: MarketplaceApplyPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Apply | ${slug} | Puerta Abierta`,
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default async function MarketplaceApplyPage({
  params,
}: MarketplaceApplyPageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const defaultOrgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID?.trim();
  const { slug } = await params;

  let listing: Record<string, unknown>;
  try {
    listing = await fetchPublicMarketplaceListing(slug);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("(404)")) {
      notFound();
    }
    throw err;
  }

  const listingOrgId = asText(listing.organization_id);
  if (defaultOrgId && listingOrgId && listingOrgId !== defaultOrgId) {
    notFound();
  }

  const title = asText(listing.title) || (isEn ? "Listing" : "Anuncio");
  const city = asText(listing.city) || "Asuncion";
  const neighborhood = asText(listing.neighborhood);
  const currency = asText(listing.currency) || "PYG";
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
  const coverImageUrl = asText(listing.cover_image_url);
  const specs = specsText(listing, locale);

  return (
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <PublicHeader locale={locale} />

      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="space-y-3">
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            href={`/marketplace/${encodeURIComponent(slug)}`}
          >
            {isEn ? "Back to listing" : "Volver al anuncio"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{city}</Badge>
            {neighborhood ? (
              <Badge variant="outline">{neighborhood}</Badge>
            ) : null}
          </div>
          <h1 className="font-semibold text-3xl tracking-tight">
            {isEn ? "Application" : "Aplicación"}
          </h1>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
                {coverImageUrl ? (
                  <Image
                    alt={title}
                    className="h-56 w-full object-cover"
                    height={720}
                    loading="lazy"
                    sizes="(max-width: 1024px) 100vw, 40vw"
                    src={coverImageUrl}
                    unoptimized
                    width={1280}
                  />
                ) : (
                  <div className="flex h-56 items-center justify-center text-muted-foreground text-sm">
                    {isEn ? "No image" : "Sin imagen"}
                  </div>
                )}
              </div>
              {specs ? (
                <p className="text-muted-foreground text-sm">{specs}</p>
              ) : null}
              <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Total move-in" : "Costo total de ingreso"}
                </p>
                <p className="font-semibold text-2xl">{totalMoveIn}</p>
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Monthly recurring" : "Mensual recurrente"}:{" "}
                  {recurring}
                </p>
              </div>
              <p className="text-muted-foreground text-xs">
                {isEn
                  ? "SLA target: first response within 2 hours."
                  : "Objetivo SLA: primera respuesta en menos de 2 horas."}
              </p>
            </CardContent>
          </Card>

          <MarketplaceApplyForm listingSlug={slug} locale={locale} />
        </section>
      </main>

      <PublicFooter locale={locale} />
    </div>
  );
}
