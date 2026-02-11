import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchPublicMarketplaceListing } from "@/lib/api";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

type MarketplaceListingPageProps = {
  params: Promise<{ slug: string }>;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function MarketplaceListingPage({
  params,
}: MarketplaceListingPageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
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

  const title = asText(listing.title);
  const description = asText(listing.description);
  const summary = asText(listing.summary);
  const city = asText(listing.city);
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

  const feeLines = Array.isArray(listing.fee_lines)
    ? (listing.fee_lines as Record<string, unknown>[])
    : [];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-10">
      <header className="space-y-3">
        <Link
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          href="/marketplace"
        >
          {isEn ? "Back to marketplace" : "Volver al marketplace"}
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{city || "Asuncion"}</Badge>
          {neighborhood ? (
            <Badge variant="outline">{neighborhood}</Badge>
          ) : null}
        </div>

        <h1 className="font-semibold text-3xl tracking-tight">{title}</h1>
        {summary ? <p className="text-muted-foreground">{summary}</p> : null}
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>
              {isEn ? "Move-in cost" : "Costo total de ingreso"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Canonical totals calculated by backend."
                : "Totales canónicos calculados por backend."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-semibold text-2xl">{totalMoveIn}</p>
            <p className="text-muted-foreground text-sm">
              {isEn ? "Monthly recurring" : "Mensual recurrente"}: {recurring}
            </p>
            <Link
              className={cn(
                buttonVariants({ variant: "default", size: "sm" }),
                "mt-3 w-full"
              )}
              href={`/marketplace/apply/${encodeURIComponent(slug)}`}
            >
              {isEn ? "Apply now" : "Aplicar ahora"}
            </Link>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              {isEn ? "Transparent fee breakdown" : "Desglose transparente"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Every fee line required before publish."
                : "Cada línea obligatoria requerida antes de publicar."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {feeLines.map((line, index) => (
                <div
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  key={`${asText(line.fee_type)}-${index}`}
                >
                  <div className="space-y-0.5">
                    <p className="font-medium">{asText(line.label)}</p>
                    <p className="text-muted-foreground text-xs">
                      {humanizeKey(asText(line.fee_type))}
                      {line.is_recurring
                        ? isEn
                          ? " · recurring"
                          : " · recurrente"
                        : ""}
                    </p>
                  </div>
                  <p className="font-medium">
                    {formatCurrency(asNumber(line.amount), currency, locale)}
                  </p>
                </div>
              ))}
              {feeLines.length ? null : (
                <p className="text-muted-foreground text-sm">
                  {isEn
                    ? "No fee lines configured yet."
                    : "Todavía no hay líneas de costo configuradas."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {description ? (
        <Card>
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
  );
}
