import { WhatsappIcon } from "@hugeicons/core-free-icons";
import Image from "next/image";

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
  const specs = specsLabel(listing, locale);
  const availableFrom = asText(listing.available_from);
  const propertyType = asText(listing.property_type);
  const monthlyRaw = asNumber(listing.monthly_recurring_total);
  const monthlyUsdApprox =
    currency === "PYG" && monthlyRaw > 0
      ? `~$${Math.round(monthlyRaw / PYG_TO_USD_FALLBACK).toLocaleString("en-US")} USD`
      : null;
  const whatsappUrl = getSafeWhatsAppUrl(asText(listing.whatsapp_contact_url));

  return (
    <IntentPrefetchLink
      className="group block overflow-hidden rounded-xl bg-white transition-all duration-300 ease-out shadow-[var(--marketplace-card-shadow)] hover:shadow-[var(--marketplace-card-hover-shadow)] hover:-translate-y-0.5"
      href={`/marketplace/${encodeURIComponent(slug)}`}
    >
      <div className="relative aspect-[3/2] overflow-hidden bg-[var(--marketplace-bg-muted)]">
        {coverImage ? (
          <Image
            alt={title}
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
            fill
            loading="lazy"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            src={coverImage}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--marketplace-text-muted)] text-sm">
            {isEn ? "No image yet" : "Sin imagen"}
          </div>
        )}

        {/* Subtle gradient overlay at bottom */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/20 to-transparent" />

        {availableFrom ? (
          <span className="absolute top-3 left-3 rounded-lg bg-white/85 px-2.5 py-1 text-[11px] font-medium text-[var(--marketplace-text)] shadow-sm backdrop-blur-sm">
            {isEn ? "Available now" : "Disponible"}
          </span>
        ) : null}

        <FavoriteButton className="absolute top-3 right-3" slug={slug} />
      </div>

      <div className="space-y-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--marketplace-text-muted)]">
          {neighborhood ? `${neighborhood} · ${cityLabel}` : cityLabel}
        </p>

        <h3 className="line-clamp-1 font-serif text-lg font-medium tracking-tight text-[var(--marketplace-text)]">
          {title}
        </h3>

        {specs ? (
          <p className="text-sm tabular-nums text-[var(--marketplace-text-muted)]">
            {specs}
          </p>
        ) : null}

        {propertyType ? (
          <p className="text-xs text-[var(--marketplace-text-muted)]">
            {propertyType}
          </p>
        ) : null}

        <div className="flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-[var(--marketplace-text)]">
              {monthlyRecurring}
              <span className="font-normal text-[var(--marketplace-text-muted)] text-xs">
                {" "}
                /{isEn ? "month" : "mes"}
              </span>
            </p>
            {monthlyUsdApprox ? (
              <p className="text-xs text-[var(--marketplace-text-muted)]">
                {monthlyUsdApprox}
              </p>
            ) : null}
          </div>
          {whatsappUrl ? (
            <a
              aria-label="WhatsApp"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366] transition-colors hover:bg-[#25D366]/20"
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
