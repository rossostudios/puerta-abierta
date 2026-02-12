"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { postJson } from "@/lib/api";

function toStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNumberValue(
  value: FormDataEntryValue | null,
  fallback: number
): number {
  const raw = toStringValue(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function unitsUrl(params?: { success?: string; error?: string }): string {
  const qs = new URLSearchParams();
  if (params?.success) qs.set("success", params.success);
  if (params?.error) qs.set("error", params.error);
  const suffix = qs.toString();
  return suffix ? `/module/units?${suffix}` : "/module/units";
}

export async function createUnitFromUnitsModuleAction(formData: FormData) {
  const organization_id = toStringValue(formData.get("organization_id"));
  const property_id = toStringValue(formData.get("property_id"));
  const code = toStringValue(formData.get("code"));
  const name = toStringValue(formData.get("name"));
  const max_guests = toNumberValue(formData.get("max_guests"), 2);
  const bedrooms = toNumberValue(formData.get("bedrooms"), 1);
  const bathrooms = toNumberValue(formData.get("bathrooms"), 1);
  const currency = toStringValue(formData.get("currency")) || "PYG";

  if (!organization_id) {
    redirect(unitsUrl({ error: "Missing organization context." }));
  }
  if (!property_id) {
    redirect(unitsUrl({ error: "property_id is required" }));
  }
  if (!code) {
    redirect(unitsUrl({ error: "code is required" }));
  }
  if (!name) {
    redirect(unitsUrl({ error: "name is required" }));
  }

  try {
    await postJson("/units", {
      organization_id,
      property_id,
      code,
      name,
      max_guests,
      bedrooms,
      bathrooms,
      currency,
    });
    revalidatePath("/module/units");
    revalidatePath("/setup");
    redirect(unitsUrl({ success: "unit-created" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(unitsUrl({ error: message.slice(0, 240) }));
  }
}
