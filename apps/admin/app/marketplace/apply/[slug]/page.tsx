import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPublicMarketplaceListing } from "@/lib/api";
import { toMarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

import { MarketplaceApplyForm } from "./apply-form";

type MarketplaceApplyPageProps = {
  params: Promise<{ slug: string }>;
};

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

  let rawListing: Record<string, unknown>;
  try {
    rawListing = await fetchPublicMarketplaceListing(slug);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("(404)")) {
      notFound();
    }
    throw err;
  }

  const listing = toMarketplaceListingViewModel({ listing: rawListing, locale });
  if (defaultOrgId && listing.organizationId && listing.organizationId !== defaultOrgId) {
    notFound();
  }

  return (
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <PublicHeader locale={locale} />

      <main className="mx-auto w-full max-w-[1240px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="space-y-3">
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            href={`/marketplace/${encodeURIComponent(slug)}`}
          >
            {isEn ? "Back to listing" : "Volver al anuncio"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{listing.city}</Badge>
            {listing.neighborhood ? <Badge variant="outline">{listing.neighborhood}</Badge> : null}
          </div>
          <h1 className="font-semibold text-3xl tracking-tight">
            {isEn ? "Application" : "Aplicación"}
          </h1>
        </header>

        <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{listing.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
                {listing.coverImageUrl ? (
                  <Image
                    alt={listing.title}
                    className="h-56 w-full object-cover"
                    height={720}
                    loading="lazy"
                    sizes="(max-width: 1024px) 100vw, 40vw"
                    src={listing.coverImageUrl}
                    unoptimized
                    width={1280}
                  />
                ) : (
                  <div className="flex h-56 items-center justify-center text-muted-foreground text-sm">
                    {isEn ? "No image" : "Sin imagen"}
                  </div>
                )}
              </div>
              {listing.specsLong ? (
                <p className="text-muted-foreground text-sm">{listing.specsLong}</p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {[
                  listing.propertyType,
                  listing.furnished ? (isEn ? "Furnished" : "Amoblado") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Total move-in" : "Costo total de ingreso"}
                </p>
                <p className="font-semibold text-2xl">{listing.totalMoveInLabel}</p>
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Monthly recurring" : "Mensual recurrente"}: {listing.monthlyRecurringLabel}
                </p>
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Available from" : "Disponible desde"}: {" "}
                  {listing.availableFrom || (isEn ? "Not set" : "Sin definir")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Minimum lease" : "Contrato mínimo"}: {" "}
                  {listing.minimumLeaseMonths
                    ? `${listing.minimumLeaseMonths} ${isEn ? "months" : "meses"}`
                    : isEn
                      ? "Not set"
                      : "Sin definir"}
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
