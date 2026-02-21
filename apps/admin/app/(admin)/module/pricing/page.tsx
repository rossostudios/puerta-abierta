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

import { PricingManager } from "./pricing-manager";
import { PricingRecommendations } from "./pricing-recommendations";

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
              ? "Select an organization to load pricing templates."
              : "Selecciona una organización para cargar plantillas de precios."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let templates: Record<string, unknown>[] = [];
  let recommendations: unknown[] = [];
  try {
    const [t, r] = await Promise.all([
      fetchList("/pricing/templates", orgId, 500),
      fetchList("/pricing/recommendations", orgId, 50, { status: "pending" }),
    ]);
    templates = t as Record<string, unknown>[];
    recommendations = r;
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
              ? "Could not load pricing templates from backend."
              : "No se pudieron cargar plantillas desde el backend."}
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
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn ? "Pricing templates" : "Plantillas de precios"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Define transparent move-in pricing blocks used by marketplace listings."
              : "Define bloques transparentes de costo de ingreso para anuncios del marketplace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <Suspense fallback={null}>
            <PricingManager orgId={orgId} templates={templates} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "AI Rate Recommendations" : "Recomendaciones de Tarifas IA"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "The pricing agent analyzes occupancy, seasonality, and market data to suggest rate adjustments."
              : "El agente de precios analiza ocupación, estacionalidad y datos de mercado para sugerir ajustes de tarifas."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <PricingRecommendations
              orgId={orgId}
              initialRecommendations={recommendations}
              locale={locale}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
