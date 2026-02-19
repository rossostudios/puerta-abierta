import Link from "next/link";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchList,
  fetchWorkflowRulesMetadata,
  type WorkflowRuleMetadataResponse,
} from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

import { SequencesManager } from "../sequences/sequences-manager";
import { WorkflowRulesManager } from "../workflow-rules/workflow-rules-manager";

type AutomationsTab = "rules" | "sequences";

type PageProps = {
  searchParams: Promise<{ tab?: string; success?: string; error?: string }>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeTab(value: string | undefined): AutomationsTab {
  return value === "sequences" ? "sequences" : "rules";
}

export default async function AutomationsHubPage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const params = await searchParams;
  const tab = normalizeTab(params.tab);
  const successLabel = params.success
    ? safeDecode(params.success).replaceAll("-", " ")
    : "";
  const errorLabel = params.error ? safeDecode(params.error) : "";

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

  if (tab === "rules") {
    let data: Record<string, unknown>[] = [];
    let metadata: WorkflowRuleMetadataResponse = {
      triggers: [],
      actions: [],
    };
    try {
      [data, metadata] = await Promise.all([
        fetchList("/workflow-rules", orgId, 500) as Promise<
          Record<string, unknown>[]
        >,
        fetchWorkflowRulesMetadata(orgId),
      ]);
    } catch (err) {
      if (isOrgMembershipError(errorMessage(err)))
        return <OrgAccessChanged orgId={orgId} />;
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
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {isEn ? "Workspace" : "Workspace"}
                </Badge>
                <Badge variant="secondary">
                  {isEn ? "Automations" : "Automatizaciones"}
                </Badge>
              </div>
              <CardTitle>{isEn ? "Automations" : "Automatizaciones"}</CardTitle>
              <CardDescription>
                {isEn
                  ? "Manage event-driven automation rules and communication sequences."
                  : "Gestiona reglas automatizadas por eventos y secuencias de comunicación."}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "secondary" })
                )}
                href="/module/automations?tab=rules"
              >
                {isEn ? "Rules" : "Reglas"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" })
                )}
                href="/module/automations?tab=sequences"
              >
                {isEn ? "Sequences" : "Secuencias"}
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {successLabel ? (
            <Alert className="mb-4">
              <AlertDescription>{successLabel}</AlertDescription>
            </Alert>
          ) : null}
          {errorLabel ? (
            <Alert className="mb-4" variant="destructive">
              <AlertDescription>{errorLabel}</AlertDescription>
            </Alert>
          ) : null}
          <WorkflowRulesManager
            data={data}
            locale={locale}
            metadata={metadata}
            orgId={orgId}
          />
        </CardContent>
      </Card>
    );
  }

  let sequences: Record<string, unknown>[] = [];
  let templates: Record<string, unknown>[] = [];

  try {
    [sequences, templates] = await Promise.all([
      fetchList("/communication-sequences", orgId, 200) as Promise<
        Record<string, unknown>[]
      >,
      fetchList("/message-templates", orgId, 200) as Promise<
        Record<string, unknown>[]
      >,
    ]);
  } catch (err) {
    if (isOrgMembershipError(errorMessage(err)))
      return <OrgAccessChanged orgId={orgId} />;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isEn ? "Sequences" : "Secuencias"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              {isEn
                ? "Failed to load sequences."
                : "Error al cargar secuencias."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {isEn ? "Workspace" : "Workspace"}
              </Badge>
              <Badge variant="secondary">
                {isEn ? "Automations" : "Automatizaciones"}
              </Badge>
            </div>
            <CardTitle>{isEn ? "Automations" : "Automatizaciones"}</CardTitle>
            <CardDescription>
              {isEn
                ? "Manage event-driven automation rules and communication sequences."
                : "Gestiona reglas automatizadas por eventos y secuencias de comunicación."}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Link
              className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
              href="/module/automations?tab=rules"
            >
              {isEn ? "Rules" : "Reglas"}
            </Link>
            <Link
              className={cn(
                buttonVariants({ size: "sm", variant: "secondary" })
              )}
              href="/module/automations?tab=sequences"
            >
              {isEn ? "Sequences" : "Secuencias"}
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {successLabel ? (
          <Alert className="mb-4">
            <AlertDescription>{successLabel}</AlertDescription>
          </Alert>
        ) : null}
        {errorLabel ? (
          <Alert className="mb-4" variant="destructive">
            <AlertDescription>{errorLabel}</AlertDescription>
          </Alert>
        ) : null}
        <SequencesManager
          locale={locale}
          orgId={orgId}
          sequences={sequences}
          templates={templates}
        />
      </CardContent>
    </Card>
  );
}
