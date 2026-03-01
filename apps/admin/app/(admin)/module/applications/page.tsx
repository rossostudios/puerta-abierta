import dynamic from "next/dynamic";
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
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";

const ApplicationsManager = dynamic(() =>
  import("./applications-manager").then((m) => m.ApplicationsManager)
);

const LeasingPipeline = dynamic(() =>
  import("./leasing-pipeline").then((m) => m.LeasingPipeline)
);

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function ApplicationsModulePage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  const successLabel = success ? safeDecode(success).replaceAll("-", " ") : "";
  const errorLabel = error ? safeDecode(error) : "";

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["applications", "aplicaciones"]} />;
  }

  let applications: Record<string, unknown>[] = [];
  let members: Record<string, unknown>[] = [];
  let messageTemplates: Record<string, unknown>[] = [];
  let submissionAlerts: Record<string, unknown>[] = [];
  let leasingConversations: Record<string, unknown>[] = [];
  try {
    const [applicationRows, memberRows, templateRows, alertRows, convRows] =
      await Promise.all([
        fetchList("/applications", orgId, 250),
        fetchList(`/organizations/${orgId}/members`, orgId, 150),
        fetchList("/message-templates", orgId, 120),
        fetchList("/integration-events", orgId, 100, {
          provider: "alerting",
          event_type: "application_submit_failed",
          status: "failed",
        }),
        fetchList("/leasing-conversations", orgId, 200).catch(() => []),
      ]);

    applications = applicationRows as Record<string, unknown>[];
    members = memberRows as Record<string, unknown>[];
    messageTemplates = templateRows as Record<string, unknown>[];
    submissionAlerts = alertRows as Record<string, unknown>[];
    leasingConversations = convRows as Record<string, unknown>[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }

    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn ? "Applications pipeline" : "Pipeline de aplicaciones"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Run qualification workflow and convert qualified applicants to leases."
              : "Ejecuta calificación y convierte solicitantes calificados a contratos."}
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
          {submissionAlerts.length > 0 ? (
            <Alert variant="warning">
              <AlertTitle>
                {isEn
                  ? `Submission alerts detected: ${submissionAlerts.length}`
                  : `Alertas de envío detectadas: ${submissionAlerts.length}`}
              </AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                {isEn
                  ? "Review Channel Events for failed marketplace application submissions."
                  : "Revisa Eventos de canales para envíos fallidos de aplicaciones del marketplace."}
              </AlertDescription>
            </Alert>
          ) : null}

          <Suspense fallback={null}>
            <ApplicationsManager
              applications={applications}
              members={members}
              messageTemplates={messageTemplates}
            />
          </Suspense>
        </CardContent>
      </Card>

      {/* Leasing Pipeline Kanban */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "AI Leasing Pipeline" : "Pipeline de Leasing IA"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Track AI-driven leasing conversations through the qualification funnel. Leads are auto-qualified, matched to units, and scheduled for tours."
              : "Rastrea las conversaciones de leasing impulsadas por IA a través del embudo de calificación. Los prospectos se califican automáticamente, se emparejan con unidades y se programan para tours."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <LeasingPipeline
              initialConversations={leasingConversations as never[]}
              locale={locale}
              orgId={orgId}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
