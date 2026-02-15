import { SecurityCheckIcon, WhatsappIcon } from "@hugeicons/core-free-icons";
import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { PYG_TO_USD_FALLBACK } from "@/lib/features/marketplace/view-model";
import { formatCurrency } from "@/lib/format";
import { getSafeWhatsAppUrl } from "@/lib/security/safe-external-url";
import { FavoriteButton } from "./favorite-button";
import { IntentPrefetchLink } from "./intent-prefetch-link";
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
  const monthlyRecurring = formatCurrency(
    asNumber(listing.monthly_recurring_total),
    currency,
    locale
  );
  const totalMoveIn = formatCurrency(
    asNumber(listing.total_move_in),
    currency,
    locale
  );
  const specs = specsLabel(listing, locale);
  const availableFrom = asText(listing.available_from);
  const propertyType = asText(listing.property_type);
  const furnished = listing.furnished === true;
  const monthlyRaw = asNumber(listing.monthly_recurring_total);
  const monthlyUsdApprox =
    currency === "PYG" && monthlyRaw > 0
      ? `~$${Math.round(monthlyRaw / PYG_TO_USD_FALLBACK).toLocaleString("en-US")} USD`
      : null;
  const whatsappUrl = getSafeWhatsAppUrl(asText(listing.whatsapp_contact_url));

  return (
    <IntentPrefetchLink
      className="group block overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-[0_1px_0_rgba(15,23,42,0.03)] transition-all duration-200 ease-out hover:border-primary/30 hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
      href={`/marketplace/${encodeURIComponent(slug)}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted/40">
        {coverImage ? (
          <Image
            alt={title}
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
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

        {availableFrom ? (
          <span className="absolute top-3 left-3 rounded-full bg-background/90 px-2.5 py-1 font-medium text-[11px] text-foreground shadow-sm backdrop-blur-sm">
            {isEn ? "From" : "Desde"} {availableFrom}
          </span>
        ) : null}

        <FavoriteButton className="absolute top-3 right-3" slug={slug} />

        <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium text-emerald-700 shadow-sm backdrop-blur-sm dark:text-emerald-400">
          <Icon icon={SecurityCheckIcon} size={10} />
          {isEn ? "Verified" : "Verificado"}
        </span>
      </div>

      <div className="space-y-1.5 p-3.5">
        <p className="text-[12px] text-muted-foreground">
          {neighborhood ? `${neighborhood}, ${cityLabel}` : cityLabel}
        </p>

        <h3 className="line-clamp-1 font-semibold text-[0.95rem] tracking-tight">
          {title}
        </h3>

        {specs ? (
          <p className="text-muted-foreground text-xs">{specs}</p>
        ) : null}

        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {propertyType ? (
            <Badge
              className="rounded-full border-border/60 px-2 py-0 text-[10px]"
              variant="outline"
            >
              {propertyType}
            </Badge>
          ) : null}
          <Badge
            className="rounded-full border-border/60 px-2 py-0 text-[10px]"
            variant="outline"
          >
            {furnished
              ? isEn
                ? "Furnished"
                : "Amoblado"
              : isEn
                ? "Unfurnished"
                : "Sin amoblar"}
          </Badge>
        </div>

        <div className="flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="font-bold text-lg leading-tight tracking-tight">
              {monthlyRecurring}
              <span className="font-normal text-muted-foreground text-xs">
                {" "}
                /{isEn ? "month" : "mes"}
              </span>
            </p>
            {monthlyUsdApprox ? (
              <p className="text-muted-foreground text-[11px]">
                {monthlyUsdApprox}
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {isEn ? "Move-in total" : "Total ingreso"}: {totalMoveIn}
            </p>
          </div>
          {whatsappUrl ? (
            <a
              aria-label="WhatsApp"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366] transition-colors hover:bg-[#25D366]/20"
              href={whatsappUrl}
              onClick={(e) => e.stopPropagation()}
              rel="noopener noreferrer"
              target="_blank"
            >
              <Icon icon={WhatsappIcon} size={16} />
            </a>
          ) : null}
        </div>
      </div>
    </IntentPrefetchLink>
  );
}
