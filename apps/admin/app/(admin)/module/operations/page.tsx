import Link from "next/link";
import { Suspense } from "react";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList } from "@/lib/api";
import { getServerCurrentAppUserId } from "@/lib/auth/server-app-user";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { cn } from "@/lib/utils";

import { DispatchDashboard } from "../maintenance/dispatch-dashboard";
import { MaintenanceManager } from "../maintenance/maintenance-manager";
import { SlaConfig } from "../maintenance/sla-config";
import { VendorRoster } from "../maintenance/vendor-roster";
import { TasksManager } from "../tasks/tasks-manager";
import { RiskRadar } from "./risk-radar";

type OperationsTab = "tasks" | "maintenance";

type PageProps = {
  searchParams: Promise<{
    tab?: string;
    mine?: string;
    success?: string;
    error?: string;
  }>;
};

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeTab(value: string | undefined): OperationsTab {
  return value === "maintenance" ? "maintenance" : "tasks";
}

export default async function OperationsHubPage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const params = await searchParams;
  const tab = normalizeTab(params.tab);
  const mineOnly = isTruthy(params.mine);
  const successLabel = params.success
    ? safeDecode(params.success).replaceAll("-", " ")
    : "";
  const errorLabel = params.error ? safeDecode(params.error) : "";

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["operations", "operaciones"]} />;
  }

  if (tab === "tasks") {
    const sessionUserId = await getServerCurrentAppUserId();

    let tasks: Record<string, unknown>[] = [];
    let units: Record<string, unknown>[] = [];

    try {
      const [taskRows, unitRows] = await Promise.all([
        fetchList(
          "/tasks",
          orgId,
          1000,
          mineOnly && sessionUserId
            ? { assigned_user_id: sessionUserId }
            : undefined
        ),
        fetchList("/units", orgId, 500),
      ]);
      tasks = taskRows as Record<string, unknown>[];
      units = unitRows as Record<string, unknown>[];
    } catch (err) {
      const message = errorMessage(err);
      if (isOrgMembershipError(message))
        return <OrgAccessChanged orgId={orgId} />;

      return <ApiErrorCard isEn={isEn} message={message} />;
    }

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {isEn ? "Operations" : "Operaciones"}
                  </Badge>
                  <Badge className="text-[11px]" variant="secondary">
                    {isEn ? "Tasks" : "Tareas"}
                  </Badge>
                </div>
                <CardTitle className="text-2xl">
                  {isEn ? "Operations" : "Operaciones"}
                </CardTitle>
                <CardDescription>
                  {isEn
                    ? "Coordinate tasks and maintenance from one operations workspace."
                    : "Coordina tareas y mantenimiento desde un solo espacio operativo."}
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "secondary" })
                  )}
                  href="/module/operations?tab=tasks"
                >
                  {isEn ? "Tasks" : "Tareas"}
                </Link>
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" })
                  )}
                  href="/module/operations?tab=maintenance"
                >
                  {isEn ? "Maintenance" : "Mantenimiento"}
                </Link>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border bg-muted/20 p-1">
                <Link
                  className={cn(
                    buttonVariants({
                      variant: mineOnly ? "outline" : "secondary",
                      size: "sm",
                    })
                  )}
                  href="/module/operations?tab=tasks"
                >
                  {isEn ? "All tasks" : "Todas"}
                </Link>
                <Link
                  className={cn(
                    buttonVariants({
                      variant: mineOnly ? "secondary" : "outline",
                      size: "sm",
                    })
                  )}
                  href="/module/operations?tab=tasks&mine=1"
                >
                  {isEn ? "My tasks" : "Mis tareas"}
                </Link>
              </div>
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href="/module/calendar"
              >
                {isEn ? "Calendar" : "Calendario"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" })
                )}
                href="/module/reservations"
              >
                {isEn ? "Reservations" : "Reservas"}
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
              <TasksManager
                currentUserId={sessionUserId}
                orgId={orgId}
                tasks={tasks}
                units={units}
              />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    );
  }

  let requests: Record<string, unknown>[] = [];
  let properties: Record<string, unknown>[] = [];
  let members: Record<string, unknown>[] = [];
  let workOrders: Record<string, unknown>[] = [];
  let vendors: Record<string, unknown>[] = [];
  let slaRules: Record<string, unknown>[] = [];
  let mlPredictions: Record<string, unknown>[] = [];
  let demandForecasts: Record<string, unknown>[] = [];

  try {
    const [
      requestRows,
      propertyRows,
      memberRows,
      woRows,
      vendorRows,
      slaRows,
      predRows,
      forecastRows,
    ] = await Promise.all([
      fetchList("/maintenance-requests", orgId, 500),
      fetchList("/properties", orgId, 500),
      fetchList(`/organizations/${orgId}/members`, orgId, 300),
      fetchList("/vendor-work-orders", orgId, 200).catch(() => []) as Promise<
        Record<string, unknown>[]
      >,
      fetchList("/vendor-roster", orgId, 100).catch(() => []) as Promise<
        Record<string, unknown>[]
      >,
      fetchList("/maintenance-sla-config", orgId, 50).catch(
        () => []
      ) as Promise<Record<string, unknown>[]>,
      fetchList("/ml-predictions", orgId, 200).catch(() => []) as Promise<
        Record<string, unknown>[]
      >,
      fetchList("/demand-forecasts", orgId, 200).catch(() => []) as Promise<
        Record<string, unknown>[]
      >,
    ]);
    requests = requestRows as Record<string, unknown>[];
    properties = propertyRows as Record<string, unknown>[];
    members = memberRows as Record<string, unknown>[];
    workOrders = woRows as Record<string, unknown>[];
    vendors = vendorRows as Record<string, unknown>[];
    slaRules = slaRows as Record<string, unknown>[];
    mlPredictions = predRows as Record<string, unknown>[];
    demandForecasts = forecastRows as Record<string, unknown>[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message))
      return <OrgAccessChanged orgId={orgId} />;

    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {isEn ? "Operations" : "Operaciones"}
                </Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Maintenance" : "Mantenimiento"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Operations" : "Operaciones"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Coordinate tasks and maintenance from one operations workspace."
                  : "Coordina tareas y mantenimiento desde un solo espacio operativo."}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" })
                )}
                href="/module/operations?tab=tasks"
              >
                {isEn ? "Tasks" : "Tareas"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "secondary" })
                )}
                href="/module/operations?tab=maintenance"
              >
                {isEn ? "Maintenance" : "Mantenimiento"}
              </Link>
            </div>
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

          <MaintenanceManager
            members={members}
            properties={properties}
            requests={requests}
          />
        </CardContent>
      </Card>

      {/* Dispatch Dashboard */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{isEn ? "Sprint 4" : "Sprint 4"}</Badge>
            <Badge className="text-[11px]" variant="secondary">
              {isEn ? "Dispatch" : "Despacho"}
            </Badge>
          </div>
          <CardTitle>
            {isEn
              ? "Vendor Dispatch Dashboard"
              : "Panel de Despacho de Proveedores"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Active work orders, SLA tracking, and vendor assignments."
              : "Órdenes de trabajo activas, seguimiento SLA y asignaciones de proveedores."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <DispatchDashboard
              requests={requests}
              vendors={vendors}
              workOrders={workOrders}
            />
          </Suspense>
        </CardContent>
      </Card>

      {/* Vendor Roster */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Vendor Roster" : "Listado de Proveedores"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Manage vendors, view performance metrics, and track capacity."
              : "Gestiona proveedores, métricas de rendimiento y capacidad."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VendorRoster vendors={vendors} />
        </CardContent>
      </Card>

      {/* SLA Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "SLA Configuration" : "Configuración SLA"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Response and resolution deadlines per urgency level with auto-escalation."
              : "Plazos de respuesta y resolución por nivel de urgencia con auto-escalación."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SlaConfig slaRules={slaRules} />
        </CardContent>
      </Card>

      {/* Risk Radar & Predictive Intelligence */}
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">ML</Badge>
            <CardTitle className="text-lg">
              {isEn ? "Predictive Intelligence" : "Inteligencia Predictiva"}
            </CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? "ML predictions, demand forecasts, and aggregated risk analysis across all categories."
              : "Predicciones ML, pronósticos de demanda y análisis de riesgo agregado en todas las categorías."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <RiskRadar
              forecasts={demandForecasts}
              predictions={mlPredictions}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
