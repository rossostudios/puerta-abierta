"use client";

import { authedFetch } from "@/lib/api-client";

export type ActionResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const RENTAL_MODES = new Set(["str", "ltr", "both"]);
const ORGANIZATION_PROFILE_TYPES = new Set([
  "owner_operator",
  "management_company",
]);
const UNITS_API_ERROR_RE =
  /API request failed \((\d+)\) for \/units(?::\s*(.+))?/i;
const UNIT_DUPLICATE_SUGGESTION_RE = /(?:try|intenta)\s*['"`]?([^'"`]+)['"`]?/i;

function normalizeRentalMode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return RENTAL_MODES.has(normalized) ? normalized : "both";
}

function normalizeOrganizationProfileType(value: string): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (ORGANIZATION_PROFILE_TYPES.has(normalized)) return normalized;
  return null;
}

function friendlySetupUnitCreateError(message: string): string {
  const normalized = message.toLowerCase();
  const apiMatch = message.match(UNITS_API_ERROR_RE);
  const detail =
    (typeof apiMatch?.[2] === "string" ? apiMatch[2].trim() : "") || message;
  const suggestionMatch = detail.match(UNIT_DUPLICATE_SUGGESTION_RE);
  const suggestion = suggestionMatch?.[1]?.trim() ?? "";

  const isDuplicateCode =
    normalized.includes("already exists for this property") ||
    normalized.includes("duplicate key value violates unique constraint") ||
    normalized.includes("violates unique constraint") ||
    normalized.includes("units_property_id_code_key") ||
    normalized.includes("23505");

  if (isDuplicateCode) {
    if (suggestion) {
      return `El código de la unidad ya existe en esta propiedad. Prueba "${suggestion}".`;
    }
    return "El código de la unidad ya existe en esta propiedad.";
  }

  return "No se pudo crear la unidad. Revisa los datos e inténtalo de nuevo.";
}

async function postWizard<T>(
  path: string,
  payload: Record<string, unknown>
): Promise<T> {
  return authedFetch<T>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { suppressErrorEvent: true }
  );
}

export async function wizardCreateOrganization(payload: {
  name: string;
  legal_name?: string;
  ruc?: string;
  profile_type: string;
  default_currency: string;
  timezone: string;
  rental_mode?: string;
}): Promise<ActionResult<{ id: string; name: string }>> {
  const name = payload.name.trim();
  if (!name) {
    return { ok: false, error: "El nombre de la organización es obligatorio." };
  }

  const profile_type = normalizeOrganizationProfileType(
    payload.profile_type || "management_company"
  );
  if (!profile_type) {
    return { ok: false, error: "Selecciona un tipo de organización válido." };
  }

  const rental_mode = normalizeRentalMode(payload.rental_mode || "both");

  try {
    const created = (await postWizard("/organizations", {
      name,
      legal_name: payload.legal_name?.trim() || undefined,
      ruc: payload.ruc?.trim() || undefined,
      profile_type,
      default_currency: payload.default_currency || "PYG",
      timezone: payload.timezone || "America/Asuncion",
      rental_mode,
    })) as { id?: string; name?: string } | null;

    return {
      ok: true,
      data: { id: created?.id ?? "", name: created?.name ?? name },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function wizardCreateProperty(payload: {
  organization_id: string;
  name: string;
  code?: string;
  address_line1?: string;
  city?: string;
}): Promise<ActionResult<{ id: string; name: string }>> {
  if (!payload.organization_id) {
    return { ok: false, error: "Falta contexto de organización." };
  }
  const name = payload.name.trim();
  if (!name) {
    return { ok: false, error: "El nombre de la propiedad es obligatorio." };
  }

  try {
    const created = (await postWizard("/properties", {
      organization_id: payload.organization_id,
      name,
      code: payload.code?.trim() || undefined,
      address_line1: payload.address_line1?.trim() || undefined,
      city: payload.city?.trim() || undefined,
    })) as { id?: string; name?: string } | null;

    return {
      ok: true,
      data: { id: created?.id ?? "", name: created?.name ?? name },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function wizardCreateUnit(payload: {
  organization_id: string;
  property_id: string;
  code: string;
  name: string;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
}): Promise<ActionResult<{ id: string }>> {
  if (!payload.organization_id) {
    return { ok: false, error: "Falta contexto de organización." };
  }
  if (!payload.property_id) {
    return {
      ok: false,
      error: "El ID de la propiedad es obligatorio para una unidad.",
    };
  }
  const code = payload.code.trim();
  if (!code) {
    return {
      ok: false,
      error: "El código de la unidad es obligatorio (p. ej., A1).",
    };
  }
  const name = payload.name.trim();
  if (!name) {
    return { ok: false, error: "El nombre de la unidad es obligatorio." };
  }

  try {
    const created = (await postWizard("/units", {
      organization_id: payload.organization_id,
      property_id: payload.property_id,
      code,
      name,
      max_guests: payload.max_guests,
      bedrooms: payload.bedrooms,
      bathrooms: payload.bathrooms,
    })) as { id?: string } | null;

    return { ok: true, data: { id: created?.id ?? "" } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: friendlySetupUnitCreateError(message) };
  }
}

export async function wizardCreateIntegration(payload: {
  organization_id: string;
  unit_id: string;
  kind: string;
  channel_name: string;
  public_name: string;
  ical_import_url?: string;
}): Promise<ActionResult<{ id: string; name: string }>> {
  if (!payload.organization_id) {
    return { ok: false, error: "Falta contexto de organización." };
  }
  if (!payload.unit_id) {
    return { ok: false, error: "El ID de la unidad es obligatorio." };
  }
  const kind = payload.kind.trim();
  if (!kind) return { ok: false, error: "El tipo de canal es obligatorio." };
  const channel_name = payload.channel_name.trim();
  if (!channel_name) {
    return { ok: false, error: "El nombre del canal es obligatorio." };
  }
  const public_name = payload.public_name.trim();
  if (!public_name) {
    return { ok: false, error: "El nombre público es obligatorio." };
  }

  try {
    const created = (await postWizard("/integrations", {
      organization_id: payload.organization_id,
      unit_id: payload.unit_id,
      kind,
      channel_name,
      public_name,
      ical_import_url: payload.ical_import_url?.trim() || undefined,
    })) as { id?: string; name?: string } | null;

    return {
      ok: true,
      data: { id: created?.id ?? "", name: created?.name ?? public_name },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function wizardCreateLease(payload: {
  organization_id: string;
  unit_id: string;
  tenant_full_name: string;
  tenant_email?: string;
  tenant_phone_e164?: string;
  lease_status?: string;
  starts_on: string;
  ends_on?: string;
  currency?: string;
  monthly_rent: number;
  generate_first_collection?: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (!payload.organization_id) {
    return { ok: false, error: "Falta contexto de organización." };
  }
  if (!payload.unit_id) return { ok: false, error: "Selecciona una unidad." };
  const tenantName = payload.tenant_full_name.trim();
  if (!tenantName) {
    return { ok: false, error: "El nombre del inquilino es obligatorio." };
  }
  if (!payload.starts_on) {
    return { ok: false, error: "La fecha de inicio es obligatoria." };
  }

  try {
    const created = (await postWizard("/leases", {
      organization_id: payload.organization_id,
      unit_id: payload.unit_id,
      tenant_full_name: tenantName,
      tenant_email: payload.tenant_email?.trim() || undefined,
      tenant_phone_e164: payload.tenant_phone_e164?.trim() || undefined,
      lease_status: payload.lease_status || "active",
      starts_on: payload.starts_on,
      ends_on: payload.ends_on || undefined,
      currency: payload.currency || "PYG",
      monthly_rent: payload.monthly_rent,
      generate_first_collection: payload.generate_first_collection !== false,
    })) as { id?: string } | null;

    return { ok: true, data: { id: created?.id ?? "" } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function wizardSeedDemoData(payload: {
  organization_id: string;
}): Promise<ActionResult> {
  if (!payload.organization_id) {
    return { ok: false, error: "Falta contexto de organización." };
  }

  try {
    await postWizard("/demo/seed", {
      organization_id: payload.organization_id,
    });
    return { ok: true, data: {} };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
