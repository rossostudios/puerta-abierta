"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { patchJson, postJson } from "@/lib/api";

function toStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
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
  return withParams("/module/listings", params ?? {});
}

export async function publishListingAction(formData: FormData) {
  const listing_id = toStringValue(formData.get("listing_id"));
  if (!listing_id) {
    redirect(listingsUrl({ error: "listing_id is required" }));
  }

  const next = normalizeNext(
    toStringValue(formData.get("next")),
    listingsUrl()
  );

  try {
    await postJson(`/listings/${encodeURIComponent(listing_id)}/publish`, {});
    revalidatePath("/module/listings");
    revalidatePath("/marketplace");
    redirect(withParams(next, { success: "listing-published" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}

const NUMERIC_FIELDS = new Set(["bedrooms", "bathrooms", "square_meters"]);

export async function updateListingInlineAction({
  listingId,
  field,
  value,
}: {
  listingId: string;
  field: string;
  value: string | number;
}): Promise<{ ok: boolean; error?: string }> {
  const apiValue = NUMERIC_FIELDS.has(field) ? Number(value) || 0 : value;
  try {
    await patchJson(`/listings/${encodeURIComponent(listingId)}`, {
      [field]: apiValue,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.slice(0, 240) };
  }
  revalidatePath("/module/listings");
  revalidatePath("/marketplace");
  return { ok: true };
}

export async function unpublishListingAction(formData: FormData) {
  const listing_id = toStringValue(formData.get("listing_id"));
  if (!listing_id) {
    redirect(listingsUrl({ error: "listing_id is required" }));
  }

  const next = normalizeNext(
    toStringValue(formData.get("next")),
    listingsUrl()
  );

  try {
    await patchJson(`/listings/${encodeURIComponent(listing_id)}`, {
      is_published: false,
    });
    revalidatePath("/module/listings");
    revalidatePath("/marketplace");
    redirect(withParams(next, { success: "listing-unpublished" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}
