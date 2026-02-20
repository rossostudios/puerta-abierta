"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatementPrintView } from "@/components/statements/statement-print-view";
import { Button } from "@/components/ui/button";

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

export default function OwnerStatementPrintPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [token] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("owner_token") : null
  );

  const { data: statementData, isLoading: loading } = useQuery({
    queryKey: ["owner-statement-print", id, token],
    queryFn: async () => {
      if (!token) {
        router.push("/owner/login");
        return null;
      }
      const res = await fetch(
        `${API_BASE}/owner/statements/${encodeURIComponent(id)}`,
        { headers: { "x-owner-token": token } }
      );
      if (res.status === 401) {
        localStorage.removeItem("owner_token");
        router.push("/owner/login");
        return null;
      }
      return (await res.json()) as Record<string, unknown>;
    },
    enabled: Boolean(token),
    retry: false,
  });

  const statement = statementData ?? null;

  const collections = useMemo(
    () =>
      statement
        ? ((statement.collections ?? []) as Record<string, unknown>[]).map(
            (c) => ({
              id: asString(c.id),
              label: asString(c.label) || asString(c.due_date),
              amount: asNumber(c.amount),
            })
          )
        : [],
    [statement]
  );

  const expenses = useMemo(
    () =>
      statement
        ? ((statement.expenses ?? []) as Record<string, unknown>[]).map(
            (e) => ({
              id: asString(e.id),
              label: asString(e.description) || asString(e.expense_date),
              amount: asNumber(e.amount),
            })
          )
        : [],
    [statement]
  );

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="animate-pulse text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!statement) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Statement not found.</p>
      </div>
    );
  }

  const currency = asString(statement.currency) || "PYG";
  const locale = "es-PY";

  return (
    <div>
      <div className="no-print mx-auto mb-4 flex max-w-3xl justify-between px-8 pt-4">
        <Button
          onClick={() => router.push("/owner/statements")}
          size="sm"
          variant="outline"
        >
          Volver
        </Button>
        <Button onClick={() => window.print()} size="sm">
          Imprimir
        </Button>
      </div>
      <StatementPrintView
        collections={collections}
        currency={currency}
        expenses={expenses}
        generatedAt={new Date().toLocaleDateString(locale)}
        locale={locale}
        netPayout={asNumber(statement.net_payout)}
        orgName={asString(statement.organization_name)}
        periodLabel={
          asString(statement.period_label) || asString(statement.month)
        }
        totalExpenses={asNumber(statement.total_expenses)}
        totalRevenue={asNumber(statement.total_revenue)}
      />
    </div>
  );
}
