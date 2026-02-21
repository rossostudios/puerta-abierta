import {
  ArrowRight01Icon,
  MapsLocation01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
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

const PIN_POSITIONS: ReadonlyArray<{ left: string; top: string }> = [
  { left: "18%", top: "22%" },
  { left: "63%", top: "24%" },
  { left: "33%", top: "44%" },
  { left: "74%", top: "46%" },
  { left: "24%", top: "57%" },
  { left: "53%", top: "54%" },
];

function compactCurrency(
  amount: number,
  currency: string,
  locale: "es-PY" | "en-US"
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatCurrency(amount, currency, locale);
  }
}

function specsLabel(
  listing: MarketplaceListingRecord,
  locale: "es-PY" | "en-US"
): string {
  const isEn = locale === "en-US";
  const bedrooms = asOptionalNumber(listing.bedrooms);
  const bathrooms = asOptionalNumber(listing.bathrooms);
  const squareMeters = asOptionalNumber(listing.square_meters);

  const chunks: string[] = [];
  if (bedrooms !== null) chunks.push(`${bedrooms} ${isEn ? "bed" : "hab"}`);
  if (bathrooms !== null) chunks.push(`${bathrooms} ${isEn ? "bath" : "bano"}`);
  if (squareMeters !== null) chunks.push(`${squareMeters} m2`);

  return chunks.join(" • ");
}

export function MarketplaceMap({
  listings,
  locale,
}: {
  listings: MarketplaceListingRecord[];
  locale: "es-PY" | "en-US";
}) {
  const isEn = locale === "en-US";
  const mapListings = listings.slice(0, 6);
  const spotlight = mapListings[0] ?? null;

  if (!spotlight) {
    return (
      <div className="pa-marketplace-map relative flex min-h-[480px] items-center justify-center rounded-[28px] border border-border/75 p-6">
        <div className="rounded-2xl border border-border/80 bg-background/90 px-4 py-3 text-center text-muted-foreground text-sm">
          {isEn
            ? "No published listings to render on map."
            : "No hay anuncios publicados para mostrar en el mapa."}
        </div>
      </div>
    );
  }

  const spotlightSlug = asText(spotlight.public_slug);
  const spotlightTitle =
    asText(spotlight.title) || (isEn ? "Listing" : "Anuncio");
  const spotlightCity = asText(spotlight.city) || "Asuncion";
  const spotlightNeighborhood = asText(spotlight.neighborhood);
  const spotlightCurrency = asText(spotlight.currency) || "PYG";
  const spotlightMoveIn = formatCurrency(
    asNumber(spotlight.total_move_in),
    spotlightCurrency,
    locale
  );
  const spotlightMonthly = formatCurrency(
    asNumber(spotlight.monthly_recurring_total),
    spotlightCurrency,
    locale
  );
  const spotlightSpecs = specsLabel(spotlight, locale);

  return (
    <section className="pa-marketplace-map relative min-h-[560px] min-w-0 overflow-hidden rounded-[28px] border border-border/75 p-4 sm:p-6">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <Badge
          className="rounded-full bg-background/90 px-3 py-1 text-[11px] uppercase tracking-wide"
          variant="secondary"
        >
          <Icon icon={MapsLocation01Icon} size={13} />
          {isEn ? "Map view" : "Vista mapa"}
        </Badge>
      </div>

      {mapListings.map((listing, index) => {
        const slug = asText(listing.public_slug);
        const title = asText(listing.title) || (isEn ? "Listing" : "Anuncio");
        const currency = asText(listing.currency) || "PYG";
        const amount = compactCurrency(
          asNumber(listing.total_move_in),
          currency,
          locale
        );
        const pos = PIN_POSITIONS[index % PIN_POSITIONS.length];

        return (
          <Link
            className="glass-float absolute z-10 inline-flex max-w-[9.5rem] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-3 py-1.5 font-semibold text-sm transition-all duration-150 ease-out hover:-translate-y-[52%]"
            href={`/marketplace/${encodeURIComponent(slug)}`}
            key={slug || `${title}-${index}`}
            style={{ left: pos.left, top: pos.top }}
          >
            <Icon className="text-primary" icon={Tag01Icon} size={14} />
            <span className="truncate">{amount}</span>
          </Link>
        );
      })}

      <div className="absolute inset-x-4 bottom-4 z-20 min-w-0 rounded-[24px] border border-border/75 bg-background/94 p-4 shadow-[0_20px_40px_rgba(15,23,42,0.12)] backdrop-blur-sm sm:inset-x-6 sm:bottom-6 sm:p-5">
        <p className="line-clamp-1 text-muted-foreground text-sm">
          {spotlightNeighborhood
            ? `${spotlightNeighborhood}, ${spotlightCity}`
            : spotlightCity}
        </p>
        <h3 className="line-clamp-1 font-semibold text-xl tracking-tight sm:text-2xl">
          {spotlightTitle}
        </h3>

        <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
          {spotlightSpecs ||
            (isEn
              ? "Transparent move-in and recurring pricing."
              : "Precios transparentes de ingreso y mensual.")}
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Total move-in" : "Costo total de ingreso"}
            </p>
            <p className="truncate font-semibold text-2xl tracking-tight">
              {spotlightMoveIn}
            </p>
            <p className="truncate text-muted-foreground text-xs">
              {isEn ? "Monthly" : "Mensual"}: {spotlightMonthly}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Link
              className="inline-flex h-10 items-center rounded-2xl border border-border/80 bg-background px-4 font-medium text-sm transition-colors hover:bg-accent"
              href={`/marketplace/${encodeURIComponent(spotlightSlug)}`}
            >
              {isEn ? "View" : "Ver"}
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-1 rounded-2xl bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
              href={`/marketplace/apply/${encodeURIComponent(spotlightSlug)}`}
            >
              {isEn ? "Apply" : "Aplicar"}
              <Icon icon={ArrowRight01Icon} size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
