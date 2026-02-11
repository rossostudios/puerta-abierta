"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  monthly_income: string;
  guarantee_choice: "cash_deposit" | "guarantor_product";
  message: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

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
    monthly_income: "",
    guarantee_choice: "cash_deposit",
    message: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyStartUrl = useMemo(
    () =>
      `${API_BASE_URL}/public/marketplace/listings/${encodeURIComponent(
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
      },
    };

    try {
      const response = await fetch(
        `${API_BASE_URL}/public/marketplace/applications`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        const suffix = details ? `: ${details.slice(0, 240)}` : "";
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
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Apply" : "Aplicar"}</CardTitle>
        <CardDescription>
          {isEn
            ? "All fields are used for qualification and direct follow-up."
            : "Todos los campos se usan para calificación y seguimiento directo."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm" htmlFor="full_name">
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

            <label className="space-y-1 text-sm" htmlFor="email">
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

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm" htmlFor="phone_e164">
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

            <label className="space-y-1 text-sm" htmlFor="document_number">
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

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm" htmlFor="monthly_income">
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

            <label className="space-y-1 text-sm" htmlFor="guarantee_choice">
              <span>{isEn ? "Guarantee option" : "Opción de garantía"}</span>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
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

          <label className="space-y-1 text-sm" htmlFor="message">
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
            <p className="text-destructive text-sm">
              {isEn
                ? "Could not submit application"
                : "No se pudo enviar la aplicación"}
              : {error}
            </p>
          ) : null}

          {successId ? (
            <p className="text-emerald-700 text-sm dark:text-emerald-300">
              {isEn
                ? "Application submitted successfully."
                : "Aplicación enviada correctamente."}{" "}
              <span className="font-mono">{successId}</span>
            </p>
          ) : null}

          <Button disabled={isSubmitting} type="submit">
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
