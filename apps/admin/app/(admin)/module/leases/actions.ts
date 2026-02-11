"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { patchJson, postJson } from "@/lib/api";

function toStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalNumber(
  value: FormDataEntryValue | null
): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalBoolean(
  value: FormDataEntryValue | null
): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
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

function leasesUrl(params?: { success?: string; error?: string }): string {
  return withParams("/module/leases", params ?? {});
}

export async function createLeaseAction(formData: FormData) {
  const organization_id = toStringValue(formData.get("organization_id"));
  if (!organization_id) {
    redirect(leasesUrl({ error: "Missing organization context." }));
  }

  const next = normalizeNext(toStringValue(formData.get("next")), leasesUrl());

  const tenant_full_name = toStringValue(formData.get("tenant_full_name"));
  const starts_on = toStringValue(formData.get("starts_on"));
  const lease_status = toStringValue(formData.get("lease_status")) || "active";

  if (!tenant_full_name) {
    redirect(withParams(next, { error: "tenant_full_name is required" }));
  }
  if (!starts_on) {
    redirect(withParams(next, { error: "starts_on is required" }));
  }

  const payload: Record<string, unknown> = {
    organization_id,
    tenant_full_name,
    starts_on,
    lease_status,
    currency: (toStringValue(formData.get("currency")) || "PYG").toUpperCase(),
    monthly_rent: toOptionalNumber(formData.get("monthly_rent")) ?? 0,
    service_fee_flat: toOptionalNumber(formData.get("service_fee_flat")) ?? 0,
    security_deposit: toOptionalNumber(formData.get("security_deposit")) ?? 0,
    guarantee_option_fee:
      toOptionalNumber(formData.get("guarantee_option_fee")) ?? 0,
    tax_iva: toOptionalNumber(formData.get("tax_iva")) ?? 0,
    platform_fee: toOptionalNumber(formData.get("platform_fee")) ?? 0,
    generate_first_collection:
      toOptionalBoolean(formData.get("generate_first_collection")) ?? true,
  };

  const tenant_email = toStringValue(formData.get("tenant_email"));
  const tenant_phone_e164 = toStringValue(formData.get("tenant_phone_e164"));
  const property_id = toStringValue(formData.get("property_id"));
  const unit_id = toStringValue(formData.get("unit_id"));
  const ends_on = toStringValue(formData.get("ends_on"));
  const first_collection_due_date = toStringValue(
    formData.get("first_collection_due_date")
  );
  const notes = toStringValue(formData.get("notes"));

  if (tenant_email) payload.tenant_email = tenant_email;
  if (tenant_phone_e164) payload.tenant_phone_e164 = tenant_phone_e164;
  if (property_id) payload.property_id = property_id;
  if (unit_id) payload.unit_id = unit_id;
  if (ends_on) payload.ends_on = ends_on;
  if (first_collection_due_date) {
    payload.first_collection_due_date = first_collection_due_date;
  }
  if (notes) payload.notes = notes;

  try {
    await postJson("/leases", payload);
    revalidatePath("/module/leases");
    revalidatePath("/module/collections");
    revalidatePath("/");
    redirect(withParams(next, { success: "lease-created" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}

export async function setLeaseStatusAction(formData: FormData) {
  const lease_id = toStringValue(formData.get("lease_id"));
  const lease_status = toStringValue(formData.get("lease_status"));

  if (!lease_id) {
    redirect(leasesUrl({ error: "lease_id is required" }));
  }
  if (!lease_status) {
    redirect(leasesUrl({ error: "lease_status is required" }));
  }

  const next = normalizeNext(toStringValue(formData.get("next")), leasesUrl());

  try {
    await patchJson(`/leases/${encodeURIComponent(lease_id)}`, {
      lease_status,
    });
    revalidatePath("/module/leases");
    revalidatePath("/module/collections");
    revalidatePath("/");
    redirect(withParams(next, { success: "lease-status-updated" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}
