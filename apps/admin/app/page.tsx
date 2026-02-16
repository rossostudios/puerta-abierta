import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MarketplaceListingCard } from "@/components/marketplace/listing-card";
import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { fetchPublicListings } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const MARKETPLACE_V2_ENABLED = process.env.NEXT_PUBLIC_MARKETPLACE_V2 === "1";
const BRAND_V1_ENABLED = process.env.NEXT_PUBLIC_BRAND_V1 !== "0";

export const metadata: Metadata = {
  title: "Stoa",
  description:
    "Marketplace de alquileres de largo plazo en Paraguay con precios transparentes.",
};

function listingKey(listing: Record<string, unknown>): string {
  return String(
    listing.id ??
      listing.public_slug ??
      `${String(listing.title ?? "")}-${String(listing.city ?? "")}`
  );
}

export default async function PublicHomePage() {
  if (!MARKETPLACE_V2_ENABLED) {
    redirect("/app");
  }

  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const defaultOrgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID?.trim();

  let listings: Record<string, unknown>[] = [];
  try {
    const response = await fetchPublicListings({
      orgId: defaultOrgId || undefined,
      limit: 6,
    });
    listings = response.data ?? [];
  } catch {
    listings = [];
  }

  return (
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <PublicHeader locale={locale} />

      <main>
        <section className="relative overflow-hidden border-border/70 border-b">
          <div
            className={cn(
              "absolute inset-0",
              BRAND_V1_ENABLED
                ? "bg-[radial-gradient(circle_at_top,var(--marketplace-hero-glow)_0%,transparent_58%)]"
                : "bg-[radial-gradient(circle_at_top,#e9f2ff_0%,transparent_56%)]"
            )}
          />
          <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-16 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-24">
            <div className="max-w-2xl space-y-5">
              <Badge variant="outline">
                {isEn
                  ? "Paraguay long-term rentals"
                  : "Alquileres de largo plazo en Paraguay"}
              </Badge>
              <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl lg:text-6xl">
                {isEn
                  ? "Transparent move-in pricing, built for trust."
                  : "Precios de ingreso transparentes, diseñados para confianza."}
              </h1>
              <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
                {isEn
                  ? "Browse verified listings with full fee breakdowns: monthly rent, deposits, service fees, and recurring totals."
                  : "Explora anuncios verificados con desglose completo de costos: alquiler mensual, depósitos, honorarios y total recurrente."}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  className={cn(
                    buttonVariants({ variant: "default", size: "lg" })
                  )}
                  href="/marketplace"
                >
                  {isEn ? "Explore listings" : "Explorar anuncios"}
                </Link>
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" })
                  )}
                  href="/login"
                >
                  {isEn ? "Agency login" : "Ingreso agencias"}
                </Link>
              </div>
            </div>
            <div className="grid w-full max-w-sm grid-cols-1 gap-3 rounded-2xl border border-border/70 bg-card p-4">
              <p className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
                {isEn ? "How it works" : "Cómo funciona"}
              </p>
              <p className="text-sm">
                {isEn
                  ? "1. Browse with full costs visible."
                  : "1. Explora con costos completos visibles."}
              </p>
              <p className="text-sm">
                {isEn
                  ? "2. Submit structured application."
                  : "2. Envía una aplicación estructurada."}
              </p>
              <p className="text-sm">
                {isEn
                  ? "3. Receive operator response under SLA."
                  : "3. Recibe respuesta del operador bajo SLA."}
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-2xl tracking-tight">
                {isEn ? "Featured listings" : "Anuncios destacados"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "Every listing includes transparent move-in totals."
                  : "Cada anuncio incluye costos de ingreso transparentes."}
              </p>
            </div>
            <Link
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              href="/marketplace"
            >
              {isEn ? "View all" : "Ver todos"}
            </Link>
          </div>

          {listings.length ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {listings.map((listing) => (
                <MarketplaceListingCard
                  key={listingKey(listing)}
                  listing={listing}
                  locale={locale}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-border/70 bg-card p-8 text-center text-muted-foreground text-sm">
              {isEn
                ? "No published listings yet. Check back soon."
                : "Aún no hay anuncios publicados. Vuelve pronto."}
            </div>
          )}
        </section>
      </main>

      <PublicFooter locale={locale} />
    </div>
  );
}
