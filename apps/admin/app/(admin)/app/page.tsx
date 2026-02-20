import {
  isRentalMode,
  type RentalMode,
} from "@/app/(admin)/setup/setup-components";
import { AnomalyAlerts } from "@/components/dashboard/anomaly-alerts";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import {
  safeAuthUser,
  safeList,
  safeMe,
  safeOperationsSummary,
  safeReport,
} from "@/components/dashboard/dashboard-data";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardHeroMetrics } from "@/components/dashboard/dashboard-hero-metrics";
import { DashboardModuleCards } from "@/components/dashboard/dashboard-module-cards";
import { DashboardNeedsAttention } from "@/components/dashboard/dashboard-needs-attention";
import { DashboardOperations } from "@/components/dashboard/dashboard-operations";
import { roleQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import { DashboardRentalKpis } from "@/components/dashboard/dashboard-rental-kpis";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import {
  countByStatus,
  type NeedsAttentionItem,
  normalizedRole,
  numberOrZero,
  roleGreeting,
  userDisplayName,
} from "@/components/dashboard/dashboard-utils";
import { GettingStartedChecklist } from "@/components/dashboard/getting-started-checklist";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TableCard } from "@/components/ui/table-card";
import {
  type AgentPerformanceStats,
  fetchAgentPerformance,
  fetchKpiDashboard,
  fetchList,
  fetchOccupancyForecast,
  fetchRevenueTrend,
  type KpiDashboard,
  type OccupancyForecastResponse,
  type OperationsSummary,
  type RevenueTrendResponse,
} from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { getChecklistItems } from "@/lib/onboarding-checklist";
import { getActiveOrgId } from "@/lib/org";

type DashboardPageProps = {
  searchParams: Promise<{ onboarding?: string }>;
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const { onboarding } = await searchParams;
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const authUser = await safeAuthUser();
  const onboardingCompleted = onboarding === "completed";

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
              Open{" "}
              <code className="rounded bg-muted px-1 py-0.5">Onboarding</code>{" "}
              to create your first organization, or use the organization
              switcher in the top bar.
            </>
          ) : (
            <>
              Abre{" "}
              <code className="rounded bg-muted px-1 py-0.5">Onboarding</code>{" "}
              para crear tu primera organización, o usa el selector de
              organización en la barra superior.
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  let properties: unknown[] = [];
  let units: unknown[] = [];
  let reservations: unknown[] = [];
  let tasks: unknown[] = [];
  let applications: unknown[] = [];
  let collections: unknown[] = [];
  let listings: unknown[] = [];
  let integrations: unknown[] = [];
  let expenses: unknown[] = [];
  let leases: unknown[] = [];
  let summary: Record<string, unknown> = {};
  let operationsSummary: OperationsSummary = {};
  let kpiDashboard: KpiDashboard = {};
  let forecastData: OccupancyForecastResponse = {
    historical_avg_occupancy_pct: 0,
    total_units: 0,
    months: [],
  };
  let agentPerfData: AgentPerformanceStats | null = null;
  let revenueTrendData: RevenueTrendResponse = { months: [] };
  let mePayload: Record<string, unknown> = {};
  let orgRentalMode: RentalMode = "both";
  let apiAvailable = true;
  try {
    await fetchList("/organizations", orgId, 1);
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }
    apiAvailable = false;
  }

  if (apiAvailable) {
    try {
      const [
        props,
        unitRows,
        resas,
        taskRows,
        appRows,
        collectionRows,
        listingRows,
        integrationRows,
        expenseRows,
        leaseRows,
        summ,
        opsSummary,
        me,
        orgRows,
        kpiData,
        forecastResult,
        agentPerfResult,
        revenueTrendResult,
      ] = await Promise.all([
        safeList("/properties", orgId),
        safeList("/units", orgId),
        safeList("/reservations", orgId),
        safeList("/tasks", orgId),
        safeList("/applications", orgId),
        safeList("/collections", orgId),
        safeList("/listings", orgId),
        safeList("/integrations", orgId),
        safeList("/expenses", orgId),
        safeList("/leases", orgId),
        safeReport("/reports/summary", orgId),
        safeOperationsSummary(orgId),
        safeMe(),
        safeList("/organizations", orgId),
        fetchKpiDashboard(orgId).catch(() => ({}) as KpiDashboard),
        fetchOccupancyForecast(orgId).catch(
          () =>
            ({
              historical_avg_occupancy_pct: 0,
              total_units: 0,
              months: [],
            }) as OccupancyForecastResponse
        ),
        fetchAgentPerformance(orgId).catch(
          () => null as AgentPerformanceStats | null
        ),
        fetchRevenueTrend(orgId).catch(
          () => ({ months: [] }) as RevenueTrendResponse
        ),
      ] as const);

      properties = props;
      units = unitRows;
      reservations = resas;
      tasks = taskRows;
      applications = appRows;
      collections = collectionRows;
      listings = listingRows;
      integrations = integrationRows;
      expenses = expenseRows;
      leases = leaseRows;
      summary = summ;
      operationsSummary = opsSummary;
      mePayload = me;
      kpiDashboard = kpiData;
      forecastData = forecastResult;
      agentPerfData = agentPerfResult;
      revenueTrendData = revenueTrendResult;

      const orgRecord = (orgRows as Record<string, unknown>[]).find(
        (row) => row.id === orgId
      );
      const rawRentalMode = orgRecord?.rental_mode;
      if (isRentalMode(rawRentalMode)) {
        orgRentalMode = rawRentalMode;
      }
    } catch {
      apiAvailable = false;
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
  const greeting = roleGreeting(locale, isEn);
  const displayName = userDisplayName(mePayload, authUser);
  const greetingTitle = displayName ? `${greeting}, ${displayName}` : greeting;

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
      : kpiDashboard.occupancy_rate != null
        ? `${(numberOrZero(kpiDashboard.occupancy_rate) * 100).toFixed(1)}%`
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

  const pendingApplications = (
    applications as Record<string, unknown>[]
  ).filter(
    (row) => String(row.status ?? "").toLowerCase() === "pending"
  ).length;

  const paidCollections = (collections as Record<string, unknown>[]).filter(
    (row) => String(row.status ?? "") === "paid"
  ).length;
  const collectionRate =
    collections.length > 0
      ? `${((paidCollections / collections.length) * 100).toFixed(1)}%`
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

  const needsAttention = buildNeedsAttention(
    collections as Record<string, unknown>[],
    listings as Record<string, unknown>[],
    applications as Record<string, unknown>[],
    leases as Record<string, unknown>[],
    operationsKpis.slaBreachedTasks
  );

  const checklistItems = getChecklistItems(orgRentalMode, {
    properties: properties.length,
    units: units.length,
    channels: integrations.length,
    reservations: reservations.length,
    tasks: tasks.length,
    expenses: expenses.length,
    listings: listings.length,
    applications: applications.length,
    leases: leases.length,
    collections: collections.length,
  });

  return (
    <div className="space-y-5">
      <DashboardHeader
        greetingTitle={greetingTitle}
        isEn={isEn}
        quickActions={quickActions}
        subtitle={
          isEn
            ? "Here is your portfolio pulse and what needs attention next."
            : "Aqui tienes el pulso de tu portafolio y lo que requiere atención ahora."
        }
      />

      {onboardingCompleted ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn
              ? "Onboarding foundation completed"
              : "Base de onboarding completada"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "Great start. Continue with channels, listings, and daily operations."
              : "Excelente inicio. Continúa con canales, anuncios y la operación diaria."}
          </AlertDescription>
        </Alert>
      ) : null}

      {apiAvailable ? (
        <GettingStartedChecklist items={checklistItems} locale={locale} />
      ) : null}

      <DashboardTabs
        financialsContent={
          <>
            {(orgRentalMode === "ltr" || orgRentalMode === "both") &&
            apiAvailable ? (
              <DashboardRentalKpis
                isEn={isEn}
                kpiDashboard={kpiDashboard}
                locale={locale}
              />
            ) : null}

            <DashboardCharts
              agentPerfData={agentPerfData}
              apiAvailable={apiAvailable}
              forecastData={forecastData}
              locale={locale}
              operationsKpis={operationsKpis}
              revenueSnapshot={revenueSnapshot}
              revenueTrendData={revenueTrendData}
              taskStatuses={taskStatuses}
            />
          </>
        }
        isEn={isEn}
        operationsContent={
          <>
            <DashboardOperations
              isEn={isEn}
              operationsKpis={operationsKpis}
              propertiesCount={properties.length}
            />

            <TableCard
              rowHrefBase="/module/reservations"
              rows={(reservations as Record<string, unknown>[]).slice(0, 20)}
              subtitle={isEn ? "Operations feed" : "Feed operativo"}
              title={isEn ? "Reservations summary" : "Resumen de reservas"}
            />
          </>
        }
        overviewContent={
          <>
            <DashboardHeroMetrics
              collectionHelper={`${paidCollections}/${collections.length} ${isEn ? "paid" : "pagados"}`}
              collectionRate={collectionRate}
              isEn={isEn}
              occupancyHelper={
                kpiDashboard.active_leases != null
                  ? `${numberOrZero(kpiDashboard.active_leases)}/${numberOrZero(kpiDashboard.total_units)} ${isEn ? "units" : "unidades"}`
                  : isEn
                    ? "Current period"
                    : "Periodo actual"
              }
              occupancyRate={occupancyRate}
              pipelineHelper={`${qualifiedApplications} ${isEn ? "qualified" : "calificados"} · ${pendingApplications} ${isEn ? "pending" : "pendientes"}`}
              pipelineValue={String(
                qualifiedApplications + pendingApplications
              )}
              reportGross={reportGross}
              revenueHelper={
                revenueSnapshot
                  ? `${isEn ? "Net" : "Neto"}: ${reportNet}`
                  : isEn
                    ? "Current month"
                    : "Este mes"
              }
            />

            {apiAvailable ? (
              <AnomalyAlerts locale={locale} orgId={orgId} />
            ) : null}

            <DashboardNeedsAttention isEn={isEn} items={needsAttention} />

            <DashboardModuleCards isEn={isEn} locale={locale} />
          </>
        }
      />
    </div>
  );
}

function buildNeedsAttention(
  collections: Record<string, unknown>[],
  listings: Record<string, unknown>[],
  applications: Record<string, unknown>[],
  leases: Record<string, unknown>[],
  slaBreachedTasks: number
): NeedsAttentionItem[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const needsAttention: NeedsAttentionItem[] = [];

  const overdueCollections = collections.filter((row) => {
    const status = String(row.status ?? "").toLowerCase();
    if (status === "paid" || status === "waived") return false;
    const dueDate = String(row.due_date ?? "");
    return dueDate < todayStr && ISO_DATE_REGEX.test(dueDate);
  });

  const draftListingsOld = listings.filter((row) => {
    if (row.is_published) return false;
    const created = String(row.created_at ?? "").slice(0, 10);
    if (!(created && ISO_DATE_REGEX.test(created))) return false;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return created < sevenDaysAgo;
  });

  const expiringLeases = leases.filter((row) => {
    const status = String(row.lease_status ?? "").toLowerCase();
    if (status !== "active") return false;
    const endsOn = String(row.ends_on ?? "");
    if (!(endsOn && ISO_DATE_REGEX.test(endsOn))) return false;
    const thirtyDaysOut = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return endsOn <= thirtyDaysOut && endsOn >= todayStr;
  });

  const unassignedApplications = applications.filter(
    (row) => !row.assigned_user_id
  ).length;

  if (overdueCollections.length > 0) {
    needsAttention.push({
      key: "overdue-collections",
      labelEn: `${overdueCollections.length} overdue collection${overdueCollections.length > 1 ? "s" : ""}`,
      labelEs: `${overdueCollections.length} cobro${overdueCollections.length > 1 ? "s" : ""} vencido${overdueCollections.length > 1 ? "s" : ""}`,
      href: "/module/collections",
      ctaEn: "Review",
      ctaEs: "Revisar",
      priority: 1,
    });
  }

  if (draftListingsOld.length > 0) {
    needsAttention.push({
      key: "draft-listings",
      labelEn: `${draftListingsOld.length} draft listing${draftListingsOld.length > 1 ? "s" : ""} never published`,
      labelEs: `${draftListingsOld.length} anuncio${draftListingsOld.length > 1 ? "s" : ""} borrador sin publicar`,
      href: "/module/listings",
      ctaEn: "Publish",
      ctaEs: "Publicar",
      priority: 3,
    });
  }

  if (unassignedApplications > 0) {
    needsAttention.push({
      key: "unassigned-apps",
      labelEn: `${unassignedApplications} unassigned application${unassignedApplications > 1 ? "s" : ""}`,
      labelEs: `${unassignedApplications} aplicacion${unassignedApplications > 1 ? "es" : ""} sin asignar`,
      href: "/module/applications",
      ctaEn: "Assign",
      ctaEs: "Asignar",
      priority: 2,
    });
  }

  if (expiringLeases.length > 0) {
    needsAttention.push({
      key: "expiring-leases",
      labelEn: `${expiringLeases.length} lease${expiringLeases.length > 1 ? "s" : ""} expiring in 30 days`,
      labelEs: `${expiringLeases.length} contrato${expiringLeases.length > 1 ? "s" : ""} por vencer en 30 dias`,
      href: "/module/leases",
      ctaEn: "Review",
      ctaEs: "Revisar",
      priority: 4,
    });
  }

  if (slaBreachedTasks > 0) {
    needsAttention.push({
      key: "sla-breaches",
      labelEn: `${slaBreachedTasks} SLA breach${slaBreachedTasks > 1 ? "es" : ""}`,
      labelEs: `${slaBreachedTasks} incumplimiento${slaBreachedTasks > 1 ? "s" : ""} SLA`,
      href: "/module/operations?tab=tasks",
      ctaEn: "View",
      ctaEs: "Ver",
      priority: 1,
    });
  }

  needsAttention.sort((a, b) => a.priority - b.priority);
  return needsAttention;
}
