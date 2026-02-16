"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { deleteJson, postJson } from "@/lib/api";

function toStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNumberValue(value: FormDataEntryValue | null): number | null {
  const raw = toStringValue(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function reservationsUrl(params?: {
  success?: string;
  error?: string;
}): string {
  const qs = new URLSearchParams();
  if (params?.success) qs.set("success", params.success);
  if (params?.error) qs.set("error", params.error);
  const suffix = qs.toString();
  return suffix ? `/module/reservations?${suffix}` : "/module/reservations";
}

export async function createReservationAction(formData: FormData) {
  const organization_id = toStringValue(formData.get("organization_id"));
  const unit_id = toStringValue(formData.get("unit_id"));
  const check_in_date = toStringValue(formData.get("check_in_date"));
  const check_out_date = toStringValue(formData.get("check_out_date"));
  const total_amount = toNumberValue(formData.get("total_amount"));

  const status = toStringValue(formData.get("status")) || "pending";
  const currency = toStringValue(formData.get("currency")) || undefined;
  const notes = toStringValue(formData.get("notes")) || undefined;

  if (!organization_id) {
    redirect(reservationsUrl({ error: "Missing organization context." }));
  }
  if (!unit_id) {
    redirect(reservationsUrl({ error: "unit_id is required" }));
  }
  if (!(check_in_date && check_out_date)) {
    redirect(
      reservationsUrl({
        error: "check_in_date and check_out_date are required",
      })
    );
  }
  if (total_amount === null) {
    redirect(reservationsUrl({ error: "total_amount is required" }));
  }

  try {
    await postJson("/reservations", {
      organization_id,
      unit_id,
      check_in_date,
      check_out_date,
      total_amount,
      status,
      ...(currency ? { currency } : {}),
      ...(notes ? { notes } : {}),
    });

    revalidatePath("/module/reservations");
    redirect(reservationsUrl({ success: "reservation-created" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(reservationsUrl({ error: message.slice(0, 240) }));
  }
}

export async function createCalendarBlockAction(formData: FormData) {
  const organization_id = toStringValue(formData.get("organization_id"));
  const unit_id = toStringValue(formData.get("unit_id"));
  const starts_on = toStringValue(formData.get("starts_on"));
  const ends_on = toStringValue(formData.get("ends_on"));
  const reason = toStringValue(formData.get("reason")) || undefined;

  if (!organization_id) {
    redirect(reservationsUrl({ error: "Missing organization context." }));
  }
  if (!unit_id) {
    redirect(reservationsUrl({ error: "unit_id is required" }));
  }
  if (!(starts_on && ends_on)) {
    redirect(reservationsUrl({ error: "starts_on and ends_on are required" }));
  }

  try {
    await postJson("/calendar/blocks", {
      organization_id,
      unit_id,
      starts_on,
      ends_on,
      source: "manual",
      ...(reason ? { reason } : {}),
    });

    revalidatePath("/module/reservations");
    redirect(reservationsUrl({ success: "block-created" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(reservationsUrl({ error: message.slice(0, 240) }));
  }
}

export async function deleteCalendarBlockAction(formData: FormData) {
  const block_id = toStringValue(formData.get("block_id"));

  if (!block_id) {
    redirect(reservationsUrl({ error: "block_id is required" }));
  }

  try {
    await deleteJson(`/calendar/blocks/${encodeURIComponent(block_id)}`);

    revalidatePath("/module/reservations");
    redirect(reservationsUrl({ success: "block-deleted" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(reservationsUrl({ error: message.slice(0, 240) }));
  }
}

export async function transitionReservationStatusAction(formData: FormData) {
  const reservation_id = toStringValue(formData.get("reservation_id"));
  const status = toStringValue(formData.get("status"));
  const reason = toStringValue(formData.get("reason")) || undefined;

  if (!reservation_id) {
    redirect(reservationsUrl({ error: "reservation_id is required" }));
  }
  if (!status) {
    redirect(reservationsUrl({ error: "status is required" }));
  }

  try {
    await postJson(
      `/reservations/${encodeURIComponent(reservation_id)}/status`,
      {
        status,
        ...(reason ? { reason } : {}),
      }
    );

    revalidatePath("/module/reservations");
    redirect(reservationsUrl({ success: "reservation-updated" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(reservationsUrl({ error: message.slice(0, 240) }));
  }
}
