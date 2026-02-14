"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { patchJson, postJson } from "@/lib/api";

const UNITS_API_ERROR_RE =
  /API request failed \((\d+)\) for \/units(?::\s*(.+))?/i;
const UNITS_DUPLICATE_SUGGESTION_RE =
  /(?:try|intenta)\s*['"`]?([^'"`]+)['"`]?/i;

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

function friendlyUnitCreateError(message: string): string {
  const normalized = message.toLowerCase();
  const apiMatch = message.match(UNITS_API_ERROR_RE);
  const detail =
    (typeof apiMatch?.[2] === "string" ? apiMatch[2].trim() : "") || message;
  const suggestionMatch = detail.match(UNITS_DUPLICATE_SUGGESTION_RE);
  const suggestion = suggestionMatch?.[1]?.trim() ?? "";

  const looksLikeDuplicate =
    normalized.includes("already exists for this property") ||
    normalized.includes("duplicate key value violates unique constraint") ||
    normalized.includes("violates unique constraint") ||
    normalized.includes("units_property_id_code_key") ||
    normalized.includes("23505");

  if (looksLikeDuplicate) {
    return suggestion
      ? `unit-code-duplicate:${suggestion}`
      : "unit-code-duplicate";
  }

  return "unit-create-failed";
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
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(
      unitsUrl({ error: friendlyUnitCreateError(message).slice(0, 240) })
    );
  }
}

export async function updateUnitInlineAction({
  unitId,
  field,
  value,
}: {
  unitId: string;
  field: string;
  value: string | number | boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await patchJson(`/units/${unitId}`, { [field]: value });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.slice(0, 240) };
  }
  revalidatePath("/module/units");
  return { ok: true };
}
