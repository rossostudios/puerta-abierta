import {
  ArrowRight01Icon,
  Calendar02Icon,
  Home01Icon,
  Location01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";

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
  const specs: string[] = [];

  if (bedrooms !== null) specs.push(`${bedrooms} ${isEn ? "bed" : "hab"}`);
  if (bathrooms !== null) specs.push(`${bathrooms} ${isEn ? "bath" : "bano"}`);
  if (squareMeters !== null) specs.push(`${squareMeters} m2`);

  return specs.join(" • ");
}

export function MarketplaceListRow({
  listing,
  locale,
}: {
  listing: MarketplaceListingRecord;
  locale: "es-PY" | "en-US";
}) {
  const isEn = locale === "en-US";

  const slug = asText(listing.public_slug);
  const title =
    asText(listing.title) || (isEn ? "Untitled listing" : "Anuncio sin titulo");
  const city = asText(listing.city) || "Asuncion";
  const neighborhood = asText(listing.neighborhood);
  const coverImage = asText(listing.cover_image_url);
  const currency = asText(listing.currency) || "PYG";

  const totalMoveIn = formatCurrency(
    asNumber(listing.total_move_in),
    currency,
    locale
  );
  const monthly = formatCurrency(
    asNumber(listing.monthly_recurring_total),
    currency,
    locale
  );
  const specs = specsLabel(listing, locale);

  return (
    <article className="group rounded-3xl border border-border/70 bg-card/95 p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-all duration-150 ease-out hover:border-primary/35 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]">
      <div className="flex items-start gap-3">
        <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-2xl border border-border/70 bg-muted/40 sm:h-28 sm:w-36">
          {coverImage ? (
            <Image
              alt={title}
              className="object-cover"
              fill
              loading="lazy"
              sizes="(max-width: 640px) 44vw, 160px"
              src={coverImage}
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
              {isEn ? "No photo" : "Sin foto"}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground uppercase tracking-wide">
              <Icon icon={Location01Icon} size={13} />
              {city}
            </p>
            <Badge
              className="rounded-full border border-border/70 bg-muted/40 text-[10px] uppercase tracking-wide"
              variant="secondary"
            >
              {listing.fee_breakdown_complete
                ? isEn
                  ? "Transparent"
                  : "Transparente"
                : isEn
                  ? "Needs fees"
                  : "Faltan costos"}
            </Badge>
          </div>

          <h3 className="mt-1 line-clamp-1 font-semibold text-[1.02rem] tracking-tight">
            {title}
          </h3>

          <p className="line-clamp-1 text-muted-foreground text-xs">
            {neighborhood || city}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            {specs ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-muted-foreground">
                <Icon icon={Home01Icon} size={12} />
                {specs}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-muted-foreground">
              <Icon icon={Calendar02Icon} size={12} />
              {isEn ? "Long-term" : "Largo plazo"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-border/60 border-t pt-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground uppercase tracking-wide">
            <Icon icon={Wallet02Icon} size={12} />
            {isEn ? "Total move-in" : "Costo total de ingreso"}
          </p>
          <p className="truncate font-semibold text-[1.02rem] tracking-tight">
            {totalMoveIn}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {isEn ? "Monthly" : "Mensual"}: {monthly}
          </p>
        </div>

        <Link
          className="inline-flex h-9 items-center gap-1 rounded-2xl border border-border/80 bg-background px-3 font-medium text-sm transition-colors hover:bg-accent"
          href={`/marketplace/${encodeURIComponent(slug)}`}
        >
          {isEn ? "View" : "Ver"}
          <Icon icon={ArrowRight01Icon} size={14} />
        </Link>
      </div>
    </article>
  );
}
