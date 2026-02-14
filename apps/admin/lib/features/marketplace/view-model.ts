import {
  asNumber,
  asOptionalNumber,
  asText,
  type MarketplaceListingRecord,
} from "@/components/marketplace/marketplace-types";
import { formatCurrency, humanizeKey } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { cityToCoordinates, jitter } from "./geo";

export type MarketplaceFeeLineViewModel = {
  key: string;
  label: string;
  feeType: string;
  feeTypeLabel: string;
  amount: number;
  amountLabel: string;
};

export type MarketplaceListingViewModel = {
  raw: MarketplaceListingRecord;
  id: string;
  slug: string;
  organizationId: string;
  title: string;
  summary: string;
  description: string;
  city: string;
  neighborhood: string;
  currency: string;
  coverImageUrl: string;
  galleryImageUrls: string[];
  totalMoveIn: number;
  totalMoveInLabel: string;
  monthlyRecurring: number;
  monthlyRecurringLabel: string;
  specsShort: string;
  specsLong: string;
  feeLines: MarketplaceFeeLineViewModel[];
  propertyType: string;
  furnished: boolean;
  petPolicy: string;
  parkingSpaces: number | null;
  minimumLeaseMonths: number | null;
  availableFrom: string;
  maintenanceFee: number;
  maintenanceFeeLabel: string;
  amenities: string[];
  whatsappUrl: string;
  latitude: number | null;
  longitude: number | null;
};

function listingId(listing: MarketplaceListingRecord): string {
  return asText(listing.id);
}

export function marketplaceListingKey(
  listing: MarketplaceListingRecord
): string {
  return String(
    listing.id ??
      listing.public_slug ??
      `${String(listing.title ?? "")}-${String(listing.city ?? "")}`
  );
}

export function marketplaceSpecsText(params: {
  listing: MarketplaceListingRecord;
  locale: Locale;
  style?: "short" | "long";
}): string {
  const { listing, locale, style = "short" } = params;
  const isEn = locale === "en-US";

  const bedrooms = asOptionalNumber(listing.bedrooms);
  const bathrooms = asOptionalNumber(listing.bathrooms);
  const squareMeters = asOptionalNumber(listing.square_meters);
  const chunks: string[] = [];

  if (bedrooms !== null) {
    chunks.push(
      style === "short"
        ? `${bedrooms} ${isEn ? "bed" : "hab"}`
        : `${bedrooms} ${isEn ? "bedrooms" : "habitaciones"}`
    );
  }
  if (bathrooms !== null) {
    chunks.push(
      style === "short"
        ? `${bathrooms} ${isEn ? "bath" : "baño"}`
        : `${bathrooms} ${isEn ? "bathrooms" : "baños"}`
    );
  }
  if (squareMeters !== null) {
    chunks.push(style === "short" ? `${squareMeters} m2` : `${squareMeters} m²`);
  }

  return chunks.join(" · ");
}

export function toMarketplaceListingViewModel(params: {
  listing: MarketplaceListingRecord;
  locale: Locale;
  index?: number;
}): MarketplaceListingViewModel {
  const { listing, locale, index = 0 } = params;
  const isEn = locale === "en-US";

  const currency = asText(listing.currency) || "PYG";
  const totalMoveIn = asNumber(listing.total_move_in);
  const monthlyRecurring = asNumber(listing.monthly_recurring_total);
  const maintenanceFee = asNumber(listing.maintenance_fee);

  const rawFeeLines = Array.isArray(listing.fee_lines)
    ? (listing.fee_lines as Record<string, unknown>[])
    : [];

  const feeLines: MarketplaceFeeLineViewModel[] = rawFeeLines.map((line, index) => {
    const feeType = asText(line.fee_type);
    const label = asText(line.label);
    const amount = asNumber(line.amount);
    return {
      key: `${feeType}:${label}:${amount}:${index}`,
      label,
      feeType,
      feeTypeLabel: humanizeKey(feeType),
      amount,
      amountLabel: formatCurrency(amount, currency, locale),
    };
  });

  const amenities = Array.isArray(listing.amenities)
    ? (listing.amenities as unknown[])
        .map((item) => asText(item).trim())
        .filter(Boolean)
    : [];

  const slug = asText(listing.public_slug);
  const title = asText(listing.title) || (isEn ? "Listing" : "Anuncio");

  // Resolve coordinates: raw record > city center fallback with jitter
  const rawLat = asOptionalNumber(listing.latitude);
  const rawLng = asOptionalNumber(listing.longitude);
  let latitude: number | null = rawLat;
  let longitude: number | null = rawLng;

  if (latitude === null || longitude === null) {
    const city = asText(listing.city);
    if (city) {
      const fallback = jitter(cityToCoordinates(city), index);
      latitude = fallback.lat;
      longitude = fallback.lng;
    }
  }

  return {
    raw: listing,
    id: listingId(listing),
    slug,
    organizationId: asText(listing.organization_id),
    title,
    summary: asText(listing.summary),
    description: asText(listing.description),
    city: asText(listing.city) || "Asuncion",
    neighborhood: asText(listing.neighborhood),
    currency,
    coverImageUrl: asText(listing.cover_image_url),
    galleryImageUrls: Array.isArray(listing.gallery_image_urls)
      ? listing.gallery_image_urls.map((url) => asText(url)).filter(Boolean)
      : [],
    totalMoveIn,
    totalMoveInLabel: formatCurrency(totalMoveIn, currency, locale),
    monthlyRecurring,
    monthlyRecurringLabel: formatCurrency(monthlyRecurring, currency, locale),
    specsShort: marketplaceSpecsText({ listing, locale, style: "short" }),
    specsLong: marketplaceSpecsText({ listing, locale, style: "long" }),
    feeLines,
    propertyType: asText(listing.property_type),
    furnished: listing.furnished === true,
    petPolicy: asText(listing.pet_policy),
    parkingSpaces: asOptionalNumber(listing.parking_spaces),
    minimumLeaseMonths: asOptionalNumber(listing.minimum_lease_months),
    availableFrom: asText(listing.available_from),
    maintenanceFee,
    maintenanceFeeLabel: formatCurrency(maintenanceFee, currency, locale),
    amenities,
    whatsappUrl: asText(listing.whatsapp_contact_url),
    latitude,
    longitude,
  };
}
