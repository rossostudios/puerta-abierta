import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { reconciliationDiffClass } from "@/lib/features/module-record/data";
import type {
  StatementLineItem,
  StatementReconciliation,
} from "@/lib/features/module-record/types";
import { isUuid, shortId } from "@/lib/features/module-record/utils";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { cn } from "@/lib/utils";

const SOURCE_HREF_BASE_BY_TABLE: Record<string, string> = {
  reservations: "/module/reservations",
  collection_records: "/module/collections",
  leases: "/module/leases",
  expenses: "/module/expenses",
};

export function StatementPanel({
  lineItems,
  reconciliation,
  currency,
  isEn,
  locale,
}: {
  lineItems: StatementLineItem[];
  reconciliation: StatementReconciliation | null;
  currency: string;
  isEn: boolean;
  locale: "en-US" | "es-PY";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isEn ? "Reconciliation panel" : "Panel de conciliación"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Review line by line how this owner statement was calculated."
            : "Verifica línea por línea el cálculo de este estado del propietario."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reconciliation ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border bg-card p-3">
              <p className="text-muted-foreground text-xs">
                {isEn
                  ? "Gross total (reservations + collections)"
                  : "Total bruto (reserva + cobros)"}
              </p>
              <p className="font-semibold text-base">
                {formatCurrency(
                  reconciliation.gross_total ?? 0,
                  currency,
                  locale
                )}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Computed net" : "Neto calculado"}
              </p>
              <p className="font-semibold text-base">
                {formatCurrency(
                  reconciliation.computed_net_payout ?? 0,
                  currency,
                  locale
                )}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Stored net" : "Neto guardado"}
              </p>
              <p className="font-semibold text-base">
                {formatCurrency(
                  reconciliation.stored_net_payout ?? 0,
                  currency,
                  locale
                )}
              </p>
            </div>
            <div
              className={cn(
                "rounded-xl border p-3",
                reconciliationDiffClass(
                  reconciliation.stored_vs_computed_diff ?? 0
                )
              )}
            >
              <p className="text-xs">
                {isEn
                  ? "Stored vs computed difference"
                  : "Diferencia guardado vs calculado"}
              </p>
              <p className="font-semibold text-base">
                {formatCurrency(
                  reconciliation.stored_vs_computed_diff ?? 0,
                  currency,
                  locale
                )}
              </p>
            </div>
          </div>
        ) : null}

        <div className="rounded-md border">
          <div className="grid grid-cols-[1.2fr_1.1fr_1fr_0.9fr] gap-3 border-b bg-muted/35 px-3 py-2">
            <p className="font-medium text-muted-foreground text-xs">
              {isEn ? "Concept" : "Concepto"}
            </p>
            <p className="font-medium text-muted-foreground text-xs">
              {isEn ? "Source" : "Origen"}
            </p>
            <p className="font-medium text-muted-foreground text-xs">
              {isEn ? "Date" : "Fecha"}
            </p>
            <p className="text-right font-medium text-muted-foreground text-xs">
              {isEn ? "Amount (PYG)" : "Monto (PYG)"}
            </p>
          </div>
          <div className="max-h-[28rem] divide-y overflow-auto">
            {lineItems.length ? (
              lineItems.map((line, index) => {
                const sourceBase = SOURCE_HREF_BASE_BY_TABLE[line.source_table];
                const sourceHref =
                  sourceBase && isUuid(line.source_id)
                    ? `${sourceBase}/${line.source_id}`
                    : null;

                const dateLabel =
                  line.date ??
                  (line.from && line.to ? `${line.from} → ${line.to}` : "-");

                return (
                  <div
                    className="grid grid-cols-[1.2fr_1.1fr_1fr_0.9fr] gap-3 px-3 py-2.5"
                    key={`${line.source_table}:${line.source_id}:${index}`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate font-medium text-sm">
                        {humanizeKey(line.bucket)}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
                        {humanizeKey(line.kind)}
                      </p>
                    </div>
                    <div className="min-w-0">
                      {sourceHref ? (
                        <Link
                          className="font-mono text-primary text-xs underline-offset-4 hover:underline"
                          href={sourceHref}
                          prefetch={false}
                        >
                          {line.source_table}:{shortId(line.source_id)}
                        </Link>
                      ) : (
                        <p className="font-mono text-muted-foreground text-xs">
                          {line.source_table}:{shortId(line.source_id)}
                        </p>
                      )}
                    </div>
                    <p className="text-foreground text-xs">{dateLabel}</p>
                    <p className="text-right text-sm tabular-nums">
                      {formatCurrency(line.amount_pyg, currency, locale)}
                    </p>
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-4 text-muted-foreground text-sm">
                {isEn
                  ? "This statement does not expose reconciliation lines yet."
                  : "Este estado aún no expone líneas de conciliación."}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
