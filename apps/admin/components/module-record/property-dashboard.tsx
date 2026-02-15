import {
  ArrowLeft01Icon,
  Building03Icon,
  Calendar02Icon,
  ChartIcon,
  Door01Icon,
  Invoice01Icon,
  Task01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { PinButton } from "@/components/shell/pin-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import type { PropertyOverviewData } from "@/lib/features/module-record/property-overview";
import { asString, isUuid, toNumber } from "@/lib/features/module-record/utils";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PropertyDashboard({
  propertyOverview,
  title,
  recordId,
  moduleLabel,
  moduleDescription,
  moduleDef,
  href,
  propertyCodeLabel,
  propertyLocationLabel,
  isEn,
  locale,
}: {
  propertyOverview: PropertyOverviewData;
  title: string;
  recordId: string;
  moduleLabel: string;
  moduleDescription: string;
  moduleDef: { slug: string };
  href: string;
  propertyCodeLabel: string | null;
  propertyLocationLabel: string;
  isEn: boolean;
  locale: "en-US" | "es-PY";
}) {
  const occupancyValue = Math.max(
    0,
    Math.min(propertyOverview.occupancyRate ?? 0, 100)
  );
  const hasIncome = propertyOverview.monthIncomePyg > 0;
  const expenseRatio = hasIncome
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            (propertyOverview.monthExpensePyg /
              propertyOverview.monthIncomePyg) *
              100
          )
        )
      )
    : 0;
  const netIncomePositive = propertyOverview.monthNetIncomePyg >= 0;
  const latestStatementId = propertyOverview.latestStatement
    ? asString(propertyOverview.latestStatement.id)
    : "";
  const workflowSteps = [
    {
      id: "listings",
      icon: Door01Icon,
      label: isEn ? "Listings" : "Anuncios",
      value: propertyOverview.publishedListingCount,
      description: isEn ? "Live in marketplace" : "Publicados",
      href: `/module/listings?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "applications",
      icon: UserGroupIcon,
      label: isEn ? "Applications" : "Aplicaciones",
      value: propertyOverview.pipelineApplicationCount,
      description: isEn ? "In qualification" : "En calificación",
      href: `/module/applications?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "leases",
      icon: Calendar02Icon,
      label: isEn ? "Leases" : "Contratos",
      value: propertyOverview.activeLeaseCount,
      description: isEn ? "Currently active" : "Activos",
      href: `/module/leases?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "collections",
      icon: Invoice01Icon,
      label: isEn ? "Collections" : "Cobros",
      value: propertyOverview.openCollectionCount,
      description: isEn ? "Require follow-up" : "Requieren seguimiento",
      href: `/module/collections?property_id=${encodeURIComponent(recordId)}`,
    },
  ] as const;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/60 bg-card/50 shadow-sm backdrop-blur-md">
        <CardContent className="p-0">
          <section className="relative overflow-hidden bg-[#fdfcfb] dark:bg-neutral-900/40">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-40 right-10 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
              <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-slate-200/10 blur-3xl dark:bg-white/5" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.6)_0%,transparent_100%)] dark:bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_100%)]" />
            </div>

            <div className="absolute -top-16 -right-16 opacity-[0.03] dark:opacity-[0.08]">
              <Icon icon={Building03Icon} size={320} />
            </div>

            <div className="relative grid gap-8 p-6 md:p-8 xl:grid-cols-[1fr_320px]">
              <div className="flex flex-col justify-between space-y-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className={cn(
                          buttonVariants({ variant: "secondary", size: "sm" }),
                          "h-7 rounded-lg border-border/10 bg-background/50 px-2.5 font-bold text-[10px] uppercase tracking-wider transition-all hover:bg-background/80"
                        )}
                        href={`/module/${moduleDef.slug}`}
                      >
                        <Icon icon={ArrowLeft01Icon} size={12} />
                        {isEn ? "Back" : "Volver"}
                      </Link>
                      <Badge
                        className="h-7 border-border/10 bg-background/50 font-bold text-[10px] text-muted-foreground uppercase tracking-wider backdrop-blur-sm"
                        variant="outline"
                      >
                        {moduleLabel}
                      </Badge>
                      <Badge className="h-7 border-primary/20 bg-primary/5 font-bold text-[10px] text-primary uppercase tracking-wider backdrop-blur-sm">
                        {propertyCodeLabel ?? recordId}
                      </Badge>
                    </div>

                    <div className="space-y-1">
                      <h2 className="font-bold text-3xl text-foreground tracking-tight sm:text-4xl">
                        {title}
                      </h2>
                      <p className="max-w-2xl font-medium text-muted-foreground text-sm leading-relaxed">
                        {propertyLocationLabel || moduleDescription}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <CopyButton
                      className="h-9 w-9 rounded-xl border-border/40 bg-background/40 hover:bg-background/80"
                      value={recordId}
                    />
                    <PinButton
                      className="h-9 w-9 rounded-xl border-border/40 bg-background/40 hover:bg-background/80"
                      href={href}
                      label={title}
                      meta={moduleLabel}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <Link
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/40 bg-background/60 px-4 font-semibold text-foreground text-xs shadow-sm transition-all hover:bg-background/90"
                    href={`/module/units?property_id=${encodeURIComponent(recordId)}`}
                  >
                    <Icon icon={Door01Icon} size={15} />
                    {isEn ? "Units" : "Unidades"}
                  </Link>
                  <Link
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/40 bg-background/60 px-4 font-semibold text-foreground text-xs shadow-sm transition-all hover:bg-background/90"
                    href={`/module/leases?property_id=${encodeURIComponent(recordId)}`}
                  >
                    <Icon icon={Calendar02Icon} size={15} />
                    {isEn ? "Leases" : "Contratos"}
                  </Link>
                  <Link
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/40 bg-background/60 px-4 font-semibold text-foreground text-xs shadow-sm transition-all hover:bg-background/90"
                    href={`/module/reports?property_id=${encodeURIComponent(recordId)}`}
                  >
                    <Icon icon={ChartIcon} size={15} />
                    {isEn ? "Analytics" : "Analíticos"}
                  </Link>
                </div>
              </div>

              <div className="rounded-[24px] border border-border/20 bg-background/30 p-4 shadow-inner backdrop-blur-xl">
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <div className="rounded-2xl border border-border/10 bg-card/40 p-3.5 shadow-sm">
                    <p className="font-bold text-[10px] text-muted-foreground uppercase tracking-widest">
                      {isEn ? "Occupancy" : "Ocupación"}
                    </p>
                    <p className="mt-1.5 font-bold text-3xl text-foreground tabular-nums">
                      {propertyOverview.occupancyRate !== null
                        ? `${propertyOverview.occupancyRate}%`
                        : "-"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/10 bg-card/40 p-3.5 shadow-sm">
                    <p className="font-bold text-[10px] text-muted-foreground uppercase tracking-widest">
                      {isEn ? "Projected Rent" : "Renta Proyectada"}
                    </p>
                    <p className="mt-1.5 font-bold text-foreground text-xl tabular-nums">
                      {formatCurrency(
                        propertyOverview.projectedRentPyg,
                        "PYG",
                        locale
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/10 bg-card/40 p-3.5 shadow-sm">
                    <p className="font-bold text-[10px] text-muted-foreground uppercase tracking-widest">
                      {isEn ? "Active Leases" : "Contratos Activos"}
                    </p>
                    <p className="mt-1.5 font-bold text-3xl text-foreground tabular-nums">
                      {propertyOverview.activeLeaseCount}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="space-y-4">
          <Card className="border-border/80 bg-card/98">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle className="text-xl">
                  {isEn ? "Unit matrix" : "Matriz de unidades"}
                </CardTitle>
                <CardDescription>
                  {isEn
                    ? "Each unit pulls lease, tasks, and collection status."
                    : "Cada unidad combina su contrato, tareas y cobros."}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "h-8 px-2.5"
                  )}
                  href={`/module/units?property_id=${encodeURIComponent(recordId)}`}
                >
                  {isEn ? "View all units" : "Ver unidades"}
                </Link>
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "secondary" }),
                    "h-8 px-2.5"
                  )}
                  href={`/module/units?property_id=${encodeURIComponent(recordId)}`}
                >
                  {isEn ? "Add unit" : "Agregar unidad"}
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {propertyOverview.unitCards.length ? (
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {propertyOverview.unitCards.map((unit) => {
                    const unitHref =
                      unit.unitId && isUuid(unit.unitId)
                        ? `/module/units/${unit.unitId}`
                        : `/module/units?property_id=${encodeURIComponent(recordId)}`;
                    const statusToneClass =
                      unit.statusTone === "occupied"
                        ? "status-tone-success"
                        : unit.statusTone === "maintenance"
                          ? "status-tone-warning"
                          : "status-tone-info";

                    return (
                      <article
                        className="flex h-full flex-col rounded-2xl border border-border/75 bg-background/75 p-3"
                        key={unit.id}
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              className="truncate font-semibold text-base underline-offset-4 hover:underline"
                              href={unitHref}
                            >
                              {unit.label}
                            </Link>
                            <p className="truncate text-muted-foreground text-xs">
                              {unit.subtitle}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "inline-flex shrink-0 rounded-full border px-2 py-0.5 font-medium text-[11px]",
                              statusToneClass
                            )}
                          >
                            {unit.statusLabel}
                          </span>
                        </div>

                        <div className="grid gap-2 rounded-xl border border-border/70 bg-muted/20 p-2.5 text-xs">
                          <div>
                            <p className="text-muted-foreground">
                              {isEn ? "Tenant" : "Inquilino"}
                            </p>
                            <p className="truncate font-medium text-sm">
                              {unit.tenantName}
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-muted-foreground">
                              {isEn ? "Monthly rent" : "Renta mensual"}
                            </p>
                            <p className="font-medium tabular-nums">
                              {formatCurrency(
                                unit.monthlyRentPyg,
                                "PYG",
                                locale
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <p className="text-muted-foreground text-xs">
                            {unit.nextCollectionDue
                              ? isEn
                                ? `Next due ${unit.nextCollectionDue}`
                                : `Próximo cobro ${unit.nextCollectionDue}`
                              : isEn
                                ? "No upcoming collection"
                                : "Sin cobro próximo"}
                          </p>
                          <Link
                            className={cn(
                              buttonVariants({
                                size: "sm",
                                variant: "outline",
                              }),
                              "h-7 px-2 text-xs"
                            )}
                            href={unitHref}
                          >
                            {isEn ? "Open" : "Abrir"}
                          </Link>
                        </div>
                        <p className="mt-2 inline-flex items-center gap-1 text-muted-foreground text-xs">
                          <Icon icon={Task01Icon} size={13} />
                          {unit.openTaskCount}{" "}
                          {isEn
                            ? unit.openTaskCount === 1
                              ? "open task"
                              : "open tasks"
                            : unit.openTaskCount === 1
                              ? "tarea abierta"
                              : "tareas abiertas"}
                        </p>
                      </article>
                    );
                  })}
                  {propertyOverview.unitCards.length < 6 ? (
                    <Link
                      className="group flex min-h-[14.5rem] items-center justify-center rounded-2xl border border-border/75 border-dashed bg-muted/20 p-4 text-center transition-colors hover:bg-muted/30"
                      href={`/module/units?property_id=${encodeURIComponent(recordId)}`}
                    >
                      <div className="space-y-1">
                        <p className="font-medium text-sm">
                          {isEn ? "Add another unit" : "Agregar unidad"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {isEn
                            ? "Keep occupancy and lease tracking complete."
                            : "Mantén completo el seguimiento de ocupación y contratos."}
                        </p>
                      </div>
                    </Link>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-border/75 border-dashed bg-muted/20 p-5">
                  <p className="font-medium text-sm">
                    {isEn
                      ? "No units yet for this property."
                      : "Esta propiedad aún no tiene unidades."}
                  </p>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {isEn
                      ? "Start by creating your first unit to unlock leasing, maintenance, and collections."
                      : "Empieza creando la primera unidad para activar contratos, mantenimiento y cobros."}
                  </p>
                  <Link
                    className={cn(
                      buttonVariants({ size: "sm", variant: "secondary" }),
                      "mt-3 h-8 px-2.5"
                    )}
                    href={`/module/units?property_id=${encodeURIComponent(recordId)}`}
                  >
                    {isEn ? "Create first unit" : "Crear primera unidad"}
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/98">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {isEn ? "Workflow lane" : "Flujo operativo"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "From listing to collection, track each step in one place."
                  : "Desde anuncio hasta cobro, controla cada etapa en un solo lugar."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {workflowSteps.map((step) => (
                <Link
                  className="rounded-2xl border border-border/70 bg-background/70 p-3 transition-colors hover:bg-muted/25"
                  href={step.href}
                  key={step.id}
                >
                  <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-muted/35">
                    <Icon icon={step.icon} size={14} />
                  </div>
                  <p className="font-medium text-sm">{step.label}</p>
                  <p className="font-semibold text-xl tabular-nums">
                    {step.value}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {step.description}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <Card className="border-border/80 bg-card/98">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Icon icon={ChartIcon} size={18} />
                  {isEn ? "Financial pulse" : "Pulso financiero"}
                </CardTitle>
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "h-8 px-2"
                  )}
                  href={`/module/reports?property_id=${encodeURIComponent(recordId)}`}
                >
                  {isEn ? "Report" : "Reporte"}
                </Link>
              </div>
              <CardDescription>
                {isEn
                  ? `Snapshot for ${propertyOverview.monthLabel}`
                  : `Resumen de ${propertyOverview.monthLabel}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Net income" : "Ingreso neto"}
                </p>
                <p className="font-semibold text-3xl tabular-nums tracking-tight">
                  {formatCurrency(
                    propertyOverview.monthNetIncomePyg,
                    "PYG",
                    locale
                  )}
                </p>
                <p
                  className={cn(
                    "text-xs",
                    netIncomePositive
                      ? "text-[var(--status-success-fg)]"
                      : "text-[var(--status-danger-fg)]"
                  )}
                >
                  {netIncomePositive
                    ? isEn
                      ? "Positive month-to-date margin."
                      : "Margen mensual positivo."
                    : isEn
                      ? "Expenses exceed collected income."
                      : "Los gastos superan el ingreso cobrado."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <p className="text-muted-foreground text-xs">
                    {isEn ? "Income" : "Ingreso"}
                  </p>
                  <p className="font-semibold text-lg tabular-nums">
                    {formatCurrency(
                      propertyOverview.monthIncomePyg,
                      "PYG",
                      locale
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <p className="text-muted-foreground text-xs">
                    {isEn ? "Expenses" : "Gastos"}
                  </p>
                  <p className="font-semibold text-lg tabular-nums">
                    {formatCurrency(
                      propertyOverview.monthExpensePyg,
                      "PYG",
                      locale
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <p className="text-muted-foreground">
                      {isEn ? "Occupancy" : "Ocupación"}
                    </p>
                    <p className="font-medium tabular-nums">
                      {occupancyValue}%
                    </p>
                  </div>
                  <Progress value={occupancyValue} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <p className="text-muted-foreground">
                      {isEn ? "Expense ratio" : "Ratio de gasto"}
                    </p>
                    <p className="font-medium tabular-nums">
                      {hasIncome ? `${expenseRatio}%` : "-"}
                    </p>
                  </div>
                  <Progress value={expenseRatio} />
                </div>
              </div>

              {propertyOverview.expenseCategoryBreakdown.length ? (
                <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
                  <p className="font-medium text-sm">
                    {isEn ? "Expense breakdown" : "Desglose de gastos"}
                  </p>
                  {propertyOverview.expenseCategoryBreakdown.map((row) => {
                    const categoryShare =
                      propertyOverview.monthExpensePyg > 0
                        ? Math.round(
                            (row.amount / propertyOverview.monthExpensePyg) *
                              100
                          )
                        : 0;
                    return (
                      <div className="space-y-1" key={row.category}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <p className="truncate">
                            {humanizeKey(row.category)}
                          </p>
                          <p className="font-medium tabular-nums">
                            {formatCurrency(row.amount, "PYG", locale)}
                          </p>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-foreground/75"
                            style={{
                              width: `${Math.max(
                                6,
                                Math.min(categoryShare, 100)
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {propertyOverview.latestStatement ? (
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-medium text-sm">
                      {isEn
                        ? "Latest owner statement"
                        : "Último estado del propietario"}
                    </p>
                    <StatusBadge
                      value={asString(propertyOverview.latestStatement.status)}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatCurrency(
                      toNumber(propertyOverview.latestStatement.net_payout) ??
                        0,
                      asString(propertyOverview.latestStatement.currency) ||
                        "PYG",
                      locale
                    )}
                  </p>
                  {latestStatementId && isUuid(latestStatementId) ? (
                    <Link
                      className="mt-2 inline-flex text-primary text-xs underline-offset-4 hover:underline"
                      href={`/module/owner-statements/${latestStatementId}`}
                    >
                      {isEn ? "Open statement" : "Abrir estado"}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/98">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Icon icon={Task01Icon} size={18} />
                  {isEn ? "Urgent attention" : "Atención urgente"}
                </CardTitle>
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "h-8 px-2"
                  )}
                  href={`/module/tasks?property_id=${encodeURIComponent(recordId)}`}
                >
                  {isEn ? "All tasks" : "Todas"}
                </Link>
              </div>
              <CardDescription>
                {isEn
                  ? "Items that can impact occupancy, cash flow, or lease continuity."
                  : "Elementos que afectan ocupación, flujo de caja o continuidad del contrato."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {propertyOverview.attentionItems.length ? (
                propertyOverview.attentionItems.map((item) => {
                  const toneClass =
                    item.tone === "danger"
                      ? "status-tone-danger"
                      : item.tone === "warning"
                        ? "status-tone-warning"
                        : "status-tone-info";
                  return (
                    <article
                      className="rounded-2xl border border-border/70 bg-background/72 p-3"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium text-sm">{item.title}</p>
                          <p className="text-muted-foreground text-xs">
                            {item.detail}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
                            toneClass
                          )}
                        >
                          {item.tone === "danger"
                            ? isEn
                              ? "High"
                              : "Alta"
                            : item.tone === "warning"
                              ? isEn
                                ? "Medium"
                                : "Media"
                              : isEn
                                ? "Info"
                                : "Info"}
                        </span>
                      </div>
                      <Link
                        className={cn(
                          buttonVariants({ size: "sm", variant: "outline" }),
                          "mt-2 h-7 px-2 text-xs"
                        )}
                        href={item.href}
                      >
                        {item.ctaLabel}
                      </Link>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-border/75 border-dashed bg-muted/20 p-4">
                  <p className="font-medium text-sm">
                    {isEn
                      ? "No urgent blockers right now."
                      : "No hay bloqueos urgentes por ahora."}
                  </p>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {isEn
                      ? "Keep momentum by scheduling preventive checks."
                      : "Mantén el ritmo programando revisiones preventivas."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      className={cn(
                        buttonVariants({ size: "sm", variant: "outline" }),
                        "h-8 px-2.5"
                      )}
                      href={`/module/tasks?property_id=${encodeURIComponent(recordId)}`}
                    >
                      {isEn ? "Create task" : "Crear tarea"}
                    </Link>
                    <Link
                      className={cn(
                        buttonVariants({ size: "sm", variant: "outline" }),
                        "h-8 px-2.5"
                      )}
                      href={`/module/collections?property_id=${encodeURIComponent(recordId)}`}
                    >
                      {isEn ? "Review collections" : "Revisar cobros"}
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
