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
import { isRentalMode, type RentalMode } from "@/app/(admin)/setup/setup-components";
import { GettingStartedChecklist } from "@/components/dashboard/getting-started-checklist";
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
  fetchKpiDashboard,
  fetchList,
  fetchMe,
  fetchOperationsSummary,
  fetchOwnerSummary,
  type KpiDashboard,
  type OperationsSummary,
} from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { getModuleDescription, getModuleLabel, MODULES } from "@/lib/modules";
import { getChecklistItems } from "@/lib/onboarding-checklist";
import { getActiveOrgId } from "@/lib/org";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  detailEn: string;
  detailEs: string;
  icon: typeof Home01Icon;
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
        labelEn: "Plan today",
        labelEs: "Planificar hoy",
        detailEn: "Create and assign high-priority tasks.",
        detailEs: "Crea y asigna tareas de prioridad alta.",
        icon: Task01Icon,
      },
      {
        href: "/module/reservations",
        labelEn: "Check arrivals",
        labelEs: "Ver llegadas",
        detailEn: "Review check-ins and check-outs for this week.",
        detailEs: "Revisa check-ins y check-outs de la semana.",
        icon: CalendarCheckIn01Icon,
      },
      {
        href: "/module/applications",
        labelEn: "Review applications",
        labelEs: "Revisar aplicaciones",
        detailEn: "Process new applicants and next actions.",
        detailEs: "Procesa postulantes y siguientes acciones.",
        icon: File01Icon,
      },
    ];
  }

  if (role === "owner_admin") {
    return [
      {
        href: "/module/owner-statements",
        labelEn: "Owner payouts",
        labelEs: "Pagos a propietarios",
        detailEn: "Track statements and reconciliation deltas.",
        detailEs: "Revisa estados y diferencias de conciliacion.",
        icon: Invoice01Icon,
      },
      {
        href: "/module/collections",
        labelEn: "Collections",
        labelEs: "Cobranzas",
        detailEn: "Monitor paid, pending, and overdue collections.",
        detailEs: "Monitorea cobranzas pagadas, pendientes y vencidas.",
        icon: ChartIcon,
      },
      {
        href: "/module/listings",
        labelEn: "Marketplace quality",
        labelEs: "Calidad de anuncios",
        detailEn: "Publish complete listings with transparent pricing.",
        detailEs: "Publica anuncios completos con precios transparentes.",
        icon: Home01Icon,
      },
    ];
  }

  if (role === "accountant") {
    return [
      {
        href: "/module/expenses",
        labelEn: "Record expenses",
        labelEs: "Registrar gastos",
        detailEn: "Capture operating costs for this period.",
        detailEs: "Registra costos operativos del periodo.",
        icon: Invoice01Icon,
      },
      {
        href: "/module/owner-statements",
        labelEn: "Reconcile statements",
        labelEs: "Conciliar estados",
        detailEn: "Validate lease/collection line-item consistency.",
        detailEs: "Valida consistencia de line items y cobranzas.",
        icon: File01Icon,
      },
      {
        href: "/module/reports",
        labelEn: "Reporting hub",
        labelEs: "Centro de reportes",
        detailEn: "Export financial and operations summaries.",
        detailEs: "Exporta resumenes financieros y operativos.",
        icon: ChartIcon,
      },
    ];
  }

  return [
    {
      href: "/module/reports",
      labelEn: "Portfolio performance",
      labelEs: "Rendimiento del portafolio",
      detailEn: "Review revenue, occupancy, and net payout.",
      detailEs: "Revisa ingresos, ocupacion y pago neto.",
      icon: ChartIcon,
    },
    {
      href: "/module/reservations",
      labelEn: "Upcoming stays",
      labelEs: "Proximas estadias",
      detailEn: "Track upcoming check-ins and check-outs.",
      detailEs: "Sigue check-ins y check-outs proximos.",
      icon: CalendarCheckIn01Icon,
    },
    {
      href: "/module/tasks",
      labelEn: "Operations risks",
      labelEs: "Riesgos operativos",
      detailEn: "See overdue tasks and SLA risk signals.",
      detailEs: "Visualiza tareas vencidas y senales de riesgo SLA.",
      icon: Task01Icon,
    },
  ];
}

function normalizePersonLabel(raw: string): string {
  const cleaned = raw
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return raw;
  return cleaned.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function firstName(value: string): string {
  const normalized = normalizePersonLabel(value);
  if (!normalized) return "";
  const [first] = normalized.split(" ");
  return first || normalized;
}

function userDisplayName(
  mePayload: Record<string, unknown>,
  authUser: Record<string, unknown>
): string {
  const user =
    mePayload.user && typeof mePayload.user === "object"
      ? (mePayload.user as Record<string, unknown>)
      : null;
  const authMetadata =
    authUser.user_metadata && typeof authUser.user_metadata === "object"
      ? (authUser.user_metadata as Record<string, unknown>)
      : null;
  const candidates = [
    user?.full_name,
    user?.name,
    user?.display_name,
    mePayload.full_name,
    mePayload.name,
    mePayload.display_name,
    authMetadata?.full_name,
    authMetadata?.name,
    authMetadata?.display_name,
    authUser.full_name,
    user?.email,
    authUser.email,
    mePayload.email,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    return firstName(candidate.trim());
  }
  return "";
}

function roleGreeting(locale: string, isEn: boolean): string {
  const hourText = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  const hour = Number.parseInt(hourText, 10);

  if (Number.isNaN(hour)) {
    return isEn ? "Welcome back" : "Bienvenido de nuevo";
  }
  if (hour < 12) {
    return isEn ? "Good morning" : "Buenos dias";
  }
  if (hour < 18) {
    return isEn ? "Good afternoon" : "Buenas tardes";
  }
  return isEn ? "Good evening" : "Buenas noches";
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

async function safeAuthUser(): Promise<Record<string, unknown>> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? (user as unknown as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type NeedsAttentionItem = {
  key: string;
  labelEn: string;
  labelEs: string;
  href: string;
  ctaEn: string;
  ctaEs: string;
  priority: number;
};

type DashboardPageProps = {
  searchParams: Promise<{ onboarding?: string }>;
};

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
              : "Falta contexto de organizacion"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to load portfolio data."
              : "Selecciona una organizacion para cargar los datos del portafolio."}
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
              para crear tu primera organizacion, o usa el selector de
              organizacion en la barra superior.
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  let properties: unknown[] = [];
  let reservations: unknown[] = [];
  let tasks: unknown[] = [];
  let applications: unknown[] = [];
  let collections: unknown[] = [];
  let listings: unknown[] = [];
  let integrations: unknown[] = [];
  let pricing: unknown[] = [];
  let expenses: unknown[] = [];
  let leases: unknown[] = [];
  let opsAlerts: unknown[] = [];
  let summary: Record<string, unknown> = {};
  let operationsSummary: OperationsSummary = {};
  let kpiDashboard: KpiDashboard = {};
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
        resas,
        taskRows,
        appRows,
        collectionRows,
        listingRows,
        integrationRows,
        pricingRows,
        expenseRows,
        leaseRows,
        alertRows,
        summ,
        opsSummary,
        me,
        orgRows,
        kpiData,
      ] = await Promise.all([
        safeList("/properties", orgId),
        safeList("/reservations", orgId),
        safeList("/tasks", orgId),
        safeList("/applications", orgId),
        safeList("/collections", orgId),
        safeList("/listings", orgId),
        safeList("/integrations", orgId),
        safeList("/pricing-templates", orgId),
        safeList("/expenses", orgId),
        safeList("/leases", orgId),
        safeList("/integration-events", orgId),
        safeReport("/reports/summary", orgId),
        safeOperationsSummary(orgId),
        safeMe(),
        safeList("/organizations", orgId),
        fetchKpiDashboard(orgId).catch(() => ({}) as KpiDashboard),
      ] as const);

      properties = props;
      reservations = resas;
      tasks = taskRows;
      applications = appRows;
      collections = collectionRows;
      listings = listingRows;
      integrations = integrationRows;
      pricing = pricingRows;
      expenses = expenseRows;
      leases = leaseRows;
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
      kpiDashboard = kpiData;

      // Extract rental_mode from org record
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
  ).filter((row) => String(row.status ?? "").toLowerCase() === "pending").length;

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

  const unassignedApplications = (
    applications as Record<string, unknown>[]
  ).filter((row) => !row.assigned_user_id).length;

  // ── Needs Attention items ────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdueCollections = (collections as Record<string, unknown>[]).filter(
    (row) => {
      const status = String(row.status ?? "").toLowerCase();
      if (status === "paid" || status === "waived") return false;
      const dueDate = String(row.due_date ?? "");
      return dueDate < todayStr && /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
    }
  );

  const draftListingsOld = (listings as Record<string, unknown>[]).filter(
    (row) => {
      if (row.is_published) return false;
      const created = String(row.created_at ?? "").slice(0, 10);
      if (!created || !/^\d{4}-\d{2}-\d{2}$/.test(created)) return false;
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 86_400_000
      ).toISOString().slice(0, 10);
      return created < sevenDaysAgo;
    }
  );

  const expiringLeases = (leases as Record<string, unknown>[]).filter(
    (row) => {
      const status = String(row.lease_status ?? "").toLowerCase();
      if (status !== "active") return false;
      const endsOn = String(row.ends_on ?? "");
      if (!endsOn || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return false;
      const thirtyDaysOut = new Date(
        Date.now() + 30 * 86_400_000
      ).toISOString().slice(0, 10);
      return endsOn <= thirtyDaysOut && endsOn >= todayStr;
    }
  );

  const needsAttention: NeedsAttentionItem[] = [];

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

  if (operationsKpis.slaBreachedTasks > 0) {
    needsAttention.push({
      key: "sla-breaches",
      labelEn: `${operationsKpis.slaBreachedTasks} SLA breach${operationsKpis.slaBreachedTasks > 1 ? "es" : ""}`,
      labelEs: `${operationsKpis.slaBreachedTasks} incumplimiento${operationsKpis.slaBreachedTasks > 1 ? "s" : ""} SLA`,
      href: "/module/tasks",
      ctaEn: "View",
      ctaEs: "Ver",
      priority: 1,
    });
  }

  needsAttention.sort((a, b) => a.priority - b.priority);

  const checklistItems = getChecklistItems(orgRentalMode, {
    integrations: integrations.length,
    reservations: reservations.length,
    tasks: tasks.length,
    expenses: expenses.length,
    pricing: pricing.length,
    listings: listings.length,
    applications: applications.length,
    leases: leases.length,
    collections: collections.length,
  });

  return (
    <div className="space-y-5">
      {/* ── Page header ─────────────────────────────────────── */}
      <header className="flex flex-col gap-4 rounded-3xl border border-border/80 bg-card/98 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-semibold text-[2rem] tracking-[-0.02em]">
            {greetingTitle}
          </h1>
          <p className="text-muted-foreground/90 text-sm">
            {isEn
              ? "Here is your portfolio pulse and what needs attention next."
              : "Aqui tienes el pulso de tu portafolio y lo que requiere atencion ahora."}
          </p>
        </div>

        <div className="grid w-full gap-2 sm:grid-cols-3 md:w-auto md:min-w-[40rem]">
          {quickActions.map((action) => (
            <Link
              className={cn(
                "rounded-2xl border border-border/75 bg-muted/55 px-3 py-2.5 text-left transition-colors hover:bg-muted/80 hover:text-foreground"
              )}
              href={action.href}
              key={action.href}
            >
              <div className="flex items-center gap-2 font-medium text-[13px]">
                <Icon icon={action.icon} size={14} />
                {isEn ? action.labelEn : action.labelEs}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {isEn ? action.detailEn : action.detailEs}
              </p>
            </Link>
          ))}
        </div>
      </header>

      {onboardingCompleted ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn
              ? "Onboarding foundation completed"
              : "Base de onboarding completada"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "Great start. Continue with integrations, listings, and daily operations."
              : "Excelente inicio. Continua con integraciones, anuncios y la operacion diaria."}
          </AlertDescription>
        </Alert>
      ) : null}

      {apiAvailable ? (
        <GettingStartedChecklist items={checklistItems} locale={locale} />
      ) : null}

      {/* ── 1A: Hero metrics ────────────────────────────────── */}
      <section
        aria-label={isEn ? "Key metrics" : "Metricas clave"}
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      >
        <Link href="/module/leases">
          <StatCard
            icon={Home01Icon}
            label={isEn ? "Occupancy rate" : "Tasa de ocupacion"}
            value={occupancyRate}
            helper={
              kpiDashboard.active_leases != null
                ? `${numberOrZero(kpiDashboard.active_leases)}/${numberOrZero(kpiDashboard.total_units)} ${isEn ? "units" : "unidades"}`
                : isEn
                  ? "Current period"
                  : "Periodo actual"
            }
          />
        </Link>
        <Link href="/module/reports/finance">
          <StatCard
            icon={ChartIcon}
            label={isEn ? "Monthly revenue" : "Ingresos mensuales"}
            value={reportGross}
            helper={
              revenueSnapshot
                ? `${isEn ? "Net" : "Neto"}: ${reportNet}`
                : isEn
                  ? "Current month"
                  : "Este mes"
            }
          />
        </Link>
        <Link href="/module/collections">
          <StatCard
            icon={Invoice01Icon}
            label={isEn ? "Collection rate" : "Tasa de cobro"}
            value={collectionRate}
            helper={`${paidCollections}/${collections.length} ${isEn ? "paid" : "pagados"}`}
          />
        </Link>
        <Link href="/module/applications">
          <StatCard
            icon={File01Icon}
            label={isEn ? "Pipeline" : "Pipeline"}
            value={String(qualifiedApplications + pendingApplications)}
            helper={`${qualifiedApplications} ${isEn ? "qualified" : "calificados"} · ${pendingApplications} ${isEn ? "pending" : "pendientes"}`}
          />
        </Link>
      </section>

      {/* ── 1B: Needs Attention ─────────────────────────────── */}
      {needsAttention.length > 0 ? (
        <section className="rounded-3xl border border-border/80 bg-card/98 p-4 sm:p-5">
          <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
            {isEn ? "Needs attention" : "Requiere atencion"}
          </h2>
          <div className="divide-y divide-border/60">
            {needsAttention.map((item) => (
              <div
                className="flex items-center justify-between gap-3 py-2.5"
                key={item.key}
              >
                <p className="text-sm">
                  {isEn ? item.labelEn : item.labelEs}
                </p>
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "shrink-0"
                  )}
                  href={item.href}
                >
                  {isEn ? item.ctaEn : item.ctaEs}
                  <Icon icon={ArrowRight01Icon} size={13} />
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Operations ──────────────────────────────────────── */}
      <section
        aria-label={isEn ? "Operations" : "Operaciones"}
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
              isEn ? "Check-ins next 7 days" : "Check-ins proximos 7 dias"
            }
            icon={CalendarCheckIn01Icon}
            label={isEn ? "Upcoming check-ins" : "Check-ins proximos"}
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

      {/* ── LTR KPIs ──────────────────────────────────────────── */}
      {(orgRentalMode === "ltr" || orgRentalMode === "both") &&
      apiAvailable ? (
        <section
          aria-label={
            isEn ? "Rental performance" : "Rendimiento de alquileres"
          }
          className="rounded-3xl border border-border/80 bg-card/98 p-4 sm:p-5"
        >
          <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
            {isEn ? "Rental performance" : "Rendimiento de alquileres"}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StatCard
              helper={
                isEn
                  ? `${numberOrZero(kpiDashboard.paid_collections)}/${numberOrZero(kpiDashboard.total_collections)} paid`
                  : `${numberOrZero(kpiDashboard.paid_collections)}/${numberOrZero(kpiDashboard.total_collections)} pagadas`
              }
              icon={Invoice01Icon}
              label={isEn ? "Collection rate" : "Tasa de cobro"}
              value={`${(numberOrZero(kpiDashboard.collection_rate) * 100).toFixed(1)}%`}
            />
            <StatCard
              helper={
                isEn
                  ? "Among late payments"
                  : "Entre pagos atrasados"
              }
              icon={CalendarCheckIn01Icon}
              label={isEn ? "Avg days late" : "Promedio dias de atraso"}
              value={`${numberOrZero(kpiDashboard.avg_days_late).toFixed(1)}d`}
            />
            <StatCard
              helper={
                isEn
                  ? `${numberOrZero(kpiDashboard.total_units)} units`
                  : `${numberOrZero(kpiDashboard.total_units)} unidades`
              }
              icon={Home01Icon}
              label={isEn ? "Revenue per unit" : "Ingreso por unidad"}
              value={formatCurrency(
                numberOrZero(kpiDashboard.revenue_per_unit),
                "PYG",
                locale
              )}
            />
            <StatCard
              helper={
                isEn
                  ? `${numberOrZero(kpiDashboard.active_leases)}/${numberOrZero(kpiDashboard.total_units)} occupied`
                  : `${numberOrZero(kpiDashboard.active_leases)}/${numberOrZero(kpiDashboard.total_units)} ocupadas`
              }
              icon={Home01Icon}
              label={isEn ? "Occupancy rate" : "Tasa de ocupacion"}
              value={`${(numberOrZero(kpiDashboard.occupancy_rate) * 100).toFixed(1)}%`}
            />
            <StatCard
              helper={
                kpiDashboard.avg_maintenance_response_hours != null
                  ? isEn
                    ? `Median: ${numberOrZero(kpiDashboard.median_maintenance_response_hours).toFixed(0)}h`
                    : `Mediana: ${numberOrZero(kpiDashboard.median_maintenance_response_hours).toFixed(0)}h`
                  : isEn
                    ? "No data yet"
                    : "Sin datos aun"
              }
              icon={Task01Icon}
              label={
                isEn
                  ? "Maintenance response"
                  : "Respuesta mantenimiento"
              }
              value={
                kpiDashboard.avg_maintenance_response_hours != null
                  ? `${numberOrZero(kpiDashboard.avg_maintenance_response_hours).toFixed(0)}h`
                  : "--"
              }
            />
            <StatCard
              helper={
                isEn ? "Next 60 days" : "Proximos 60 dias"
              }
              icon={File01Icon}
              label={isEn ? "Expiring leases" : "Contratos por vencer"}
              value={String(numberOrZero(kpiDashboard.expiring_leases_60d))}
            />
          </div>
        </section>
      ) : null}

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
                  {isEn ? "Module" : "Modulo"}
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
                  {isEn ? "Open module" : "Abrir modulo"}
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
