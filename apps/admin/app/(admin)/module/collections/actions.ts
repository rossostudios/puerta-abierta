"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { postJson } from "@/lib/api";

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

function collectionsUrl(params?: { success?: string; error?: string }): string {
  return withParams("/module/collections", params ?? {});
}

export async function createCollectionAction(formData: FormData) {
  const organization_id = toStringValue(formData.get("organization_id"));
  if (!organization_id) {
    redirect(collectionsUrl({ error: "Missing organization context." }));
  }

  const next = normalizeNext(
    toStringValue(formData.get("next")),
    collectionsUrl()
  );

  const lease_id = toStringValue(formData.get("lease_id"));
  const due_date = toStringValue(formData.get("due_date"));
  const amount = toOptionalNumber(formData.get("amount")) ?? 0;

  if (!lease_id) {
    redirect(withParams(next, { error: "lease_id is required" }));
  }
  if (!due_date) {
    redirect(withParams(next, { error: "due_date is required" }));
  }
  if (amount <= 0) {
    redirect(withParams(next, { error: "amount must be greater than 0" }));
  }

  const payload: Record<string, unknown> = {
    organization_id,
    lease_id,
    due_date,
    amount,
    currency: (toStringValue(formData.get("currency")) || "PYG").toUpperCase(),
    status: toStringValue(formData.get("status")) || "scheduled",
  };

  const payment_method = toStringValue(formData.get("payment_method"));
  const payment_reference = toStringValue(formData.get("payment_reference"));
  const notes = toStringValue(formData.get("notes"));

  if (payment_method) payload.payment_method = payment_method;
  if (payment_reference) payload.payment_reference = payment_reference;
  if (notes) payload.notes = notes;

  try {
    await postJson("/collections", payload);
    revalidatePath("/module/collections");
    revalidatePath("/module/leases");
    revalidatePath("/app");
    redirect(withParams(next, { success: "collection-created" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}

export async function markCollectionPaidAction(formData: FormData) {
  const collection_id = toStringValue(formData.get("collection_id"));
  if (!collection_id) {
    redirect(collectionsUrl({ error: "collection_id is required" }));
  }

  const next = normalizeNext(
    toStringValue(formData.get("next")),
    collectionsUrl()
  );

  const payload: Record<string, unknown> = {};
  const payment_method = toStringValue(formData.get("payment_method"));
  const payment_reference = toStringValue(formData.get("payment_reference"));
  const paid_at = toStringValue(formData.get("paid_at"));
  const notes = toStringValue(formData.get("notes"));

  if (payment_method) payload.payment_method = payment_method;
  if (payment_reference) payload.payment_reference = payment_reference;
  if (paid_at) payload.paid_at = paid_at;
  if (notes) payload.notes = notes;

  try {
    await postJson(
      `/collections/${encodeURIComponent(collection_id)}/mark-paid`,
      payload
    );
    revalidatePath("/module/collections");
    revalidatePath("/module/leases");
    revalidatePath("/app");
    redirect(withParams(next, { success: "collection-marked-paid" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(withParams(next, { error: message.slice(0, 240) }));
  }
}
