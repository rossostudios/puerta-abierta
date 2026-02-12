import {
  ArrowRight01Icon,
  CalendarCheckIn01Icon,
  ChartIcon,
  File01Icon,
  Home01Icon,
  Invoice01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { DashboardInsights } from "@/components/dashboard/insights";
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
import { Icon } from "@/components/ui/icon";
import { StatCard } from "@/components/ui/stat-card";
import { TableCard } from "@/components/ui/table-card";
import {
  fetchList,
  fetchMe,
  fetchOperationsSummary,
  fetchOwnerSummary,
  getApiBaseUrl,
  type OperationsSummary,
} from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { getModuleDescription, getModuleLabel, MODULES } from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

function numberOrZero(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countByStatus(
  rows: unknown[],
  preferredOrder: string[] = []
): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      counts.set("unknown", (counts.get("unknown") ?? 0) + 1);
      continue;
    }
    const status = (row as Record<string, unknown>).status;
    const key =
      typeof status === "string" && status.trim() ? status.trim() : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const items = Array.from(counts.entries()).map(([status, count]) => ({
    status,
    count,
  }));
  if (!preferredOrder.length) return items;

  const rank = new Map(preferredOrder.map((key, index) => [key, index]));
  return items.sort((a, b) => {
    const aRank = rank.has(a.status) ? (rank.get(a.status) as number) : 10_000;
    const bRank = rank.has(b.status) ? (rank.get(b.status) as number) : 10_000;
    if (aRank !== bRank) return aRank - bRank;
    return a.status.localeCompare(b.status);
  });
}

type DashboardRole = "owner_admin" | "operator" | "accountant" | "viewer";

type QuickAction = {
  href: string;
  labelEn: string;
  labelEs: string;
  variant: "default" | "outline" | "secondary";
};

function normalizedRole(value: unknown): DashboardRole {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (role === "owner_admin") return "owner_admin";
  if (role === "operator") return "operator";
  if (role === "accountant") return "accountant";
  return "viewer";
}

function roleQuickActions(role: DashboardRole): QuickAction[] {
  if (role === "operator") {
    return [
      {
        href: "/module/tasks",
        labelEn: "Create task",
        labelEs: "Crear tarea",
        variant: "default",
      },
      {
        href: "/module/reservations",
        labelEn: "Check today check-outs",
        labelEs: "Ver check-outs de hoy",
        variant: "outline",
      },
      {
        href: "/module/applications",
        labelEn: "Open applications board",
        labelEs: "Abrir tablero de aplicaciones",
        variant: "outline",
      },
    ];
  }

  if (role === "owner_admin") {
    return [
      {
        href: "/module/owner-statements",
        labelEn: "Review statements",
        labelEs: "Revisar estados",
        variant: "default",
      },
      {
        href: "/module/collections",
        labelEn: "View collections",
        labelEs: "Ver cobranzas",
        variant: "outline",
      },
      {
        href: "/module/marketplace-listings",
        labelEn: "Publish listing",
        labelEs: "Publicar anuncio",
        variant: "outline",
      },
    ];
  }

  if (role === "accountant") {
    return [
      {
        href: "/module/expenses",
        labelEn: "Add expense",
        labelEs: "Agregar gasto",
        variant: "default",
      },
      {
        href: "/module/owner-statements",
        labelEn: "Reconcile statement",
        labelEs: "Conciliar estado",
        variant: "outline",
      },
      {
        href: "/module/reports",
        labelEn: "Export summary",
        labelEs: "Exportar resumen",
        variant: "outline",
      },
    ];
  }

  return [
    {
      href: "/module/reports",
      labelEn: "Open reports",
      labelEs: "Abrir reportes",
      variant: "default",
    },
    {
      href: "/module/reservations",
      labelEn: "View reservations",
      labelEs: "Ver reservas",
      variant: "outline",
    },
    {
      href: "/module/tasks",
      labelEn: "Open tasks",
      labelEs: "Abrir tareas",
      variant: "outline",
    },
  ];
}

function roleLabel(role: DashboardRole, isEn: boolean): string {
  if (role === "owner_admin") {
    return isEn ? "Owner admin" : "Administrador";
  }
  if (role === "operator") {
    return isEn ? "Operator" : "Operador";
  }
  if (role === "accountant") {
    return isEn ? "Accountant" : "Finanzas";
  }
  return isEn ? "Viewer" : "Visualizador";
}

async function safeList(path: string, orgId: string): Promise<unknown[]> {
  try {
    return await fetchList(path, orgId, 25);
  } catch {
    return [];
  }
}

async function safeReport(
  path: string,
  orgId: string
): Promise<Record<string, unknown>> {
  try {
    return await fetchOwnerSummary(path, orgId);
  } catch {
    return {};
  }
}

async function safeOperationsSummary(
  orgId: string
): Promise<OperationsSummary> {
  try {
    return await fetchOperationsSummary(orgId);
  } catch {
    return {};
  }
}

async function safeMe(): Promise<Record<string, unknown>> {
  try {
    return (await fetchMe()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default async function DashboardPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

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
              ? "Select an organization to load portfolio data."
              : "Selecciona una organización para cargar los datos del portafolio."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {isEn ? (
            <>
              Open <code className="rounded bg-muted px-1 py-0.5">Setup</code>{" "}
              to create your first organization, or use the organization
              switcher in the top bar.
            </>
          ) : (
            <>
              Abre{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                Configuración
              </code>{" "}
              para crear tu primera organización, o usa el selector de
              organización en la barra superior.
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  let orgAccessError: string | null = null;
  let properties: unknown[] = [];
  let reservations: unknown[] = [];
  let tasks: unknown[] = [];
  let units: unknown[] = [];
  let applications: unknown[] = [];
  let collections: unknown[] = [];
  let marketplaceListings: unknown[] = [];
  let opsAlerts: unknown[] = [];
  let summary: Record<string, unknown> = {};
  let operationsSummary: OperationsSummary = {};
  let mePayload: Record<string, unknown> = {};
  let apiAvailable = true;

  try {
    await fetchList("/organizations", orgId, 1);
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }
    apiAvailable = false;
    orgAccessError = message;
  }

  if (apiAvailable) {
    try {
      const [
        props,
        resas,
        taskRows,
        unitRows,
        appRows,
        collectionRows,
        marketplaceRows,
        alertRows,
        summ,
        opsSummary,
        me,
      ] = await Promise.all([
        safeList("/properties", orgId),
        safeList("/reservations", orgId),
        safeList("/tasks", orgId),
        safeList("/units", orgId),
        safeList("/applications", orgId),
        safeList("/collections", orgId),
        safeList("/marketplace/listings", orgId),
        safeList("/integration-events", orgId),
        safeReport("/reports/summary", orgId),
        safeOperationsSummary(orgId),
        safeMe(),
      ]);

      properties = props;
      reservations = resas;
      tasks = taskRows;
      units = unitRows;
      applications = appRows;
      collections = collectionRows;
      marketplaceListings = marketplaceRows;
      opsAlerts = (alertRows as Record<string, unknown>[]).filter(
        (row) =>
          String(row.provider ?? "")
            .trim()
            .toLowerCase() === "alerting" &&
          String(row.status ?? "")
            .trim()
            .toLowerCase() === "failed"
      );
      summary = summ;
      operationsSummary = opsSummary;
      mePayload = me;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      apiAvailable = false;
      orgAccessError = message;
    }
  }

  const memberships = Array.isArray(mePayload.memberships)
    ? (mePayload.memberships as Record<string, unknown>[])
    : [];
  const activeMembership =
    memberships.find((membership) => membership.organization_id === orgId) ??
    null;
  const activeRole = normalizedRole(activeMembership?.role);
  const quickActions = roleQuickActions(activeRole);
  const activeRoleLabel = roleLabel(activeRole, isEn);

  const reportNet = formatCurrency(
    numberOrZero(summary.net_payout),
    "PYG",
    locale
  );
  const reportGross = formatCurrency(
    numberOrZero(summary.gross_revenue),
    "PYG",
    locale
  );
  const occupancyRate =
    typeof summary.occupancy_rate === "number"
      ? `${(summary.occupancy_rate * 100).toFixed(1)}%`
      : "0%";

  const revenueSnapshot = apiAvailable
    ? {
        periodLabel: isEn ? "This month" : "Este mes",
        currency: "PYG",
        gross: numberOrZero(summary.gross_revenue),
        expenses: numberOrZero(summary.expenses),
        net: numberOrZero(summary.net_payout),
      }
    : null;

  const taskStatuses = countByStatus(tasks as unknown[], [
    "todo",
    "in_progress",
    "done",
    "cancelled",
    "unknown",
  ]);

  const qualifiedLikeStatuses = new Set([
    "qualified",
    "visit_scheduled",
    "offer_sent",
    "contract_signed",
  ]);
  const qualifiedApplications = (
    applications as Record<string, unknown>[]
  ).filter((row) => qualifiedLikeStatuses.has(String(row.status ?? ""))).length;

  const paidCollections = (collections as Record<string, unknown>[]).filter(
    (row) => String(row.status ?? "") === "paid"
  ).length;
  const collectionRate =
    collections.length > 0
      ? `${((paidCollections / collections.length) * 100).toFixed(1)}%`
      : "0%";

  const publishedListings = (
    marketplaceListings as Record<string, unknown>[]
  ).filter((row) => Boolean(row.is_published));
  const transparentListings = publishedListings.filter((row) =>
    Boolean(row.fee_breakdown_complete)
  ).length;
  const transparentListingsPct =
    publishedListings.length > 0
      ? `${((transparentListings / publishedListings.length) * 100).toFixed(1)}%`
      : "0%";

  const operationsKpis = {
    turnoversDue: numberOrZero(operationsSummary.turnovers_due),
    turnoversOnTime: numberOrZero(
      operationsSummary.turnovers_completed_on_time
    ),
    turnoverOnTimeRate: numberOrZero(operationsSummary.turnover_on_time_rate),
    openTasks: numberOrZero(operationsSummary.open_tasks),
    overdueTasks: numberOrZero(operationsSummary.overdue_tasks),
    slaBreachedTasks: numberOrZero(operationsSummary.sla_breached_tasks),
    upcomingCheckIns: numberOrZero(
      operationsSummary.reservations_upcoming_check_in
    ),
    upcomingCheckOuts: numberOrZero(
      operationsSummary.reservations_upcoming_check_out
    ),
  };

  const unassignedApplications = (
    applications as Record<string, unknown>[]
  ).filter((row) => !row.assigned_user_id).length;

  const opsAlertsCards = [
    operationsKpis.slaBreachedTasks > 0
      ? {
          key: "sla-breaches",
          variant: "destructive" as const,
          title: isEn
            ? "SLA breaches detected"
            : "Incumplimientos SLA detectados",
          description: isEn
            ? `${operationsKpis.slaBreachedTasks} tasks crossed SLA targets.`
            : `${operationsKpis.slaBreachedTasks} tareas excedieron el SLA.`,
        }
      : null,
    operationsKpis.overdueTasks > 0
      ? {
          key: "overdue-turnovers",
          variant: "warning" as const,
          title: isEn
            ? "Overdue operations tasks"
            : "Tareas operativas vencidas",
          description: isEn
            ? `${operationsKpis.overdueTasks} open tasks are overdue.`
            : `${operationsKpis.overdueTasks} tareas abiertas están vencidas.`,
        }
      : null,
    unassignedApplications > 0
      ? {
          key: "assignment-gaps",
          variant: "info" as const,
          title: isEn ? "Assignment gaps" : "Brechas de asignación",
          description: isEn
            ? `${unassignedApplications} applications are still unassigned.`
            : `${unassignedApplications} aplicaciones siguen sin responsable.`,
        }
      : null,
    opsAlerts.length > 0
      ? {
          key: "integration-alerts",
          variant: "warning" as const,
          title: isEn ? "Integration alerts" : "Alertas de integración",
          description: isEn
            ? `${opsAlerts.length} failed alert events need review.`
            : `${opsAlerts.length} eventos fallidos requieren revisión.`,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    variant: "destructive" | "warning" | "info";
    title: string;
    description: string;
  }>;

  const roleKpis =
    activeRole === "operator"
      ? [
          {
            label: isEn ? "Upcoming check-ins" : "Check-ins próximos",
            value: String(operationsKpis.upcomingCheckIns),
            helper: isEn ? "Next 7 days" : "Próximos 7 días",
            icon: CalendarCheckIn01Icon,
          },
          {
            label: isEn ? "Upcoming check-outs" : "Check-outs próximos",
            value: String(operationsKpis.upcomingCheckOuts),
            helper: isEn ? "Next 7 days" : "Próximos 7 días",
            icon: CalendarCheckIn01Icon,
          },
          {
            label: isEn ? "Turnover on-time rate" : "Turnovers a tiempo",
            value: `${(operationsKpis.turnoverOnTimeRate * 100).toFixed(1)}%`,
            helper: `${operationsKpis.turnoversOnTime}/${operationsKpis.turnoversDue}`,
            icon: Task01Icon,
          },
        ]
      : activeRole === "owner_admin"
        ? [
            {
              label: isEn ? "Portfolio occupancy" : "Ocupación portafolio",
              value: occupancyRate,
              helper: isEn ? "Current period" : "Periodo actual",
              icon: Home01Icon,
            },
            {
              label: isEn ? "Collections paid" : "Cobranzas pagadas",
              value: collectionRate,
              helper: `${paidCollections}/${collections.length}`,
              icon: Invoice01Icon,
            },
            {
              label: isEn ? "Transparent listings" : "Anuncios transparentes",
              value: transparentListingsPct,
              helper: `${transparentListings}/${publishedListings.length}`,
              icon: ChartIcon,
            },
          ]
        : activeRole === "accountant"
          ? [
              {
                label: isEn ? "Net payout" : "Pago neto",
                value: reportNet,
                helper: isEn ? "Current period" : "Periodo actual",
                icon: Invoice01Icon,
              },
              {
                label: isEn ? "Gross revenue" : "Ingresos brutos",
                value: reportGross,
                helper: isEn ? "Current period" : "Periodo actual",
                icon: ChartIcon,
              },
              {
                label: isEn ? "SLA breached tasks" : "Tareas SLA vencido",
                value: String(operationsKpis.slaBreachedTasks),
                helper: isEn ? "Ops risk signal" : "Señal de riesgo operativo",
                icon: Task01Icon,
              },
            ]
          : [
              {
                label: isEn ? "Properties" : "Propiedades",
                value: String(properties.length),
                helper: isEn ? "Portfolio scope" : "Alcance de portafolio",
                icon: Home01Icon,
              },
              {
                label: isEn ? "Open tasks" : "Tareas abiertas",
                value: String(operationsKpis.openTasks),
                helper: isEn ? "Current queue" : "Cola actual",
                icon: Task01Icon,
              },
              {
                label: isEn
                  ? "Qualified applications"
                  : "Aplicaciones calificadas",
                value: String(qualifiedApplications),
                helper: isEn ? "Leasing pipeline" : "Pipeline de leasing",
                icon: File01Icon,
              },
            ];

  return (
    <div className="space-y-5">
      {/* ── Page header ─────────────────────────────────────── */}
      <header className="flex flex-col gap-4 rounded-3xl border border-border/80 bg-card/98 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-semibold text-[2rem] tracking-[-0.02em]">
            {isEn ? "Operations" : "Operaciones"}
          </h1>
          <p className="text-muted-foreground/90 text-sm">
            {isEn ? "Active workspace · " : "Espacio activo · "}
            <span className="capitalize">
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date())}
            </span>
          </p>
          <p className="mt-1 text-muted-foreground/80 text-xs uppercase tracking-[0.13em]">
            {isEn ? "Role view" : "Vista por rol"}: {activeRoleLabel}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {quickActions.map((action, index) => (
            <Link
              className={cn(
                buttonVariants({ variant: action.variant, size: "sm" })
              )}
              href={action.href}
              key={action.href}
            >
              {isEn ? action.labelEn : action.labelEs}
              {index === 0 ? <Icon icon={ArrowRight01Icon} size={14} /> : null}
            </Link>
          ))}
        </div>
      </header>

      {/* ── Compact API alert ───────────────────────────────── */}
      {apiAvailable ? null : (
        <Alert aria-live="polite" variant="warning">
          <AlertTitle>
            {isEn
              ? "Can't reach the backend — metrics may be stale."
              : "No se puede conectar al backend — los datos podrían estar desactualizados."}
          </AlertTitle>
          <AlertDescription className="space-y-1.5">
            <p>
              {isEn ? "Expected at" : "Esperado en"}{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {getApiBaseUrl()}
              </code>
            </p>
            {orgAccessError ? (
              <p className="break-words text-xs opacity-80">{orgAccessError}</p>
            ) : null}
            <p className="text-xs opacity-80">
              {isEn ? (
                <>
                  Run{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    cd apps/backend && npm start
                  </code>{" "}
                  then refresh this page.
                </>
              ) : (
                <>
                  Ejecuta{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    cd apps/backend && npm start
                  </code>{" "}
                  y luego actualiza esta página.
                </>
              )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {opsAlertsCards.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2">
          {opsAlertsCards.map((item) => (
            <Alert key={item.key} variant={item.variant}>
              <AlertTitle>{item.title}</AlertTitle>
              <AlertDescription>{item.description}</AlertDescription>
            </Alert>
          ))}
        </section>
      ) : (
        <Alert variant="success">
          <AlertTitle>
            {isEn
              ? "Operations alert center is clean"
              : "Sin alertas operativas"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "No SLA breaches, overdue turnover tasks, or assignment gaps detected right now."
              : "No se detectan incumplimientos SLA, vencimientos ni brechas de asignación en este momento."}
          </AlertDescription>
        </Alert>
      )}

      <GettingStarted
        applicationCount={applications.length}
        collectionCount={collections.length}
        locale={locale}
        propertyCount={properties.length}
        reservationCount={reservations.length}
        role={activeRole}
        unitCount={units.length}
      />

      <section
        aria-label={isEn ? "Role control center" : "Centro de control por rol"}
        className="rounded-3xl border border-border/80 bg-card/98 p-4 sm:p-5"
      >
        <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          {isEn ? "Role control center" : "Centro de control por rol"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roleKpis.map((item) => (
            <StatCard
              helper={item.helper}
              icon={item.icon}
              key={item.label}
              label={item.label}
              value={item.value}
            />
          ))}
        </div>
      </section>

      {/* ── KPI stats ───────────────────────────────────────── */}
      <section
        aria-label={isEn ? "Key metrics" : "Métricas clave"}
        className="rounded-3xl border border-border/80 bg-card/98 p-4 sm:p-5"
      >
        <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          {isEn ? "Operations" : "Operaciones"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            helper={isEn ? "Listed so far" : "Registradas hasta ahora"}
            icon={Home01Icon}
            label={isEn ? "Properties" : "Propiedades"}
            value={String(properties.length)}
          />
          <StatCard
            helper={
              isEn ? "Check-ins next 7 days" : "Check-ins próximos 7 días"
            }
            icon={CalendarCheckIn01Icon}
            label={isEn ? "Upcoming check-ins" : "Check-ins próximos"}
            value={String(operationsKpis.upcomingCheckIns)}
          />
          <StatCard
            helper={`${isEn ? "Overdue" : "Vencidas"} ${operationsKpis.overdueTasks} · ${isEn ? "SLA" : "SLA"} ${operationsKpis.slaBreachedTasks}`}
            icon={Task01Icon}
            label={isEn ? "Open tasks" : "Tareas abiertas"}
            value={String(operationsKpis.openTasks)}
          />
        </div>
      </section>

      {/* ── Finance stats ───────────────────────────────────── */}
      <section
        aria-label={isEn ? "Financial overview" : "Resumen financiero"}
        className="rounded-3xl border border-border/80 bg-card/98 p-4 sm:p-5"
      >
        <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          {isEn ? "Finance" : "Finanzas"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            helper={isEn ? "Generated this period" : "Generados este período"}
            icon={File01Icon}
            label={isEn ? "Portfolio" : "Portafolio"}
            value={String(properties.length)}
          />
          <StatCard
            helper={isEn ? "Monthly snapshot" : "Resumen del mes"}
            icon={ChartIcon}
            label={isEn ? "Gross revenue" : "Ingresos brutos"}
            value={reportGross}
          />
          <StatCard
            helper={`${isEn ? "Occupancy" : "Ocupación"} ${occupancyRate}`}
            icon={Invoice01Icon}
            label={isEn ? "Net payout" : "Pago neto"}
            value={reportNet}
          />
        </div>
      </section>

      <section
        aria-label={isEn ? "Leasing metrics" : "Métricas de arriendos"}
        className="rounded-3xl border border-border/80 bg-card/98 p-4 sm:p-5"
      >
        <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          {isEn ? "Leasing pipeline" : "Pipeline de arriendos"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            helper={isEn ? "Current cycle" : "Ciclo actual"}
            icon={File01Icon}
            label={isEn ? "Qualified applications" : "Aplicaciones calificadas"}
            value={String(qualifiedApplications)}
          />
          <StatCard
            helper={`${paidCollections}/${collections.length}`}
            icon={Invoice01Icon}
            label={
              isEn ? "Lease collection rate" : "Tasa de cobro de contratos"
            }
            value={collectionRate}
          />
          <StatCard
            helper={`${transparentListings}/${publishedListings.length}`}
            icon={ChartIcon}
            label={isEn ? "Transparent listings %" : "Anuncios transparentes %"}
            value={transparentListingsPct}
          />
        </div>
      </section>

      {/* ── Insights charts ─────────────────────────────────── */}
      <DashboardInsights
        locale={locale}
        operationsSummary={{
          turnoversDue: operationsKpis.turnoversDue,
          turnoversOnTime: operationsKpis.turnoversOnTime,
          turnoverOnTimeRate: operationsKpis.turnoverOnTimeRate,
          overdueTasks: operationsKpis.overdueTasks,
          slaBreachedTasks: operationsKpis.slaBreachedTasks,
        }}
        revenue={revenueSnapshot}
        taskStatuses={taskStatuses}
      />

      {/* ── Reservations table ──────────────────────────────── */}
      <TableCard
        rowHrefBase="/module/reservations"
        rows={(reservations as Record<string, unknown>[]).slice(0, 20)}
        subtitle={isEn ? "Operations feed" : "Feed operativo"}
        title={isEn ? "Reservations summary" : "Resumen de reservas"}
      />

      {/* ── Module cards (mobile only) ──────────────────────── */}
      <section className="grid gap-4 md:grid-cols-2 lg:hidden xl:grid-cols-3">
        {MODULES.map((module) => {
          const label = getModuleLabel(module, locale);
          const description = getModuleDescription(module, locale);

          return (
            <Card key={module.slug}>
              <CardHeader className="space-y-2">
                <Badge className="w-fit" variant="secondary">
                  {isEn ? "Module" : "Módulo"}
                </Badge>
                <CardTitle className="text-lg">{label}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href={`/module/${module.slug}`}
                >
                  {isEn ? "Open module" : "Abrir módulo"}
                  <Icon icon={ArrowRight01Icon} size={14} />
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
