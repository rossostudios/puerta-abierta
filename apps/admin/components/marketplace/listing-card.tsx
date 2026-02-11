import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  asNumber,
  asOptionalNumber,
  asText,
  type MarketplaceListingRecord,
} from "./marketplace-types";

function specsLabel(
  listing: MarketplaceListingRecord,
  locale: "es-PY" | "en-US"
): string {
  const isEn = locale === "en-US";
  const bedrooms = asOptionalNumber(listing.bedrooms);
  const bathrooms = asOptionalNumber(listing.bathrooms);
  const squareMeters = asOptionalNumber(listing.square_meters);
  const segments: string[] = [];

  if (bedrooms !== null) {
    segments.push(`${bedrooms} ${isEn ? "bed" : "hab"}`);
  }
  if (bathrooms !== null) {
    segments.push(`${bathrooms} ${isEn ? "bath" : "baño"}`);
  }
  if (squareMeters !== null) {
    segments.push(`${squareMeters} m²`);
  }

  return segments.join(" · ");
}

export function MarketplaceListingCard({
  listing,
  locale,
}: {
  listing: MarketplaceListingRecord;
  locale: "es-PY" | "en-US";
}) {
  const isEn = locale === "en-US";
  const slug = asText(listing.public_slug);
  const title =
    asText(listing.title) || (isEn ? "Untitled listing" : "Anuncio sin título");
  const cityLabel = asText(listing.city) || "Asuncion";
  const neighborhood = asText(listing.neighborhood);
  const currency = asText(listing.currency) || "PYG";
  const coverImage = asText(listing.cover_image_url);
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
  const specs = specsLabel(listing, locale);

  return (
    <Card className="overflow-hidden rounded-2xl border-border/80 shadow-none">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted/40">
        {coverImage ? (
          <Image
            alt={title}
            className="object-cover"
            fill
            loading="lazy"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            src={coverImage}
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
            {isEn ? "No image yet" : "Sin imagen"}
          </div>
        )}
      </div>

      <CardHeader className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">{cityLabel}</Badge>
          <Badge
            variant={listing.fee_breakdown_complete ? "secondary" : "outline"}
          >
            {listing.fee_breakdown_complete
              ? isEn
                ? "Transparent"
                : "Transparente"
              : isEn
                ? "Incomplete"
                : "Incompleto"}
          </Badge>
        </div>
        <CardTitle className="line-clamp-2 text-xl">{title}</CardTitle>
        <p className="text-muted-foreground text-sm">
          {neighborhood ? `${neighborhood}, ${cityLabel}` : cityLabel}
        </p>
        {specs ? (
          <p className="text-muted-foreground text-xs">{specs}</p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3 p-4 pt-0">
        <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {isEn ? "Total move-in" : "Costo total de ingreso"}
          </p>
          <p className="font-semibold text-lg">{totalMoveIn}</p>
          <p className="text-muted-foreground text-xs">
            {isEn ? "Monthly recurring" : "Mensual recurrente"}: {recurring}
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
}
