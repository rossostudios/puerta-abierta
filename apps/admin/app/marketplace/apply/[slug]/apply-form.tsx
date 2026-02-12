"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type MarketplaceApplyFormProps = {
  listingSlug: string;
  locale: "es-PY" | "en-US";
};

type FormState = {
  full_name: string;
  email: string;
  phone_e164: string;
  document_number: string;
  preferred_move_in: string;
  monthly_income: string;
  guarantee_choice: "cash_deposit" | "guarantor_product";
  message: string;
};

export function MarketplaceApplyForm({
  listingSlug,
  locale,
}: MarketplaceApplyFormProps) {
  const isEn = locale === "en-US";

  const [form, setForm] = useState<FormState>({
    full_name: "",
    email: "",
    phone_e164: "",
    document_number: "",
    preferred_move_in: "",
    monthly_income: "",
    guarantee_choice: "cash_deposit",
    message: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyStartUrl = useMemo(
    () =>
      `/api/public/marketplace/listings/${encodeURIComponent(
        listingSlug
      )}/apply-start`,
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
            const detail =
              parsed.error ?? parsed.detail ?? parsed.message ?? details;
            detailMessage =
              typeof detail === "string" ? detail : JSON.stringify(detail);
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
      setForm({
        full_name: "",
        email: "",
        phone_e164: "",
        document_number: "",
        preferred_move_in: "",
        monthly_income: "",
        guarantee_choice: "cash_deposit",
        message: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{isEn ? "Apply" : "Aplicar"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Complete this form for qualification and direct follow-up."
            : "Completa este formulario para calificación y seguimiento directo."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="min-w-0 space-y-4" onSubmit={onSubmit}>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <label className="min-w-0 space-y-1 text-sm" htmlFor="full_name">
              <span>{isEn ? "Full name" : "Nombre completo"}</span>
              <Input
                id="full_name"
                name="full_name"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    full_name: event.target.value,
                  }))
                }
                required
                value={form.full_name}
              />
            </label>

            <label className="min-w-0 space-y-1 text-sm" htmlFor="email">
              <span>Email</span>
              <Input
                id="email"
                name="email"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
                required
                type="email"
                value={form.email}
              />
            </label>
          </div>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <label className="min-w-0 space-y-1 text-sm" htmlFor="phone_e164">
              <span>{isEn ? "Phone" : "Teléfono"}</span>
              <Input
                id="phone_e164"
                name="phone_e164"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    phone_e164: event.target.value,
                  }))
                }
                placeholder="+595..."
                value={form.phone_e164}
              />
            </label>

            <label
              className="min-w-0 space-y-1 text-sm"
              htmlFor="document_number"
            >
              <span>{isEn ? "Document number" : "Número de documento"}</span>
              <Input
                id="document_number"
                name="document_number"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    document_number: event.target.value,
                  }))
                }
                value={form.document_number}
              />
            </label>
          </div>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <label
              className="min-w-0 space-y-1 text-sm"
              htmlFor="preferred_move_in"
            >
              <span>
                {isEn ? "Preferred move-in date" : "Fecha de ingreso preferida"}
              </span>
              <DatePicker
                id="preferred_move_in"
                locale={locale}
                onValueChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    preferred_move_in: next,
                  }))
                }
                value={form.preferred_move_in}
              />
            </label>

            <label
              className="min-w-0 space-y-1 text-sm"
              htmlFor="monthly_income"
            >
              <span>{isEn ? "Monthly income" : "Ingreso mensual"}</span>
              <Input
                id="monthly_income"
                min={0}
                name="monthly_income"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    monthly_income: event.target.value,
                  }))
                }
                step="0.01"
                type="number"
                value={form.monthly_income}
              />
            </label>

            <label
              className="min-w-0 space-y-1 text-sm"
              htmlFor="guarantee_choice"
            >
              <span>{isEn ? "Guarantee option" : "Opción de garantía"}</span>
              <select
                className="flex h-10 w-full min-w-0 rounded-xl border border-input bg-background/90 px-3 py-1.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                id="guarantee_choice"
                name="guarantee_choice"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    guarantee_choice: event.target.value as
                      | "cash_deposit"
                      | "guarantor_product",
                  }))
                }
                value={form.guarantee_choice}
              >
                <option value="cash_deposit">
                  {isEn ? "Cash deposit" : "Depósito en efectivo"}
                </option>
                <option value="guarantor_product">
                  {isEn ? "Guarantor product" : "Producto garante"}
                </option>
              </select>
            </label>
          </div>

          <label className="min-w-0 space-y-1 text-sm" htmlFor="message">
            <span>{isEn ? "Message" : "Mensaje"}</span>
            <Textarea
              id="message"
              name="message"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, message: event.target.value }))
              }
              placeholder={
                isEn
                  ? "Tell us your preferred move-in date, profile, and questions."
                  : "Cuéntanos fecha ideal de ingreso, perfil y consultas."
              }
              value={form.message}
            />
          </label>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>
                {isEn
                  ? "Could not submit application"
                  : "No se pudo enviar la aplicación"}
              </AlertTitle>
              <AlertDescription className="break-words">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}

          {successId ? (
            <Alert variant="success">
              <AlertTitle>
                {isEn
                  ? "Application submitted successfully."
                  : "Aplicación enviada correctamente."}
              </AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                ID: <span className="font-mono">{successId}</span>
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            className="w-full sm:w-auto"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting
              ? isEn
                ? "Submitting..."
                : "Enviando..."
              : isEn
                ? "Submit application"
                : "Enviar aplicación"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
