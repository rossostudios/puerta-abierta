import { Suspense } from "react";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { MarketCalibration } from "./market-calibration";
import { PricingHero } from "./pricing-hero";
import { PricingManager } from "./pricing-manager";
import { PricingStrategy } from "./pricing-strategy";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function PricingModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  const successLabel = success ? safeDecode(success).replaceAll("-", " ") : "";
  const errorLabel = error ? safeDecode(error) : "";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn
              ? "Missing organization context"
              : "Falta contexto de organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to load pricing intelligence."
              : "Selecciona una organización para cargar inteligencia de precios."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let templates: Record<string, unknown>[] = [];
  let recommendations: unknown[] = [];
  let strategies: unknown[] = [];
  try {
    const [t, r, s] = await Promise.all([
      fetchList("/pricing/templates", orgId, 500),
      fetchList("/pricing/recommendations", orgId, 50, { status: "pending" }),
      fetchList("/pricing/strategies", orgId, 10),
    ]);
    templates = t as Record<string, unknown>[];
    recommendations = r;
    strategies = s;
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load pricing data from backend."
              : "No se pudieron cargar datos de precios desde el backend."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {getApiBaseUrl()}
            </code>
          </p>
          <p className="break-words">{message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {errorLabel ? (
        <Alert variant="destructive">
          <AlertTitle>
            {isEn
              ? "Could not complete request"
              : "No se pudo completar la solicitud"}
          </AlertTitle>
          <AlertDescription>{errorLabel}</AlertDescription>
        </Alert>
      ) : null}
      {successLabel ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn ? "Success" : "Éxito"}: {successLabel}
          </AlertTitle>
        </Alert>
      ) : null}

      {/* 1. AI Pricing Recommendations — hero section */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn
              ? "AI Pricing Recommendations"
              : "Recomendaciones de Precios IA"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Your pricing agent analyzes occupancy, seasonality, and market trends to suggest rate adjustments."
              : "Tu agente de precios analiza ocupación, estacionalidad y tendencias de mercado para sugerir ajustes de tarifas."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <PricingHero
              initialRecommendations={recommendations}
              locale={locale}
              orgId={orgId}
            />
          </Suspense>
        </CardContent>
      </Card>

      {/* 2. Market Calibration */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Market Calibration" : "Calibración de Mercado"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "AI model status trained from your reservation history to improve pricing accuracy."
              : "Estado del modelo IA entrenado con tu historial de reservas para mejorar la precisión de precios."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <MarketCalibration locale={locale} orgId={orgId} />
          </Suspense>
        </CardContent>
      </Card>

      {/* 3. Pricing Strategy */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Pricing Strategy" : "Estrategia de Precios"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Choose a strategy that controls how AI adjusts your rates. Parameters are automatically configured."
              : "Elige una estrategia que controle cómo la IA ajusta tus tarifas. Los parámetros se configuran automáticamente."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <PricingStrategy
              initialStrategies={strategies as never[]}
              locale={locale}
              orgId={orgId}
            />
          </Suspense>
        </CardContent>
      </Card>

      {/* 4. Move-in Fee Templates */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Move-in Fee Templates" : "Plantillas de Costos de Ingreso"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Define transparent move-in pricing blocks used by marketplace listings."
              : "Define bloques transparentes de costo de ingreso para anuncios del marketplace."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <PricingManager orgId={orgId} templates={templates} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
