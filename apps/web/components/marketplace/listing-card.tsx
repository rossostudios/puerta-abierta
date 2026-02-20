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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: listing card has many conditional renders for different listing permutations
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
  const minLease = asOptionalNumber(listing.minimum_lease_months);
  const isFurnished = listing.furnished === true;
  const monthlyRaw = asNumber(listing.monthly_recurring_total);
  const monthlyUsdApprox =
    currency === "PYG" && monthlyRaw > 0
      ? `~$${Math.round(monthlyRaw / PYG_TO_USD_FALLBACK).toLocaleString("en-US")} USD`
      : null;
  const whatsappUrl = getSafeWhatsAppUrl(asText(listing.whatsapp_contact_url));
  const orgName = asText(listing.organization_name);
  const hostName = asText(listing.host_name);
  const orgLogoUrl = asText(listing.organization_logo_url);
  const publisherName = orgName || hostName;

  return (
    <IntentPrefetchLink
      className="group block overflow-hidden rounded-xl bg-white shadow-[var(--marketplace-card-shadow)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[var(--marketplace-card-hover-shadow)]"
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

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/20 to-transparent" />

        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {availableFrom ? (
            <span className="rounded-lg bg-white/85 px-2.5 py-1 font-medium text-[11px] text-[var(--marketplace-text)] shadow-sm backdrop-blur-sm">
              {isEn ? "Available now" : "Disponible"}
            </span>
          ) : null}
          {minLease ? (
            <span className="rounded-lg bg-[var(--marketplace-text)]/85 px-2.5 py-1 font-medium text-[11px] text-white shadow-sm backdrop-blur-sm">
              {isEn ? `${minLease}+ Months` : `${minLease}+ Meses`}
            </span>
          ) : null}
        </div>

        <FavoriteButton className="absolute top-3 right-3" slug={slug} />
      </div>

      <div className="space-y-2 p-4">
        <p className="font-medium text-[var(--marketplace-text-muted)] text-xs uppercase tracking-wider">
          {neighborhood ? `${neighborhood} · ${cityLabel}` : cityLabel}
        </p>

        <h3 className="line-clamp-1 font-medium font-serif text-[var(--marketplace-text)] text-lg tracking-tight">
          {title}
        </h3>

        {specs ? (
          <p className="text-[var(--marketplace-text-muted)] text-sm tabular-nums">
            {specs}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
          {propertyType ? (
            <span className="inline-flex items-center rounded-md bg-[var(--marketplace-bg-muted)] px-2 py-1 font-medium text-[10px] text-[var(--marketplace-text-muted)] uppercase tracking-wider">
              {propertyType === "shared_room"
                ? isEn
                  ? "Shared Room"
                  : "Habitación compartida"
                : propertyType === "entire_place"
                  ? isEn
                    ? "Entire Place"
                    : "Lugar entero"
                  : propertyType}
            </span>
          ) : null}
          {isFurnished ? (
            <span className="inline-flex items-center rounded-md bg-[var(--marketplace-bg-muted)] px-2 py-1 font-medium text-[10px] text-[var(--marketplace-text-muted)] uppercase tracking-wider">
              {isEn ? "Furnished" : "Amoblado"}
            </span>
          ) : null}
        </div>

        <div className="flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="font-semibold text-[var(--marketplace-text)] text-xl tracking-tight">
              {monthlyRecurring}
              <span className="font-normal text-[var(--marketplace-text-muted)] text-xs">
                {" "}
                /{isEn ? "month" : "mes"}
              </span>
            </p>
            {monthlyUsdApprox ? (
              <p className="text-[var(--marketplace-text-muted)] text-xs">
                {monthlyUsdApprox}
              </p>
            ) : null}
          </div>
        </div>

        {publisherName || whatsappUrl ? (
          <div className="mt-4 flex items-center justify-between border-[#e8e4df]/60 border-t pt-4">
            {publisherName ? (
              <div className="flex items-center gap-2.5">
                {orgLogoUrl ? (
                  <div className="relative h-8 w-8 overflow-hidden rounded-full border border-[#e8e4df] bg-white">
                    <Image
                      alt={publisherName}
                      className="object-cover"
                      fill
                      src={orgLogoUrl}
                    />
                  </div>
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--marketplace-bg-muted)] font-medium text-[10px] text-[var(--marketplace-text-muted)] uppercase">
                    {publisherName.substring(0, 2)}
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="font-medium text-[10px] text-[var(--marketplace-text-muted)] uppercase tracking-wider">
                    {isEn ? "Listed by" : "Publicado por"}
                  </span>
                  <span className="font-medium text-[var(--marketplace-text)] text-sm leading-tight">
                    {publisherName}
                  </span>
                </div>
              </div>
            ) : (
              <div />
            )}
            {whatsappUrl ? (
              <a
                aria-label="WhatsApp"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-[#25D366]/10 px-3 font-medium text-[#25D366] text-xs transition-colors hover:bg-[#25D366]/20"
                href={whatsappUrl}
                onClick={(e) => e.stopPropagation()}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Icon icon={WhatsappIcon} size={14} />
                <span>{isEn ? "Message Host" : "Contactar"}</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </IntentPrefetchLink>
  );
}
