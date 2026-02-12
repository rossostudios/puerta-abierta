"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { patchJson, postJson } from "@/lib/api";

const NEWLINE_SPLIT_REGEX = /\r?\n/;
const AMENITIES_SPLIT_REGEX = /[\n,]/;

function toStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalNumber(value: FormDataEntryValue | null): number | null {
  const normalized = toStringValue(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseGalleryImageUrls(value: FormDataEntryValue | null): string[] {
  const text = toStringValue(value);
  if (!text) return [];
  return text
    .split(NEWLINE_SPLIT_REGEX)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAmenities(value: FormDataEntryValue | null): string[] {
  const text = toStringValue(value);
  if (!text) return [];
  return text
    .split(AMENITIES_SPLIT_REGEX)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toOptionalBoolean(value: FormDataEntryValue | null): boolean | null {
  const normalized = toStringValue(value).toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function normalizeNext(path: string, fallback: string): string {
  const next = path.trim();
  if (!next.startsWith("/")) return fallback;
  return next;
}

function withParams(
  path: string,
  params: { success?: string; error?: string }
): string {
  const [base, query] = path.split("?", 2);
  const qs = new URLSearchParams(query ?? "");

  if (params.success) {
    qs.set("success", params.success);
    qs.delete("error");
  }
  if (params.error) {
    qs.set("error", params.error);
    qs.delete("success");
  }

  const suffix = qs.toString();
  return suffix ? `${base}?${suffix}` : base;
}

function listingsUrl(params?: { success?: string; error?: string }): string {
  return withParams("/module/marketplace-listings", params ?? {});
}

export async function createMarketplaceListingAction(formData: FormData) {
  const organization_id = toStringValue(formData.get("organization_id"));
  if (!organization_id) {
    redirect(listingsUrl({ error: "Missing organization context." }));
  }

  const next = normalizeNext(
    toStringValue(formData.get("next")),
    listingsUrl()
  );

  const title = toStringValue(formData.get("title"));
  const public_slug = toStringValue(formData.get("public_slug"));

  if (!title) {
    redirect(withParams(next, { error: "title is required" }));
  }
  if (!public_slug) {
    redirect(withParams(next, { error: "public_slug is required" }));
  }

  const payload: Record<string, unknown> = {
    organization_id,
    title,
    public_slug,
    city: toStringValue(formData.get("city")) || "Asuncion",
    country_code: toStringValue(formData.get("country_code")) || "PY",
    currency: (toStringValue(formData.get("currency")) || "PYG").toUpperCase(),
  };

  const summary = toStringValue(formData.get("summary"));
  const description = toStringValue(formData.get("description"));
  const neighborhood = toStringValue(formData.get("neighborhood"));
  const cover_image_url = toStringValue(formData.get("cover_image_url"));
  const gallery_image_urls = parseGalleryImageUrls(
    formData.get("gallery_image_urls")
  );
  const bedrooms = toOptionalNumber(formData.get("bedrooms"));
  const bathrooms = toOptionalNumber(formData.get("bathrooms"));
  const square_meters = toOptionalNumber(formData.get("square_meters"));
  const property_type = toStringValue(formData.get("property_type"));
  const furnished = toOptionalBoolean(formData.get("furnished"));
  const pet_policy = toStringValue(formData.get("pet_policy"));
  const parking_spaces = toOptionalNumber(formData.get("parking_spaces"));
  const minimum_lease_months = toOptionalNumber(
    formData.get("minimum_lease_months")
  );
  const available_from = toStringValue(formData.get("available_from"));
  const amenities = parseAmenities(formData.get("amenities"));
  const maintenance_fee = toOptionalNumber(formData.get("maintenance_fee"));
  const pricing_template_id = toStringValue(
    formData.get("pricing_template_id")
  );
  const property_id = toStringValue(formData.get("property_id"));
  const unit_id = toStringValue(formData.get("unit_id"));

  if (summary) payload.summary = summary;
  if (description) payload.description = description;
  if (neighborhood) payload.neighborhood = neighborhood;
  if (cover_image_url) payload.cover_image_url = cover_image_url;
  if (gallery_image_urls.length)
    payload.gallery_image_urls = gallery_image_urls;
  if (bedrooms !== null) payload.bedrooms = bedrooms;
  if (bathrooms !== null) payload.bathrooms = bathrooms;
  if (square_meters !== null) payload.square_meters = square_meters;
  if (property_type) payload.property_type = property_type;
  if (furnished !== null) payload.furnished = furnished;
  if (pet_policy) payload.pet_policy = pet_policy;
  if (parking_spaces !== null) payload.parking_spaces = parking_spaces;
  if (minimum_lease_months !== null) {
    payload.minimum_lease_months = minimum_lease_months;
  }
  if (available_from) payload.available_from = available_from;
  if (amenities.length) payload.amenities = amenities;
  if (maintenance_fee !== null) payload.maintenance_fee = maintenance_fee;
  if (pricing_template_id) payload.pricing_template_id = pricing_template_id;
  if (property_id) payload.property_id = property_id;
  if (unit_id) payload.unit_id = unit_id;

  try {
    await postJson("/marketplace/listings", payload);
    revalidatePath("/module/marketplace-listings");
    revalidatePath("/marketplace");
    redirect(withParams(next, { success: "marketplace-listing-created" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}

export async function publishMarketplaceListingAction(formData: FormData) {
  const marketplace_listing_id = toStringValue(
    formData.get("marketplace_listing_id")
  );
  if (!marketplace_listing_id) {
    redirect(listingsUrl({ error: "marketplace_listing_id is required" }));
  }

  const next = normalizeNext(
    toStringValue(formData.get("next")),
    listingsUrl()
  );

  try {
    await postJson(
      `/marketplace/listings/${encodeURIComponent(marketplace_listing_id)}/publish`,
      {}
    );
    revalidatePath("/module/marketplace-listings");
    revalidatePath("/marketplace");
    redirect(withParams(next, { success: "marketplace-listing-published" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}

export async function unpublishMarketplaceListingAction(formData: FormData) {
  const marketplace_listing_id = toStringValue(
    formData.get("marketplace_listing_id")
  );
  if (!marketplace_listing_id) {
    redirect(listingsUrl({ error: "marketplace_listing_id is required" }));
  }

  const next = normalizeNext(
    toStringValue(formData.get("next")),
    listingsUrl()
  );

  try {
    await patchJson(
      `/marketplace/listings/${encodeURIComponent(marketplace_listing_id)}`,
      { is_published: false }
    );
    revalidatePath("/module/marketplace-listings");
    revalidatePath("/marketplace");
    redirect(withParams(next, { success: "marketplace-listing-unpublished" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}
