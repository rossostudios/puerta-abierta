"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/format";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type StatementRow = {
  id: string;
  period_label: string;
  status: string;
  total_revenue: number;
  total_expenses: number;
  net_payout: number;
  currency: string;
  created_at: string;
};

function parseRow(raw: Record<string, unknown>): StatementRow {
  return {
    id: asString(raw.id),
    period_label: asString(raw.period_label) || asString(raw.month),
    status: asString(raw.status),
    total_revenue: asNumber(raw.total_revenue),
    total_expenses: asNumber(raw.total_expenses),
    net_payout: asNumber(raw.net_payout),
    currency: asString(raw.currency) || "PYG",
    created_at: asString(raw.created_at),
  };
}

type StatementDetail = {
  collections: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
};

export function OwnerStatements({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [details, setDetails] = useState<Record<string, StatementDetail>>({});
  const [token] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("owner_token") : null
  );

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["owner-statements", token],
    queryFn: async () => {
      if (!token) {
        router.push("/owner/login");
        return [];
      }
      const res = await fetch(`${API_BASE}/owner/statements`, {
        headers: { "x-owner-token": token },
      });
      if (res.status === 401) {
        localStorage.removeItem("owner_token");
        router.push("/owner/login");
        return [];
      }
      const data = await res.json();
      const items = ((data as { data?: unknown[] }).data ?? []) as Record<
        string,
        unknown
      >[];
      return items.map(parseRow);
    },
    enabled: Boolean(token),
    retry: false,
  });

  const toggleDetail = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (details[id]) return;

      const token = localStorage.getItem("owner_token");
      if (!token) return;

      setDetailLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/owner/statements/${encodeURIComponent(id)}`,
          { headers: { "x-owner-token": token } }
        );
        if (res.ok) {
          const data = await res.json();
          setDetails((prev) => ({
            ...prev,
            [id]: {
              collections: (data.collections ?? []) as Record<string, unknown>[],
              expenses: (data.expenses ?? []) as Record<string, unknown>[],
            },
          }));
        }
      } catch {
        // silently fail
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedId, details]
  );

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          {isEn ? "Loading..." : "Cargando..."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isEn ? "Owner Statements" : "Estados de Cuenta"}
        </h1>
        <Link
          className="text-sm text-primary hover:underline"
          href="/owner/dashboard"
        >
          {isEn ? "Back to dashboard" : "Volver al panel"}
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {isEn ? "No statements yet." : "Aún no hay estados de cuenta."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const isExpanded = expandedId === row.id;
            const detail = details[row.id];
            return (
              <Card key={row.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {row.period_label || row.created_at.slice(0, 7)}
                    </CardTitle>
                    <StatusBadge
                      label={row.status}
                      value={row.status}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {isEn ? "Revenue" : "Ingresos"}
                      </p>
                      <p className="font-medium">
                        {formatCurrency(row.total_revenue, row.currency, locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {isEn ? "Expenses" : "Gastos"}
                      </p>
                      <p className="font-medium">
                        {formatCurrency(row.total_expenses, row.currency, locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {isEn ? "Net Payout" : "Pago Neto"}
                      </p>
                      <p className="font-semibold text-lg">
                        {formatCurrency(row.net_payout, row.currency, locale)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      className="h-7 text-xs"
                      onClick={() => toggleDetail(row.id)}
                      size="sm"
                      variant="ghost"
                    >
                      {isExpanded
                        ? isEn
                          ? "Hide details"
                          : "Ocultar detalles"
                        : isEn
                          ? "View details"
                          : "Ver detalles"}
                    </Button>
                    <Link
                      className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-muted"
                      href={`/owner/statements/${encodeURIComponent(row.id)}/print`}
                    >
                      {isEn ? "Print" : "Imprimir"}
                    </Link>
                  </div>

                  {isExpanded ? (
                    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                      {detailLoading && !detail ? (
                        <p className="animate-pulse text-sm text-muted-foreground">
                          {isEn ? "Loading..." : "Cargando..."}
                        </p>
                      ) : detail ? (
                        <>
                          {detail.collections.length > 0 ? (
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                                {isEn ? "Collections" : "Cobros"}
                              </p>
                              <div className="space-y-1">
                                {detail.collections.map((c) => (
                                  <div
                                    className="flex items-center justify-between rounded bg-background px-2 py-1 text-sm"
                                    key={asString(c.id)}
                                  >
                                    <span>{asString(c.label) || asString(c.due_date)}</span>
                                    <span className="font-medium">
                                      {formatCurrency(asNumber(c.amount), row.currency, locale)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {detail.expenses.length > 0 ? (
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                                {isEn ? "Expenses" : "Gastos"}
                              </p>
                              <div className="space-y-1">
                                {detail.expenses.map((e) => (
                                  <div
                                    className="flex items-center justify-between rounded bg-background px-2 py-1 text-sm"
                                    key={asString(e.id)}
                                  >
                                    <span>{asString(e.description) || asString(e.expense_date)}</span>
                                    <span className="font-medium text-red-600 dark:text-red-400">
                                      -{formatCurrency(asNumber(e.amount), row.currency, locale)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {detail.collections.length === 0 && detail.expenses.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              {isEn ? "No line items for this period." : "Sin detalles para este período."}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
