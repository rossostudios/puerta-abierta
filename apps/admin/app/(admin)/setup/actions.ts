"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { deleteJson, fetchJson, patchJson, postJson } from "@/lib/api";
import { shouldUseSecureCookie } from "@/lib/cookies";
import { ORG_COOKIE_NAME } from "@/lib/org";

/* ================================================================== */
/*  This file contains TWO action families:                            */
/*                                                                     */
/*  1. wizard* actions (wizardCreateOrganization, wizardCreateProperty,*/
/*     etc.) — return ActionResult<T> ({ ok, data } | { ok, error }).  */
/*     Used by the SetupWizard client component for inline RPC where   */
/*     the UI manages its own state and toasts.                        */
/*                                                                     */
/*  2. *Action actions (createOrganizationAction, createPropertyAction,*/
/*     etc.) — use redirect() for control flow. Used by SetupManager   */
/*     as progressive-enhancement form actions with server-side        */
/*     redirect on success/error.                                      */
/*                                                                     */
/*  Both patterns are intentional and correct for their use cases.     */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  Wizard actions — return { ok, data } instead of redirecting        */
/* ------------------------------------------------------------------ */

export type ActionResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
  if (!name)
    return { ok: false, error: "El nombre de la organización es obligatorio." };

  const profile_type = normalizeOrganizationProfileType(
    payload.profile_type || "management_company"
  );
  if (!profile_type)
    return { ok: false, error: "Selecciona un tipo de organización válido." };

  const rental_mode = normalizeRentalMode(payload.rental_mode || "both");

  try {
    const created = (await postJson("/organizations", {
      name,
      legal_name: payload.legal_name?.trim() || undefined,
      ruc: payload.ruc?.trim() || undefined,
      profile_type,
      default_currency: payload.default_currency || "PYG",
      timezone: payload.timezone || "America/Asuncion",
      rental_mode,
    })) as { id?: string; name?: string } | null;

    const newOrgId = created?.id ?? "";
    if (newOrgId) {
      // Verify the org is accessible (proves membership was committed)
      try {
        await fetchJson<{ data?: unknown[] }>("/organizations", {
          org_id: newOrgId,
        });
      } catch {
        return {
          ok: false,
          error:
            "Organization created but access verification failed. Please refresh and try again.",
        };
      }

      const hdrs = await headers();
      const store = await cookies();
      store.set(ORG_COOKIE_NAME, newOrgId, {
        path: "/",
        sameSite: "lax",
        httpOnly: false,
        secure: shouldUseSecureCookie(hdrs),
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    revalidatePath("/", "layout");
    return { ok: true, data: { id: newOrgId, name: created?.name ?? name } };
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
  if (!payload.organization_id)
    return { ok: false, error: "Falta contexto de organización." };
  const name = payload.name.trim();
  if (!name)
    return { ok: false, error: "El nombre de la propiedad es obligatorio." };

  try {
    const created = (await postJson("/properties", {
      organization_id: payload.organization_id,
      name,
      code: payload.code?.trim() || undefined,
      address_line1: payload.address_line1?.trim() || undefined,
      city: payload.city?.trim() || undefined,
    })) as { id?: string; name?: string } | null;

    revalidatePath("/setup");
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
  if (!payload.organization_id)
    return { ok: false, error: "Falta contexto de organización." };
  if (!payload.property_id)
    return {
      ok: false,
      error: "El ID de la propiedad es obligatorio para una unidad.",
    };
  const code = payload.code.trim();
  if (!code)
    return {
      ok: false,
      error: "El código de la unidad es obligatorio (p. ej., A1).",
    };
  const name = payload.name.trim();
  if (!name)
    return { ok: false, error: "El nombre de la unidad es obligatorio." };

  try {
    const created = (await postJson("/units", {
      organization_id: payload.organization_id,
      property_id: payload.property_id,
      code,
      name,
      max_guests: payload.max_guests,
      bedrooms: payload.bedrooms,
      bathrooms: payload.bathrooms,
    })) as { id?: string } | null;

    revalidatePath("/setup");
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
  if (!payload.organization_id)
    return { ok: false, error: "Falta contexto de organización." };
  if (!payload.unit_id)
    return { ok: false, error: "El ID de la unidad es obligatorio." };
  const kind = payload.kind.trim();
  if (!kind)
    return { ok: false, error: "El tipo de integración es obligatorio." };
  const channel_name = payload.channel_name.trim();
  if (!channel_name)
    return { ok: false, error: "El nombre del canal es obligatorio." };
  const public_name = payload.public_name.trim();
  if (!public_name)
    return { ok: false, error: "El nombre público es obligatorio." };

  try {
    const created = (await postJson("/integrations", {
      organization_id: payload.organization_id,
      unit_id: payload.unit_id,
      kind,
      channel_name,
      public_name,
      ical_import_url: payload.ical_import_url?.trim() || undefined,
    })) as { id?: string; name?: string } | null;

    revalidatePath("/setup");
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
  if (!payload.organization_id)
    return { ok: false, error: "Falta contexto de organización." };
  if (!payload.unit_id) return { ok: false, error: "Selecciona una unidad." };
  const name = payload.tenant_full_name.trim();
  if (!name)
    return { ok: false, error: "El nombre del inquilino es obligatorio." };
  if (!payload.starts_on)
    return { ok: false, error: "La fecha de inicio es obligatoria." };

  try {
    const created = (await postJson("/leases", {
      organization_id: payload.organization_id,
      unit_id: payload.unit_id,
      tenant_full_name: name,
      tenant_email: payload.tenant_email?.trim() || undefined,
      tenant_phone_e164: payload.tenant_phone_e164?.trim() || undefined,
      lease_status: payload.lease_status || "active",
      starts_on: payload.starts_on,
      ends_on: payload.ends_on || undefined,
      currency: payload.currency || "PYG",
      monthly_rent: payload.monthly_rent,
      generate_first_collection: payload.generate_first_collection !== false,
    })) as { id?: string } | null;

    revalidatePath("/setup");
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
  if (!payload.organization_id)
    return { ok: false, error: "Falta contexto de organización." };

  try {
    await postJson("/demo/seed", { organization_id: payload.organization_id });
    revalidatePath("/setup");
    return { ok: true, data: {} };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const RENTAL_MODES = new Set(["str", "ltr", "both"]);
const ORGANIZATION_PROFILE_TYPES = new Set([
  "owner_operator",
  "management_company",
]);
const UNITS_API_ERROR_RE =
  /API request failed \((\d+)\) for \/units(?::\s*(.+))?/i;
const UNIT_DUPLICATE_SUGGESTION_RE = /(?:try|intenta)\s*['"`]?([^'"`]+)['"`]?/i;

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

function normalizeRentalMode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return RENTAL_MODES.has(normalized) ? normalized : "both";
}

function normalizeOrganizationProfileType(value: string): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (ORGANIZATION_PROFILE_TYPES.has(normalized)) {
    return normalized;
  }
  return null;
}

function setupUrl(params: {
  tab?: string;
  error?: string;
  success?: string;
  org_id?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.tab) qs.set("tab", params.tab);
  if (params.error) qs.set("error", params.error);
  if (params.success) qs.set("success", params.success);
  if (params.org_id) qs.set("org_id", params.org_id);
  const suffix = qs.toString();
  return suffix ? `/setup?${suffix}` : "/setup";
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

export async function createOrganizationAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const name = toStringValue(formData.get("name"));
  const legal_name = toStringValue(formData.get("legal_name")) || undefined;
  const ruc = toStringValue(formData.get("ruc")) || undefined;
  const default_currency =
    toStringValue(formData.get("default_currency")) || "PYG";
  const timezone =
    toStringValue(formData.get("timezone")) || "America/Asuncion";
  const profile_type = normalizeOrganizationProfileType(
    toStringValue(formData.get("profile_type")) || "management_company"
  );

  if (!name) {
    redirect(
      setupUrl({ tab, error: "El nombre de la organización es obligatorio." })
    );
  }
  if (!profile_type) {
    redirect(
      setupUrl({
        tab,
        error: "Selecciona un tipo de organización válido.",
      })
    );
  }

  try {
    const created = (await postJson("/organizations", {
      name,
      legal_name,
      ruc,
      profile_type,
      default_currency,
      timezone,
    })) as { id?: string } | null;

    const newOrgId = created?.id ?? "";
    if (newOrgId) {
      const hdrs = await headers();
      const store = await cookies();
      store.set(ORG_COOKIE_NAME, newOrgId, {
        path: "/",
        sameSite: "lax",
        httpOnly: false,
        secure: shouldUseSecureCookie(hdrs),
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    revalidatePath("/", "layout");
    redirect(
      setupUrl({ tab, success: "organizacion-creada", org_id: newOrgId })
    );
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function seedDemoDataAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const organization_id = toStringValue(formData.get("organization_id"));
  if (!organization_id) {
    redirect(setupUrl({ tab, error: "Falta contexto de organización." }));
  }

  try {
    await postJson("/demo/seed", { organization_id });
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "datos-demo-cargados" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: friendlySetupUnitCreateError(message) }));
  }
}

export async function createPropertyAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const organization_id = toStringValue(formData.get("organization_id"));
  const name = toStringValue(formData.get("name"));
  const code = toStringValue(formData.get("code")) || undefined;
  const address_line1 =
    toStringValue(formData.get("address_line1")) || undefined;
  const city = toStringValue(formData.get("city")) || undefined;

  if (!organization_id) {
    redirect(setupUrl({ tab, error: "Falta contexto de organización." }));
  }
  if (!name) {
    redirect(
      setupUrl({ tab, error: "El nombre de la propiedad es obligatorio." })
    );
  }

  try {
    await postJson("/properties", {
      organization_id,
      name,
      code,
      address_line1,
      city,
    });
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }

  revalidatePath("/setup");
  redirect(setupUrl({ tab, success: "propiedad-creada" }));
}

export async function createUnitAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const organization_id = toStringValue(formData.get("organization_id"));
  const property_id = toStringValue(formData.get("property_id"));
  const code = toStringValue(formData.get("code"));
  const name = toStringValue(formData.get("name"));
  const max_guests = toNumberValue(formData.get("max_guests"), 2);
  const bedrooms = toNumberValue(formData.get("bedrooms"), 1);
  const bathrooms = toNumberValue(formData.get("bathrooms"), 1);
  const finishOnboarding =
    toStringValue(formData.get("finish_onboarding")) === "true";

  if (!organization_id) {
    redirect(setupUrl({ tab, error: "Falta contexto de organización." }));
  }
  if (!property_id) {
    redirect(
      setupUrl({
        tab,
        error: "El ID de la propiedad es obligatorio para una unidad.",
      })
    );
  }
  if (!code) {
    redirect(
      setupUrl({
        tab,
        error: "El código de la unidad es obligatorio (p. ej., A1).",
      })
    );
  }
  if (!name) {
    redirect(
      setupUrl({ tab, error: "El nombre de la unidad es obligatorio." })
    );
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
    });
    revalidatePath("/setup");
    if (finishOnboarding) {
      redirect("/app?onboarding=completed");
    }
    redirect(setupUrl({ tab, success: "unidad-creada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function createIntegrationAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const organization_id = toStringValue(formData.get("organization_id"));
  const unit_id = toStringValue(formData.get("unit_id"));
  const kind = toStringValue(formData.get("kind"));
  const channel_name = toStringValue(formData.get("channel_name"));
  const public_name = toStringValue(formData.get("public_name"));
  const external_listing_id =
    toStringValue(formData.get("external_listing_id")) || undefined;
  const ical_import_url =
    toStringValue(formData.get("ical_import_url")) || undefined;

  if (!organization_id) {
    redirect(setupUrl({ tab, error: "Falta contexto de organización." }));
  }
  if (!unit_id) {
    redirect(
      setupUrl({
        tab,
        error: "El ID de la unidad es obligatorio para una integración.",
      })
    );
  }
  if (!kind) {
    redirect(
      setupUrl({
        tab,
        error: "El tipo de integración es obligatorio (p. ej., airbnb).",
      })
    );
  }
  if (!public_name) {
    redirect(setupUrl({ tab, error: "El nombre público es obligatorio." }));
  }

  try {
    await postJson("/integrations", {
      organization_id,
      unit_id,
      kind,
      channel_name: channel_name || kind,
      public_name,
      external_listing_id,
      ical_import_url,
    });
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "integracion-creada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function updateOrganizationAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  const name = toStringValue(formData.get("name"));
  const legal_name = toStringValue(formData.get("legal_name"));
  const ruc = toStringValue(formData.get("ruc"));
  const profileTypeRaw = toStringValue(formData.get("profile_type"));
  const profile_type = profileTypeRaw
    ? normalizeOrganizationProfileType(profileTypeRaw)
    : null;
  const default_currency = toStringValue(formData.get("default_currency"));
  const timezone = toStringValue(formData.get("timezone"));

  if (!id)
    redirect(
      setupUrl({ tab, error: "El ID de la organización es obligatorio." })
    );
  if (!name)
    redirect(
      setupUrl({ tab, error: "El nombre de la organización es obligatorio." })
    );
  if (profileTypeRaw && !profile_type) {
    redirect(
      setupUrl({
        tab,
        error: "Selecciona un tipo de organización válido.",
      })
    );
  }

  try {
    await patchJson(`/organizations/${id}`, {
      name,
      legal_name,
      ruc,
      profile_type: profile_type || undefined,
      default_currency,
      timezone,
    });
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "organizacion-actualizada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function deleteOrganizationAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  if (!id)
    redirect(
      setupUrl({ tab, error: "El ID de la organización es obligatorio." })
    );

  try {
    await deleteJson(`/organizations/${id}`);
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "organizacion-eliminada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function updatePropertyAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  const name = toStringValue(formData.get("name"));
  const status = toStringValue(formData.get("status"));
  const address_line1 = toStringValue(formData.get("address_line1"));
  const city = toStringValue(formData.get("city"));

  if (!id)
    redirect(setupUrl({ tab, error: "El ID de la propiedad es obligatorio." }));
  if (!name)
    redirect(
      setupUrl({ tab, error: "El nombre de la propiedad es obligatorio." })
    );
  if (!status)
    redirect(
      setupUrl({ tab, error: "El estado de la propiedad es obligatorio." })
    );

  try {
    await patchJson(`/properties/${id}`, {
      name,
      status,
      address_line1,
      city,
    });
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "propiedad-actualizada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function deletePropertyAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  if (!id)
    redirect(setupUrl({ tab, error: "El ID de la propiedad es obligatorio." }));

  try {
    await deleteJson(`/properties/${id}`);
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "propiedad-eliminada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function updateUnitAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  const name = toStringValue(formData.get("name"));
  const max_guests = toNumberValue(formData.get("max_guests"), 2);
  const bedrooms = toNumberValue(formData.get("bedrooms"), 1);
  const bathrooms = toNumberValue(formData.get("bathrooms"), 1);
  const is_active = toStringValue(formData.get("is_active"));

  if (!id)
    redirect(setupUrl({ tab, error: "El ID de la unidad es obligatorio." }));
  if (!name)
    redirect(
      setupUrl({ tab, error: "El nombre de la unidad es obligatorio." })
    );

  try {
    await patchJson(`/units/${id}`, {
      name,
      max_guests,
      bedrooms,
      bathrooms,
      is_active: is_active ? is_active === "true" : undefined,
    });
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "unidad-actualizada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function updateIntegrationAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  const kind = toStringValue(formData.get("kind"));
  const channel_name = toStringValue(formData.get("channel_name"));
  const public_name = toStringValue(formData.get("public_name"));
  const external_listing_id = toStringValue(
    formData.get("external_listing_id")
  );
  const ical_import_url = toStringValue(formData.get("ical_import_url"));
  const external_account_ref = toStringValue(
    formData.get("external_account_ref")
  );
  const is_active = toStringValue(formData.get("is_active"));

  if (!id)
    redirect(
      setupUrl({ tab, error: "El ID de la integración es obligatorio." })
    );
  if (!public_name)
    redirect(setupUrl({ tab, error: "El nombre público es obligatorio." }));

  try {
    await patchJson(`/integrations/${id}`, {
      kind: kind || undefined,
      channel_name: channel_name || undefined,
      public_name,
      external_listing_id: external_listing_id || undefined,
      ical_import_url: ical_import_url || undefined,
      external_account_ref: external_account_ref || undefined,
      is_active: is_active ? is_active === "true" : undefined,
    });
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "integracion-actualizada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function syncIntegrationIcalAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  if (!id)
    redirect(
      setupUrl({ tab, error: "El ID de la integración es obligatorio." })
    );

  try {
    await postJson(`/integrations/${id}/sync-ical`, {});
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "sincronizacion-ical-solicitada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function deleteUnitAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  if (!id)
    redirect(setupUrl({ tab, error: "El ID de la unidad es obligatorio." }));

  try {
    await deleteJson(`/units/${id}`);
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "unidad-eliminada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}

export async function deleteIntegrationAction(formData: FormData) {
  const tab = toStringValue(formData.get("tab")) || undefined;
  const id = toStringValue(formData.get("id"));
  if (!id)
    redirect(
      setupUrl({ tab, error: "El ID de la integración es obligatorio." })
    );

  try {
    await deleteJson(`/integrations/${id}`);
    revalidatePath("/setup");
    redirect(setupUrl({ tab, success: "integracion-eliminada" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(setupUrl({ tab, error: message }));
  }
}
