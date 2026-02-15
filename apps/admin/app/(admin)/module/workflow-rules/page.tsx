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

import { WorkflowRulesManager } from "./workflow-rules-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function WorkflowRulesPage({
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
              ? "Select an organization to manage automations."
              : "Selecciona una organización para gestionar automatizaciones."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let data: Record<string, unknown>[] = [];
  try {
    data = (await fetchList("/workflow-rules", orgId, 500)) as Record<string, unknown>[];
  } catch (err) {
    if (isOrgMembershipError(errorMessage(err))) return <OrgAccessChanged orgId={orgId} />;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isEn ? "Automations" : "Automatizaciones"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              {isEn
                ? "Failed to load automation rules."
                : "Error al cargar las reglas de automatización."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Automations" : "Automatizaciones"}</CardTitle>
        <CardDescription>
          {isEn
            ? "When an event occurs, automatically execute an action."
            : "Cuando ocurre un evento, ejecutar automáticamente una acción."}
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
        <WorkflowRulesManager data={data} locale={locale} orgId={orgId} />
      </CardContent>
    </Card>
  );
}
