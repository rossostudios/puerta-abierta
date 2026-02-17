import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { IntegrationsManager } from "./integrations-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function IntegrationsModulePage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Missing organization" : "Falta organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to manage integrations."
              : "Selecciona una organización para gestionar integraciones."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let integrations: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];
  let events: Record<string, unknown>[] = [];
  try {
    [integrations, units, events] = await Promise.all([
      fetchList("/integrations", orgId, 200) as Promise<Record<string, unknown>[]>,
      fetchList("/units", orgId, 500) as Promise<Record<string, unknown>[]>,
      fetchList("/integration-events", orgId, 100) as Promise<Record<string, unknown>[]>,
    ]);
  } catch (err) {
    if (isOrgMembershipError(errorMessage(err)))
      return <OrgAccessChanged orgId={orgId} />;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isEn ? "Integrations" : "Integraciones"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              {isEn
                ? "Failed to load integrations."
                : "Error al cargar integraciones."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Integrations" : "Integraciones"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Connect units to OTAs and direct-sales channels with iCal sync."
            : "Conecta unidades a OTAs y canales de venta directa con sync iCal."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success && (
          <Alert className="mb-4">
            <AlertDescription>{success.replaceAll("-", " ")}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert className="mb-4" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <IntegrationsManager
          events={events}
          integrations={integrations}
          locale={locale}
          orgId={orgId}
          units={units}
        />
      </CardContent>
    </Card>
  );
}
