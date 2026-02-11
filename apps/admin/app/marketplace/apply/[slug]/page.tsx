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
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

import { MarketplaceApplyForm } from "./apply-form";

type MarketplaceApplyPageProps = {
  params: Promise<{ slug: string }>;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function MarketplaceApplyPage({
  params,
}: MarketplaceApplyPageProps) {
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
  const city = asText(listing.city);
  const neighborhood = asText(listing.neighborhood);
  const currency = asText(listing.currency) || "PYG";
  const totalMoveIn = formatCurrency(
    asNumber(listing.total_move_in),
    currency,
    locale
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 md:p-10">
      <header className="space-y-3">
        <Link
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          href={`/marketplace/${encodeURIComponent(slug)}`}
        >
          {isEn ? "Back to listing" : "Volver al anuncio"}
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{city || "Asuncion"}</Badge>
          {neighborhood ? (
            <Badge variant="outline">{neighborhood}</Badge>
          ) : null}
        </div>

        <h1 className="font-semibold text-3xl tracking-tight">
          {isEn ? "Application" : "Aplicación"}
        </h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {isEn
              ? "Submit your details. The operator should respond in under two hours."
              : "Envía tus datos. El operador debería responder en menos de dos horas."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {isEn ? "Total move-in" : "Costo total de ingreso"}: {totalMoveIn}
          </p>
        </CardContent>
      </Card>

      <MarketplaceApplyForm listingSlug={slug} locale={locale} />
    </main>
  );
}
