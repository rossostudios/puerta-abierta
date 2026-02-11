import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchPublicMarketplaceListings } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

type MarketplacePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function MarketplacePage({
  searchParams,
}: MarketplacePageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const query = await searchParams;
  const cityRaw = query.city;
  const qRaw = query.q;

  const city = typeof cityRaw === "string" ? cityRaw : "";
  const q = typeof qRaw === "string" ? qRaw : "";

  let listings: Record<string, unknown>[] = [];
  let apiError: string | null = null;

  try {
    const response = await fetchPublicMarketplaceListings({
      city,
      q,
      limit: 120,
    });
    listings = response.data ?? [];
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 md:p-10">
      <header className="space-y-2">
        <Badge variant="outline">
          {isEn ? "Long-term rentals" : "Alquileres de largo plazo"}
        </Badge>
        <h1 className="font-semibold text-3xl tracking-tight">
          {isEn ? "Marketplace" : "Marketplace"}
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          {isEn
            ? "Transparent move-in pricing for every listing in Paraguay."
            : "Precios de ingreso transparentes para cada anuncio en Paraguay."}
        </p>
      </header>

      <form className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_220px_auto]">
        <input
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          defaultValue={q}
          name="q"
          placeholder={
            isEn
              ? "Search by title, neighborhood..."
              : "Buscar por título, barrio..."
          }
          type="text"
        />
        <input
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          defaultValue={city}
          name="city"
          placeholder={isEn ? "City" : "Ciudad"}
          type="text"
        />
        <button
          className={cn(
            buttonVariants({ variant: "default", size: "default" })
          )}
          type="submit"
        >
          {isEn ? "Search" : "Buscar"}
        </button>
      </form>

      {apiError ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn
                ? "Could not load listings"
                : "No se pudieron cargar anuncios"}
            </CardTitle>
            <CardDescription>{apiError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {listings.map((listing) => {
          const slug = asText(listing.public_slug);
          const title =
            asText(listing.title) ||
            (isEn ? "Untitled listing" : "Anuncio sin título");
          const cityLabel = asText(listing.city) || "Asuncion";
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

          return (
            <Card key={asText(listing.id) || slug}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="secondary">{cityLabel}</Badge>
                  <Badge variant="outline">
                    {listing.fee_breakdown_complete
                      ? isEn
                        ? "Transparent"
                        : "Transparente"
                      : isEn
                        ? "Incomplete"
                        : "Incompleto"}
                  </Badge>
                </div>
                <CardTitle className="text-xl">{title}</CardTitle>
                <CardDescription>
                  {neighborhood ? `${neighborhood}, ${cityLabel}` : cityLabel}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">
                    {isEn ? "Total move-in" : "Costo total de ingreso"}
                  </p>
                  <p className="font-semibold text-lg">{totalMoveIn}</p>
                  <p className="text-muted-foreground text-xs">
                    {isEn ? "Monthly recurring" : "Total mensual recurrente"}:{" "}
                    {recurring}
                  </p>
                </div>

                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full"
                  )}
                  href={`/marketplace/${encodeURIComponent(slug)}`}
                >
                  {isEn ? "View listing" : "Ver anuncio"}
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {!apiError && listings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "No listings found" : "No se encontraron anuncios"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Try different filters or publish listings from admin."
                : "Prueba con otros filtros o publica anuncios desde el panel admin."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </main>
  );
}
