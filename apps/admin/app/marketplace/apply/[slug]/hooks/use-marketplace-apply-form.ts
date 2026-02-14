import { useEffect, useMemo, useState } from "react";

export type MarketplaceApplyFormState = {
  full_name: string;
  email: string;
  phone_e164: string;
  document_number: string;
  preferred_move_in: string;
  monthly_income: string;
  guarantee_choice: "cash_deposit" | "guarantor_product";
  message: string;
};

function defaultFormState(): MarketplaceApplyFormState {
  return {
    full_name: "",
    email: "",
    phone_e164: "",
    document_number: "",
    preferred_move_in: "",
    monthly_income: "",
    guarantee_choice: "cash_deposit",
    message: "",
  };
}

export function useMarketplaceApplyForm(params: {
  listingSlug: string;
  locale: "es-PY" | "en-US";
}) {
  const { listingSlug, locale } = params;

  const [form, setForm] = useState<MarketplaceApplyFormState>(defaultFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyStartUrl = useMemo(
    () =>
      `/api/public/marketplace/listings/${encodeURIComponent(listingSlug)}/apply-start`,
    [listingSlug]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch(applyStartUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    }).catch(() => {
      // Ignore telemetry failures.
    });

    return () => controller.abort();
  }, [applyStartUrl]);

  const updateField = <K extends keyof MarketplaceApplyFormState>(
    key: K,
    value: MarketplaceApplyFormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessId(null);
    setIsSubmitting(true);

    const incomeValue = form.monthly_income.trim();
    const parsedIncome = incomeValue ? Number(incomeValue) : null;

    const payload: Record<string, unknown> = {
      listing_slug: listingSlug,
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone_e164: form.phone_e164.trim() || undefined,
      document_number: form.document_number.trim() || undefined,
      monthly_income:
        parsedIncome !== null && Number.isFinite(parsedIncome)
          ? parsedIncome
          : undefined,
      guarantee_choice: form.guarantee_choice,
      message: form.message.trim() || undefined,
      source: "marketplace",
      metadata: {
        locale,
        preferred_move_in: form.preferred_move_in.trim() || undefined,
      },
    };

    try {
      const response = await fetch("/api/public/marketplace/applications", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        let detailMessage = details;
        if (details) {
          try {
            const parsed = JSON.parse(details) as {
              error?: unknown;
              detail?: unknown;
              message?: unknown;
            };
            const detail = parsed.error ?? parsed.detail ?? parsed.message ?? details;
            detailMessage = typeof detail === "string" ? detail : JSON.stringify(detail);
          } catch {
            detailMessage = details;
          }
        }
        const suffix = detailMessage ? `: ${detailMessage.slice(0, 240)}` : "";
        throw new Error(`HTTP ${response.status}${suffix}`);
      }

      const result = (await response.json()) as { id?: string };
      const nextId = typeof result.id === "string" ? result.id : null;
      setSuccessId(nextId);
      setForm(defaultFormState());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    form,
    error,
    isSubmitting,
    successId,
    onSubmit,
    updateField,
  };
}
