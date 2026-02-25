import {
  Calendar03Icon,
  ChartIcon,
  Task01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
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
    <section className="space-y-6">
      {/* ---- Financial Pulse ---- */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className="text-muted-foreground/70" icon={ChartIcon} size={15} />
            <h3 className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
              {isEn ? "Financial pulse" : "Pulso financiero"}
            </h3>
          </div>
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "h-7 px-2 text-xs"
            )}
            href={`/module/reports?property_id=${encodeURIComponent(recordId)}`}
          >
            {isEn ? "Report" : "Reporte"}
          </Link>
        </div>

        <p className="text-muted-foreground text-xs">
          {isEn
            ? `Snapshot for ${overview.monthLabel}`
            : `Resumen de ${overview.monthLabel}`}
        </p>

        {/* Net income — prominent bare typography */}
        <div>
          <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-widest">
            {isEn ? "Net income" : "Ingreso neto"}
          </p>
          <p className="my-1 font-bold text-3xl tabular-nums tracking-tight">
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

        {/* Metrics grid */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          {(overview.collectedThisMonthPyg > 0 ||
            overview.overdueCollectionAmountPyg > 0) && (
            <>
              <div>
                <dt className="text-muted-foreground text-xs">
                  {isEn ? "Collected this month" : "Cobrado este mes"}
                </dt>
                <dd className="font-semibold text-[var(--status-success-fg)] tabular-nums">
                  {formatCurrency(
                    overview.collectedThisMonthPyg,
                    "PYG",
                    locale
                  )}
                </dd>
              </div>
              <div>
                <dt
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
                </dt>
                <dd
                  className={cn(
                    "font-semibold tabular-nums",
                    overview.overdueCollectionAmountPyg > 0
                      ? "text-[var(--status-danger-fg)]"
                      : ""
                  )}
                >
                  {formatCurrency(
                    overview.overdueCollectionAmountPyg,
                    "PYG",
                    locale
                  )}
                </dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-muted-foreground text-xs">
              {isEn ? "Income" : "Ingreso"}
            </dt>
            <dd className="font-semibold tabular-nums">
              {formatCurrency(overview.monthIncomePyg, "PYG", locale)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {isEn ? "Expenses" : "Gastos"}
            </dt>
            <dd className="font-semibold tabular-nums">
              {formatCurrency(overview.monthExpensePyg, "PYG", locale)}
            </dd>
          </div>
        </dl>

        {/* Progress bars */}
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

        {/* Expense breakdown */}
        {overview.expenseCategoryBreakdown.length ? (
          <div className="space-y-4 border-t border-border/40 pt-3">
            <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-widest">
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
            {overview.totalExpenseCategoryCount >
            overview.expenseCategoryBreakdown.length ? (
              <p className="text-muted-foreground text-xs">
                +
                {overview.totalExpenseCategoryCount -
                  overview.expenseCategoryBreakdown.length}{" "}
                {isEn ? "more categories" : "categorias mas"}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Latest statement */}
        {overview.latestStatement ? (
          <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
            <div className="min-w-0">
              <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-widest">
                {isEn
                  ? "Latest owner statement"
                  : "Último estado del propietario"}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatCurrency(
                  Number(overview.latestStatement.net_payout ?? 0),
                  String(overview.latestStatement.currency ?? "PYG"),
                  locale
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge
                value={String(overview.latestStatement.status ?? "unknown")}
              />
              {latestStatementId && isUuid(latestStatementId) ? (
                <Link
                  className="text-primary text-xs hover:underline"
                  href={`/module/owner-statements/${latestStatementId}`}
                >
                  {isEn ? "Open" : "Abrir"}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- Urgent Attention ---- */}
      <div className="space-y-3 border-t border-border/40 pt-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Icon className="text-muted-foreground/70" icon={Task01Icon} size={15} />
            <h3 className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
              {isEn ? "Urgent attention" : "Atención urgente"}
            </h3>
          </div>
          <p className="text-muted-foreground text-xs">
            {isEn
              ? "Items that can impact occupancy, cash flow, or lease continuity."
              : "Elementos que afectan ocupación, flujo de caja o continuidad del contrato."}
          </p>
        </div>

        {overview.attentionItems.length ? (
          <div className="space-y-2">
            {overview.attentionItems.map((item) => {
              const borderColor =
                item.tone === "danger"
                  ? "border-l-[var(--status-danger-fg)]"
                  : item.tone === "warning"
                    ? "border-l-[var(--status-warning-fg)]"
                    : "border-l-[var(--status-info-fg)]";
              return (
                <article
                  className={cn(
                    "border-l-2 py-2 pl-3",
                    borderColor
                  )}
                  key={item.id}
                >
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-muted-foreground text-xs">{item.detail}</p>
                  <Link
                    className={cn(
                      buttonVariants({ size: "sm", variant: "outline" }),
                      "mt-1.5 h-6 px-2 text-xs"
                    )}
                    href={item.href}
                  >
                    {item.ctaLabel}
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "No urgent blockers right now."
              : "No hay bloqueos urgentes por ahora."}
          </p>
        )}
      </div>

      {/* ---- Lease Renewals ---- */}
      {overview.leasesExpiringSoon.length > 0 ? (
        <div className="space-y-3 border-t border-border/40 pt-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Icon className="text-muted-foreground/70" icon={Calendar03Icon} size={15} />
              <h3 className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
                {isEn ? "Lease renewals" : "Renovaciones de contrato"}
              </h3>
            </div>
            <p className="text-muted-foreground text-xs">
              {isEn
                ? "Leases expiring within 90 days."
                : "Contratos que vencen en los próximos 90 días."}
            </p>
          </div>

          <div className="divide-y divide-border/40">
            {overview.leasesExpiringSoon.map((lease) => {
              const urgencyColor =
                lease.daysLeft <= 30
                  ? "status-tone-danger"
                  : lease.daysLeft <= 60
                    ? "status-tone-warning"
                    : "status-tone-info";
              return (
                <div
                  className="flex items-center justify-between gap-3 py-2.5"
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
                      "inline-flex shrink-0 rounded-full border px-2 py-0.5 font-medium text-[11px]",
                      urgencyColor
                    )}
                  >
                    {lease.daysLeft}d
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
