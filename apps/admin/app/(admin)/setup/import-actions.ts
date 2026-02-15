"use server";

import { revalidatePath } from "next/cache";
import { postJson } from "@/lib/api";

export type ImportRowResult = {
  index: number;
  ok: boolean;
  error?: string;
};

export type ImportResult = {
  total: number;
  succeeded: number;
  failed: number;
  rows: ImportRowResult[];
};

export async function batchCreateProperties(
  orgId: string,
  rows: Array<{
    name: string;
    code?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
  }>
): Promise<ImportResult> {
  const results: ImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.name?.trim();
    if (!name) {
      results.push({ index: i, ok: false, error: "Name is required" });
      continue;
    }
    try {
      await postJson("/properties", {
        organization_id: orgId,
        name,
        code: row.code?.trim() || undefined,
        address_line1: row.address_line1?.trim() || undefined,
        address_line2: row.address_line2?.trim() || undefined,
        city: row.city?.trim() || undefined,
        region: row.region?.trim() || undefined,
        postal_code: row.postal_code?.trim() || undefined,
        country_code: row.country_code?.trim() || undefined,
        latitude: row.latitude ?? undefined,
        longitude: row.longitude ?? undefined,
      });
      results.push({ index: i, ok: true });
    } catch (err) {
      results.push({
        index: i,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath("/setup");
  revalidatePath("/module/properties");

  const succeeded = results.filter((r) => r.ok).length;
  return {
    total: rows.length,
    succeeded,
    failed: rows.length - succeeded,
    rows: results,
  };
}

export async function batchCreateLeases(
  orgId: string,
  rows: Array<{
    unit_id: string;
    tenant_full_name: string;
    tenant_email?: string;
    tenant_phone_e164?: string;
    starts_on: string;
    ends_on?: string;
    monthly_rent: number;
    currency?: string;
    security_deposit?: number;
    service_fee_flat?: number;
    notes?: string;
  }>
): Promise<ImportResult> {
  const results: ImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.tenant_full_name?.trim();
    if (!name) {
      results.push({ index: i, ok: false, error: "Tenant name is required" });
      continue;
    }
    if (!row.unit_id) {
      results.push({ index: i, ok: false, error: "Unit could not be resolved" });
      continue;
    }
    if (!row.starts_on) {
      results.push({ index: i, ok: false, error: "Start date is required" });
      continue;
    }
    try {
      await postJson("/leases", {
        organization_id: orgId,
        unit_id: row.unit_id,
        tenant_full_name: name,
        tenant_email: row.tenant_email?.trim() || undefined,
        tenant_phone_e164: row.tenant_phone_e164?.trim() || undefined,
        lease_status: "active",
        starts_on: row.starts_on,
        ends_on: row.ends_on?.trim() || undefined,
        monthly_rent: row.monthly_rent ?? 0,
        currency: row.currency?.trim() || "PYG",
        security_deposit: row.security_deposit ?? 0,
        service_fee_flat: row.service_fee_flat ?? 0,
        notes: row.notes?.trim() || undefined,
        generate_first_collection: true,
      });
      results.push({ index: i, ok: true });
    } catch (err) {
      results.push({
        index: i,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath("/setup");
  revalidatePath("/module/leases");
  revalidatePath("/module/collections");

  const succeeded = results.filter((r) => r.ok).length;
  return {
    total: rows.length,
    succeeded,
    failed: rows.length - succeeded,
    rows: results,
  };
}

export async function batchCreateUnits(
  orgId: string,
  rows: Array<{
    property_id: string;
    code: string;
    name: string;
    max_guests?: number;
    bedrooms?: number;
    bathrooms?: number;
    square_meters?: number;
    default_nightly_rate?: number;
    default_cleaning_fee?: number;
    currency?: string;
    check_in_time?: string;
    check_out_time?: string;
    is_active?: boolean;
  }>
): Promise<ImportResult> {
  const results: ImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const code = row.code?.trim();
    const name = row.name?.trim();
    if (!code || !name) {
      results.push({ index: i, ok: false, error: "Code and name are required" });
      continue;
    }
    if (!row.property_id) {
      results.push({ index: i, ok: false, error: "Property ID is required" });
      continue;
    }
    try {
      await postJson("/units", {
        organization_id: orgId,
        property_id: row.property_id,
        code,
        name,
        max_guests: row.max_guests ?? 2,
        bedrooms: row.bedrooms ?? 1,
        bathrooms: row.bathrooms ?? 1,
        square_meters: row.square_meters ?? undefined,
        default_nightly_rate: row.default_nightly_rate ?? undefined,
        default_cleaning_fee: row.default_cleaning_fee ?? undefined,
        currency: row.currency?.trim() || undefined,
        check_in_time: row.check_in_time?.trim() || undefined,
        check_out_time: row.check_out_time?.trim() || undefined,
        is_active: row.is_active ?? undefined,
      });
      results.push({ index: i, ok: true });
    } catch (err) {
      results.push({
        index: i,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath("/setup");
  revalidatePath("/module/units");

  const succeeded = results.filter((r) => r.ok).length;
  return {
    total: rows.length,
    succeeded,
    failed: rows.length - succeeded,
    rows: results,
  };
}
