import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
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
      <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
            {isEn ? "Financial pulse" : "Pulso financiero"}
          </h3>
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "h-7 rounded-lg px-3 text-xs"
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

        {/* Net income — recessed card */}
        <div className="rounded-xl bg-muted/30 p-4">
          <p className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
            {isEn ? "Net income" : "Ingreso neto"}
          </p>
          <p className="mt-1 font-extrabold text-[28px] tabular-nums leading-8 tracking-tight">
            {formatCurrency(overview.monthNetIncomePyg, "PYG", locale)}
          </p>
          <p
            className={cn(
              "mt-1.5 font-medium text-xs",
              netIncomePositive
                ? "text-[var(--status-success-fg)]"
                : "text-[var(--status-danger-fg)]"
            )}
          >
            {netIncomePositive
              ? isEn
                ? "Positive month-to-date margin"
                : "Margen mensual positivo"
              : isEn
                ? "Expenses exceed collected income"
                : "Los gastos superan el ingreso cobrado"}
          </p>
        </div>

        {/* Income / Expenses side-by-side */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-0.5">
            <p className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
              {isEn ? "Income" : "Ingreso"}
            </p>
            <p className="font-bold text-[var(--status-success-fg)] text-lg tabular-nums tracking-tight">
              {formatCurrency(overview.monthIncomePyg, "PYG", locale)}
            </p>
          </div>
          <div className="space-y-0.5">
            <p className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
              {isEn ? "Expenses" : "Gastos"}
            </p>
            <p className="font-bold text-lg tabular-nums tracking-tight">
              {formatCurrency(overview.monthExpensePyg, "PYG", locale)}
            </p>
          </div>
        </div>

        {/* Collected / Overdue row */}
        {(overview.collectedThisMonthPyg > 0 ||
          overview.overdueCollectionAmountPyg > 0) && (
          <div className="grid grid-cols-2 gap-3 border-border/40 border-t pt-3">
            <div className="space-y-0.5">
              <p className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
                {isEn ? "Collected" : "Cobrado"}
              </p>
              <p className="font-semibold text-[var(--status-success-fg)] text-sm tabular-nums">
                {formatCurrency(overview.collectedThisMonthPyg, "PYG", locale)}
              </p>
            </div>
            <div className="space-y-0.5">
              <p
                className={cn(
                  "font-semibold text-[10px] uppercase tracking-[0.1em]",
                  overview.overdueCollectionAmountPyg > 0
                    ? "text-[var(--status-danger-fg)]"
                    : "text-muted-foreground/70"
                )}
              >
                {isEn ? "Overdue" : "Vencido"}
                {overview.overdueCollectionCount > 0
                  ? ` (${overview.overdueCollectionCount})`
                  : ""}
              </p>
              <p
                className={cn(
                  "font-semibold text-sm tabular-nums",
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
              </p>
            </div>
          </div>
        )}

        {/* Occupancy / Expense ratio — bordered list rows */}
        <div className="overflow-hidden rounded-xl border border-border/40">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-[13px] text-muted-foreground">
              {isEn ? "Occupancy" : "Ocupación"}
            </span>
            <span
              className={cn(
                "font-semibold text-[13px] tabular-nums",
                occupancyValue >= 80
                  ? "text-[var(--status-success-fg)]"
                  : occupancyValue >= 50
                    ? "text-[var(--status-warning-fg)]"
                    : "text-[var(--status-danger-fg)]"
              )}
            >
              {occupancyValue}%
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-border/40 border-t px-3.5 py-2.5">
            <span className="text-[13px] text-muted-foreground">
              {isEn ? "Expense ratio" : "Ratio de gasto"}
            </span>
            <span className="font-semibold text-[13px] tabular-nums">
              {hasIncome ? `${expenseRatio}%` : "-"}
            </span>
          </div>
        </div>

        {/* Expense breakdown */}
        {overview.expenseCategoryBreakdown.length ? (
          <div className="space-y-2 border-border/40 border-t pt-3">
            <h4 className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
              {isEn ? "Expense breakdown" : "Desglose de gastos"}
            </h4>
            <div className="overflow-hidden rounded-xl border border-border/40">
              {overview.expenseCategoryBreakdown.map((row, i) => {
                const categoryShare =
                  overview.monthExpensePyg > 0
                    ? Math.round((row.amount / overview.monthExpensePyg) * 100)
                    : 0;
                return (
                  <div
                    className={cn(
                      "flex items-center justify-between gap-3 px-3.5 py-2.5",
                      i < overview.expenseCategoryBreakdown.length - 1 &&
                        "border-border/20 border-b"
                    )}
                    key={row.category}
                  >
                    <span className="truncate text-[13px]">
                      {humanizeKey(row.category)}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {categoryShare}%
                      </span>
                      <span className="font-medium text-[13px] tabular-nums">
                        {formatCurrency(row.amount, "PYG", locale)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {overview.totalExpenseCategoryCount >
            overview.expenseCategoryBreakdown.length ? (
              <p className="text-center text-muted-foreground text-xs">
                +
                {overview.totalExpenseCategoryCount -
                  overview.expenseCategoryBreakdown.length}{" "}
                {isEn ? "more categories" : "categorías más"}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Latest statement */}
        {overview.latestStatement ? (
          <div className="flex items-center justify-between gap-3 border-border/40 border-t pt-3">
            <div className="min-w-0">
              <p className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
                {isEn
                  ? "Latest owner statement"
                  : "Último estado del propietario"}
              </p>
              <p className="mt-0.5 font-medium text-sm tabular-nums">
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
      <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
        <div className="space-y-1">
          <h3 className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
            {isEn ? "Urgent attention" : "Atención urgente"}
          </h3>
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
                    "rounded-lg border-l-2 bg-muted/20 py-2.5 pr-3 pl-3",
                    borderColor
                  )}
                  key={item.id}
                >
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    {item.detail}
                  </p>
                  <Link
                    className={cn(
                      buttonVariants({ size: "sm", variant: "outline" }),
                      "mt-2 h-6 rounded-md px-2 text-xs"
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
        <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
          <div className="space-y-1">
            <h3 className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
              {isEn ? "Lease renewals" : "Renovaciones de contrato"}
            </h3>
            <p className="text-muted-foreground text-xs">
              {isEn
                ? "Leases expiring within 90 days."
                : "Contratos que vencen en los próximos 90 días."}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-border/40">
            {overview.leasesExpiringSoon.map((lease, i) => {
              const urgencyColor =
                lease.daysLeft <= 30
                  ? "status-tone-danger"
                  : lease.daysLeft <= 60
                    ? "status-tone-warning"
                    : "status-tone-info";
              return (
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 px-3.5 py-2.5",
                    i < overview.leasesExpiringSoon.length - 1 &&
                      "border-border/20 border-b"
                  )}
                  key={lease.leaseId}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate font-medium text-[13px]">
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
