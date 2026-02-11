import { OrgAccessChanged } from "@/components/shell/org-access-changed";
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

import { LeasesManager } from "./leases-manager";

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
      fetchList("/leases", orgId, 500),
      fetchList("/properties", orgId, 500),
      fetchList("/units", orgId, 1000),
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
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn ? "Leases" : "Contratos"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Manage lease lifecycle and monitor collection performance."
              : "Administra el ciclo de vida de contratos y el desempeño de cobros."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorLabel ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">{errorLabel}</p>
            </div>
          ) : null}
          {successLabel ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
              <p className="font-medium text-emerald-700">
                {isEn ? "Success" : "Éxito"}: {successLabel}
              </p>
            </div>
          ) : null}

          <LeasesManager
            leases={leases}
            orgId={orgId}
            properties={properties}
            units={units}
          />
        </CardContent>
      </Card>
    </div>
  );
}
