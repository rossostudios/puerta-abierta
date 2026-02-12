"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { postJson } from "@/lib/api";

function toStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
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
  const code = toStringValue(formData.get("code")) || undefined;
  const address_line1 =
    toStringValue(formData.get("address_line1")) || undefined;
  const city = toStringValue(formData.get("city")) || undefined;

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
      address_line1,
      city,
    });
    revalidatePath("/module/properties");
    revalidatePath("/setup");
    redirect(propertiesUrl({ success: "property-created" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(propertiesUrl({ error: message.slice(0, 240) }));
  }
}
