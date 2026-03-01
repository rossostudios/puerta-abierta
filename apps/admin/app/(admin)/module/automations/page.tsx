import Link from "next/link";
import { Suspense } from "react";
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
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

import { SequencesManager } from "../sequences/sequences-manager";
import { WorkflowRulesManager } from "../workflow-rules/workflow-rules-manager";
import { PlaybookBuilder } from "./playbook-builder";
import { VisualBuilder } from "./visual-builder";

type AutomationsTab = "rules" | "sequences" | "visual-builder";

type PageProps = {
  searchParams: Promise<{ tab?: string; success?: string; error?: string }>;
};

function normalizeTab(value: string | undefined): AutomationsTab {
  if (value === "sequences") return "sequences";
  if (value === "visual-builder") return "visual-builder";
  return "rules";
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

  if (tab === "visual-builder") {
    let rulesForBuilder: Record<string, unknown>[] = [];
    try {
      rulesForBuilder = (await fetchList(
        "/workflow-rules",
        orgId,
        500
      )) as Record<string, unknown>[];
    } catch (err) {
      if (isOrgMembershipError(errorMessage(err)))
        return <OrgAccessChanged orgId={orgId} />;
      // Non-fatal: visual builder can work with empty rules
      rulesForBuilder = [];
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
                  ? "Visual drag-and-drop workflow builder for automation rules."
                  : "Constructor visual de flujos de trabajo para reglas de automatizacion."}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" })
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
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "secondary" })
                )}
                href="/module/automations?tab=visual-builder"
              >
                {isEn ? "Visual Builder" : "Constructor Visual"}
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
          <Suspense fallback={null}>
            <VisualBuilder
              initialRules={rulesForBuilder}
              locale={locale}
              orgId={orgId}
            />
          </Suspense>
        </CardContent>
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
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" })
                )}
                href="/module/automations?tab=visual-builder"
              >
                {isEn ? "Visual Builder" : "Constructor Visual"}
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
  let playbooks: Record<string, unknown>[] = [];

  try {
    [sequences, templates, playbooks] = await Promise.all([
      fetchList("/communication-sequences", orgId, 200) as Promise<
        Record<string, unknown>[]
      >,
      fetchList("/message-templates", orgId, 200) as Promise<
        Record<string, unknown>[]
      >,
      fetchList("/agent-playbooks", orgId, 100).catch(() => []) as Promise<
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
    <div className="space-y-6">
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
                  buttonVariants({ size: "sm", variant: "outline" })
                )}
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
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" })
                )}
                href="/module/automations?tab=visual-builder"
              >
                {isEn ? "Visual Builder" : "Constructor Visual"}
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

      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">AI</Badge>
            <CardTitle className="text-lg">
              {isEn ? "Agent Playbooks" : "Playbooks de Agentes"}
            </CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? "Multi-step agent workflows with trigger conditions, step sequences, and execution tracking."
              : "Flujos de trabajo multi-paso con condiciones de disparo, secuencias de pasos y seguimiento de ejecución."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <PlaybookBuilder playbooks={playbooks} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
