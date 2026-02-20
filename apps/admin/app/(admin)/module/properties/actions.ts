"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { patchJson, postJson } from "@/lib/api";

const LIST_DELIMITER_REGEX = /[\n,]/;

function toStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalStringValue(
  formData: FormData,
  key: string
): string | undefined {
  const value = toStringValue(formData.get(key));
  return value || undefined;
}

function toOptionalNumberValue(
  formData: FormData,
  key: string
): number | undefined {
  const value = toOptionalStringValue(formData, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalListValue(
  formData: FormData,
  key: string
): string[] | undefined {
  const value = toOptionalStringValue(formData, key);
  if (!value) return undefined;
  const parsed = value
    .split(LIST_DELIMITER_REGEX)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parsed.length === 0) return undefined;
  return Array.from(new Set(parsed));
}

function propertiesUrl(params?: { success?: string; error?: string }): string {
  const qs = new URLSearchParams();
  if (params?.success) qs.set("success", params.success);
  if (params?.error) qs.set("error", params.error);
  const suffix = qs.toString();
  return suffix ? `/module/properties?${suffix}` : "/module/properties";
}

export async function createPropertyFromPropertiesModuleAction(
  formData: FormData
) {
  const organization_id = toStringValue(formData.get("organization_id"));
  const name = toStringValue(formData.get("name"));
  const code = toOptionalStringValue(formData, "code");
  const status = toOptionalStringValue(formData, "status")?.toLowerCase();
  const property_type = toOptionalStringValue(
    formData,
    "property_type"
  )?.toLowerCase();
  const address_line1 = toOptionalStringValue(formData, "address_line1");
  const address_line2 = toOptionalStringValue(formData, "address_line2");
  const neighborhood = toOptionalStringValue(formData, "neighborhood");
  const city = toOptionalStringValue(formData, "city");
  const region = toOptionalStringValue(formData, "region");
  const postal_code = toOptionalStringValue(formData, "postal_code");
  const countryCode = toOptionalStringValue(formData, "country_code");
  const country_code = countryCode ? countryCode.toUpperCase() : undefined;
  const latitude = toOptionalNumberValue(formData, "latitude");
  const longitude = toOptionalNumberValue(formData, "longitude");
  const building_amenities = toOptionalListValue(
    formData,
    "building_amenities"
  );
  const access_instructions = toOptionalStringValue(
    formData,
    "access_instructions"
  );
  const shared_wifi_name = toOptionalStringValue(formData, "shared_wifi_name");
  const shared_wifi_password = toOptionalStringValue(
    formData,
    "shared_wifi_password"
  );
  const asset_owner_name = toOptionalStringValue(formData, "asset_owner_name");
  const asset_owner_organization_id = toOptionalStringValue(
    formData,
    "asset_owner_organization_id"
  );

  if (!organization_id) {
    redirect(propertiesUrl({ error: "Missing organization context." }));
  }
  if (!name) {
    redirect(propertiesUrl({ error: "name is required" }));
  }

  try {
    await postJson("/properties", {
      organization_id,
      name,
      code,
      status,
      property_type,
      address_line1,
      address_line2,
      neighborhood,
      city,
      region,
      postal_code,
      country_code,
      latitude,
      longitude,
      building_amenities,
      access_instructions,
      shared_wifi_name,
      shared_wifi_password,
      asset_owner_name,
      asset_owner_organization_id,
    });
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(propertiesUrl({ error: message.slice(0, 240) }));
  }

  revalidatePath("/module/properties");
  revalidatePath("/setup");
  redirect(propertiesUrl({ success: "property-created" }));
}

const FIELD_TO_API_KEY: Record<string, string> = {
  address: "address_line1",
};

export async function updatePropertyInlineAction({
  propertyId,
  field,
  value,
}: {
  propertyId: string;
  field: string;
  value: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiField = FIELD_TO_API_KEY[field] ?? field;
  try {
    await patchJson(`/properties/${propertyId}`, { [apiField]: value });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.slice(0, 240) };
  }
  revalidatePath("/module/properties");
  return { ok: true };
}
