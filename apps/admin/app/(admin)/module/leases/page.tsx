import Link from "next/link";
import { Suspense } from "react";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

const LeasesManager = dynamic(() =>
  import("./leases-manager").then((m) => m.LeasesManager)
);

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

export default async function LeasesModulePage({ searchParams }: PageProps) {
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
              ? "Select an organization to load leases."
              : "Selecciona una organización para cargar contratos."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let leases: Record<string, unknown>[] = [];
  let properties: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    const [leaseRows, propertyRows, unitRows] = await Promise.all([
      fetchList("/leases", orgId, 300),
      fetchList("/properties", orgId, 300),
      fetchList("/units", orgId, 300),
    ]);
    leases = leaseRows as Record<string, unknown>[];
    properties = propertyRows as Record<string, unknown>[];
    units = unitRows as Record<string, unknown>[];
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
              ? "Could not load leases from backend."
              : "No se pudieron cargar contratos desde el backend."}
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
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-2xl">
                {isEn ? "Leases" : "Contratos"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Manage lease lifecycle and monitor collection performance."
                  : "Administra el ciclo de vida de contratos y el desempeño de cobros."}
              </CardDescription>
            </div>
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href="/module/pricing"
            >
              {isEn ? "Manage pricing templates" : "Gestionar plantillas de precios"}
            </Link>
          </div>
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
            <LeasesManager
              leases={leases}
              orgId={orgId}
              properties={properties}
              units={units}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
