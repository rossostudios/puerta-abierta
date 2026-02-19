import {
  Calendar03Icon,
  ChartIcon,
  Invoice03Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PropertyOverview as PropertyOverviewData } from "../types";
import { isUuid } from "./property-overview-utils";

type PropertyOverviewFinancialProps = {
  overview: PropertyOverviewData;
  recordId: string;
  locale: "en-US" | "es-PY";
  isEn: boolean;
};

export function PropertyOverviewFinancial({
  overview,
  recordId,
  locale,
  isEn,
}: PropertyOverviewFinancialProps) {
  const hasIncome = overview.monthIncomePyg > 0;
  const expenseRatio = hasIncome
    ? Math.max(
      0,
      Math.min(
        100,
        Math.round((overview.monthExpensePyg / overview.monthIncomePyg) * 100)
      )
    )
    : 0;
  const occupancyValue = Math.max(
    0,
    Math.min(overview.occupancyRate ?? 0, 100)
  );
  const netIncomePositive = overview.monthNetIncomePyg >= 0;
  const latestStatementId = overview.latestStatement
    ? String(overview.latestStatement.id ?? "")
    : "";

  return (
    <section className="space-y-4">
      <Card className="border-border/60 bg-card/95 backdrop-blur-[2px]">
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
              ? `Snapshot for ${overview.monthLabel}`
              : `Resumen de ${overview.monthLabel}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-3xl border border-border/40 bg-background/50 p-5 transition-shadow duration-300 hover:shadow-[var(--shadow-soft)]">
            <p className="font-semibold text-[11px] uppercase tracking-widest text-muted-foreground">
              {isEn ? "Net income" : "Ingreso neto"}
            </p>
            <p className="my-1 font-bold text-4xl tabular-nums tracking-tight">
              {formatCurrency(overview.monthNetIncomePyg, "PYG", locale)}
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

          {overview.collectedThisMonthPyg > 0 ||
            overview.overdueCollectionAmountPyg > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-border/40 bg-muted/10 p-5 transition-shadow duration-300 hover:shadow-sm hover:bg-card">
                <p className="font-semibold text-[10px] uppercase tracking-widest text-muted-foreground">
                  {isEn ? "Collected this month" : "Cobrado este mes"}
                </p>
                <p className="mt-1 font-bold text-2xl tabular-nums text-[var(--status-success-fg)]">
                  {formatCurrency(
                    overview.collectedThisMonthPyg,
                    "PYG",
                    locale
                  )}
                </p>
              </div>
              <div
                className={cn(
                  "rounded-3xl border p-5 transition-shadow duration-300 hover:shadow-sm hover:bg-card",
                  overview.overdueCollectionAmountPyg > 0
                    ? "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]/50"
                    : "border-border/40 bg-muted/10"
                )}
              >
                <p
                  className={cn(
                    "text-xs",
                    overview.overdueCollectionAmountPyg > 0
                      ? "text-[var(--status-danger-fg)]"
                      : "text-muted-foreground"
                  )}
                >
                  {isEn ? "Overdue" : "Vencido"}
                  {overview.overdueCollectionCount > 0
                    ? ` (${overview.overdueCollectionCount})`
                    : ""}
                </p>
                <p
                  className={cn(
                    "mt-1 font-bold text-2xl tabular-nums",
                    overview.overdueCollectionAmountPyg > 0
                      ? "text-[var(--status-danger-fg)]"
                      : "text-foreground"
                  )}
                >
                  {formatCurrency(
                    overview.overdueCollectionAmountPyg,
                    "PYG",
                    locale
                  )}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-border/40 bg-muted/10 p-5 transition-shadow duration-300 hover:shadow-sm hover:bg-card">
              <p className="font-semibold text-[10px] uppercase tracking-widest text-muted-foreground">
                {isEn ? "Income" : "Ingreso"}
              </p>
              <p className="mt-1 font-bold text-2xl tabular-nums">
                {formatCurrency(overview.monthIncomePyg, "PYG", locale)}
              </p>
            </div>
            <div className="rounded-3xl border border-border/40 bg-muted/10 p-5 transition-shadow duration-300 hover:shadow-sm hover:bg-card">
              <p className="font-semibold text-[10px] uppercase tracking-widest text-muted-foreground">
                {isEn ? "Expenses" : "Gastos"}
              </p>
              <p className="mt-1 font-bold text-2xl tabular-nums">
                {formatCurrency(overview.monthExpensePyg, "PYG", locale)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <p className="text-muted-foreground">
                  {isEn ? "Occupancy" : "Ocupación"}
                </p>
                <p className="font-medium tabular-nums">{occupancyValue}%</p>
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

          {overview.expenseCategoryBreakdown.length ? (
            <div className="space-y-4 rounded-3xl border border-border/40 bg-muted/10 p-5">
              <p className="font-semibold text-[11px] uppercase tracking-widest text-muted-foreground">
                {isEn ? "Expense breakdown" : "Desglose de gastos"}
              </p>
              {overview.expenseCategoryBreakdown.map((row) => {
                const categoryShare =
                  overview.monthExpensePyg > 0
                    ? Math.round((row.amount / overview.monthExpensePyg) * 100)
                    : 0;
                return (
                  <div className="space-y-1" key={row.category}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <p className="truncate">{humanizeKey(row.category)}</p>
                      <p className="font-medium tabular-nums">
                        {formatCurrency(row.amount, "PYG", locale)}
                      </p>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground/75"
                        style={{
                          width: `${Math.max(6, Math.min(categoryShare, 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {overview.totalExpenseCategoryCount > overview.expenseCategoryBreakdown.length ? (
                <p className="text-muted-foreground text-xs">
                  +{overview.totalExpenseCategoryCount - overview.expenseCategoryBreakdown.length}{" "}
                  {isEn ? "more categories" : "categorias mas"}
                </p>
              ) : null}
            </div>
          ) : null}

          {overview.latestStatement ? (
            <div className="rounded-3xl border border-border/40 bg-muted/10 p-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold text-[11px] uppercase tracking-widest text-muted-foreground">
                  {isEn
                    ? "Latest owner statement"
                    : "Último estado del propietario"}
                </p>
                <StatusBadge
                  value={String(overview.latestStatement.status ?? "unknown")}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {formatCurrency(
                  Number(overview.latestStatement.net_payout ?? 0),
                  String(overview.latestStatement.currency ?? "PYG"),
                  locale
                )}
              </p>
              {latestStatementId && isUuid(latestStatementId) ? (
                <Link
                  className="mt-2 inline-flex text-primary text-xs hover:underline"
                  href={`/module/owner-statements/${latestStatementId}`}
                >
                  {isEn ? "Open statement" : "Abrir estado"}
                </Link>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/95 backdrop-blur-[2px]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Icon icon={Task01Icon} size={18} />
            {isEn ? "Urgent attention" : "Atención urgente"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Items that can impact occupancy, cash flow, or lease continuity."
              : "Elementos que afectan ocupación, flujo de caja o continuidad del contrato."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.attentionItems.length ? (
            overview.attentionItems.map((item) => {
              const toneClass =
                item.tone === "danger"
                  ? "status-tone-danger"
                  : item.tone === "warning"
                    ? "status-tone-warning"
                    : "status-tone-info";
              return (
                <article
                  className="rounded-3xl border border-border/40 bg-background/50 p-4 transition-all duration-300 hover:shadow-[var(--shadow-soft)] hover:bg-card hover:border-border/60"
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
            </div>
          )}
        </CardContent>
      </Card>
      {overview.leasesExpiringSoon.length > 0 ? (
        <Card className="border-border/60 bg-card/95 backdrop-blur-[2px]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Icon icon={Calendar03Icon} size={18} />
              {isEn ? "Lease renewals" : "Renovaciones de contrato"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Leases expiring within 90 days."
                : "Contratos que vencen en los próximos 90 días."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.leasesExpiringSoon.map((lease) => {
              const urgencyColor =
                lease.daysLeft <= 30
                  ? "status-tone-danger"
                  : lease.daysLeft <= 60
                    ? "status-tone-warning"
                    : "status-tone-info";
              return (
                <div
                  className="flex items-center justify-between rounded-2xl border border-border/40 bg-background/50 p-4 transition-all duration-300 hover:shadow-[var(--shadow-soft)] hover:bg-card"
                  key={lease.leaseId}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate font-medium text-sm">
                      {lease.tenantName}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {lease.unitLabel}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      urgencyColor
                    )}
                  >
                    {lease.daysLeft}d
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
