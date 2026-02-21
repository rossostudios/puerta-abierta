"use client";

import { StatementPrintView } from "@/components/statements/statement-print-view";
import { Button } from "@/components/ui/button";

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type AdminStatementPrintProps = {
  locale: string;
  orgName: string;
  statement: Record<string, unknown> | null;
  collections: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
};

export function AdminStatementPrint({
  locale,
  orgName,
  statement,
  collections,
  expenses,
}: AdminStatementPrintProps) {
  const isEn = locale === "en-US";

  if (!statement) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">
          {isEn ? "Statement not found." : "Estado de cuenta no encontrado."}
        </p>
      </div>
    );
  }

  const currency = asString(statement.currency) || "PYG";

  return (
    <div>
      <div className="no-print mx-auto mb-4 flex max-w-3xl justify-end gap-2 px-8 pt-4">
        <Button onClick={() => window.print()} size="sm">
          {isEn ? "Print" : "Imprimir"}
        </Button>
      </div>
      <StatementPrintView
        collections={collections.map((c) => ({
          id: asString(c.id),
          label: asString(c.label) || asString(c.due_date),
          amount: asNumber(c.amount),
        }))}
        currency={currency}
        expenses={expenses.map((e) => ({
          id: asString(e.id),
          label: asString(e.description) || asString(e.expense_date),
          amount: asNumber(e.amount),
        }))}
        generatedAt={new Date().toLocaleDateString(locale)}
        locale={locale}
        netPayout={asNumber(statement.net_payout)}
        orgName={orgName}
        periodLabel={
          asString(statement.period_label) || asString(statement.month)
        }
        totalExpenses={asNumber(statement.total_expenses)}
        totalRevenue={asNumber(statement.total_revenue)}
        taxSummary={
          statement.tax_summary
            ? {
                managementFee: asNumber(
                  (statement.tax_summary as Record<string, unknown>)
                    ?.management_fee
                ),
                ivaRatePct: asNumber(
                  (statement.tax_summary as Record<string, unknown>)
                    ?.iva_rate_pct
                ),
                ivaAmount: asNumber(statement.iva_amount),
                irpApplicable: statement.irp_applicable === true,
              }
            : null
        }
      />
    </div>
  );
}
