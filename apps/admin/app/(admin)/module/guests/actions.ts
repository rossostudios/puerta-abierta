"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { deleteJson, patchJson, postJson } from "@/lib/api";

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
  if (params.success) qs.set("success", params.success);
  if (params.error) qs.set("error", params.error);
  const suffix = qs.toString();
  return suffix ? `${base}?${suffix}` : base;
}

function guestsUrl(params: { success?: string; error?: string } = {}): string {
  const qs = new URLSearchParams();
  if (params.success) qs.set("success", params.success);
  if (params.error) qs.set("error", params.error);
  const suffix = qs.toString();
  return suffix ? `/module/guests?${suffix}` : "/module/guests";
}

export async function createGuestAction(formData: FormData) {
  const next = normalizeNext(
    toStringValue(formData.get("next")) || "/module/guests",
    "/module/guests"
  );
  const organization_id = toStringValue(formData.get("organization_id"));
  const full_name = toStringValue(formData.get("full_name"));
  const email = toStringValue(formData.get("email")) || undefined;
  const phone_e164 = toStringValue(formData.get("phone_e164")) || undefined;
  const document_type =
    toStringValue(formData.get("document_type")) || undefined;
  const document_number =
    toStringValue(formData.get("document_number")) || undefined;
  const country_code = toStringValue(formData.get("country_code")) || undefined;
  const preferred_language =
    toStringValue(formData.get("preferred_language")) || undefined;
  const notes = toStringValue(formData.get("notes")) || undefined;
  const id_document_url =
    toStringValue(formData.get("id_document_url")) || undefined;
  const date_of_birth =
    toStringValue(formData.get("date_of_birth")) || undefined;
  const emergency_contact_name =
    toStringValue(formData.get("emergency_contact_name")) || undefined;
  const emergency_contact_phone =
    toStringValue(formData.get("emergency_contact_phone")) || undefined;
  const address = toStringValue(formData.get("address")) || undefined;
  const city = toStringValue(formData.get("city")) || undefined;
  const occupation = toStringValue(formData.get("occupation")) || undefined;
  const document_expiry =
    toStringValue(formData.get("document_expiry")) || undefined;
  const nationality = toStringValue(formData.get("nationality")) || undefined;

  if (!organization_id) {
    redirect(guestsUrl({ error: "Falta contexto de organización." }));
  }
  if (!full_name) {
    redirect(guestsUrl({ error: "El nombre del huésped es obligatorio." }));
  }

  try {
    await postJson("/guests", {
      organization_id,
      full_name,
      email,
      phone_e164,
      document_type,
      document_number,
      country_code,
      preferred_language,
      notes,
      id_document_url,
      date_of_birth,
      emergency_contact_name,
      emergency_contact_phone,
      address,
      city,
      occupation,
      document_expiry,
      nationality,
    });
    revalidatePath("/module/guests");
    redirect(withParams(next, { success: "huesped-creado" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message }));
  }
}

export async function updateGuestAction(formData: FormData) {
  const id = toStringValue(formData.get("id"));
  const next = normalizeNext(
    toStringValue(formData.get("next")) || "/module/guests",
    "/module/guests"
  );

  const full_name = toStringValue(formData.get("full_name")) || undefined;
  const email = toStringValue(formData.get("email")) || undefined;
  const phone_e164 = toStringValue(formData.get("phone_e164")) || undefined;
  const document_type =
    toStringValue(formData.get("document_type")) || undefined;
  const document_number =
    toStringValue(formData.get("document_number")) || undefined;
  const country_code = toStringValue(formData.get("country_code")) || undefined;
  const preferred_language =
    toStringValue(formData.get("preferred_language")) || undefined;
  const notes = toStringValue(formData.get("notes")) || undefined;
  const id_document_url =
    toStringValue(formData.get("id_document_url")) || undefined;
  const date_of_birth =
    toStringValue(formData.get("date_of_birth")) || undefined;
  const emergency_contact_name =
    toStringValue(formData.get("emergency_contact_name")) || undefined;
  const emergency_contact_phone =
    toStringValue(formData.get("emergency_contact_phone")) || undefined;
  const address = toStringValue(formData.get("address")) || undefined;
  const city = toStringValue(formData.get("city")) || undefined;
  const occupation = toStringValue(formData.get("occupation")) || undefined;
  const document_expiry =
    toStringValue(formData.get("document_expiry")) || undefined;
  const nationality = toStringValue(formData.get("nationality")) || undefined;

  if (!id) {
    redirect(guestsUrl({ error: "El ID del huésped es obligatorio." }));
  }

  try {
    await patchJson(`/guests/${id}`, {
      full_name,
      email,
      phone_e164,
      document_type,
      document_number,
      country_code,
      preferred_language,
      notes,
      id_document_url,
      date_of_birth,
      emergency_contact_name,
      emergency_contact_phone,
      address,
      city,
      occupation,
      document_expiry,
      nationality,
    });
    revalidatePath("/module/guests");
    revalidatePath(`/module/guests/${id}`);
    redirect(withParams(next, { success: "huesped-actualizado" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message }));
  }
}

export async function updateGuestInlineAction({
  guestId,
  field,
  value,
}: {
  guestId: string;
  field: string;
  value: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await patchJson(`/guests/${guestId}`, { [field]: value });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.slice(0, 240) };
  }
  revalidatePath("/module/guests");
  return { ok: true };
}

export async function deleteGuestAction(formData: FormData) {
  const id = toStringValue(formData.get("id"));
  const next = normalizeNext(
    toStringValue(formData.get("next")) || "/module/guests",
    "/module/guests"
  );

  if (!id) {
    redirect(guestsUrl({ error: "El ID del huésped es obligatorio." }));
  }

  try {
    await deleteJson(`/guests/${id}`);
    revalidatePath("/module/guests");
    redirect(withParams(next, { success: "huesped-eliminado" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message }));
  }
}
