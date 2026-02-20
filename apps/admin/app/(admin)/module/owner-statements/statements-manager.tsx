"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, useTransition } from "react";

import {
  approveStatementAction,
  createStatementAction,
  finalizeStatementAction,
  requestApprovalAction,
} from "@/app/(admin)/module/owner-statements/actions";
import { Button } from "@/components/ui/button";
import type { DataTableRow } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";

type StatementRow = {
  id: string;
  property_id: string | null;
  property_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  gross_revenue: number;
  operating_expenses: number;
  net_payout: number;
  status: string;
  approval_status: string;
  pdf_url: string | null;
  created_at: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim();
  return text || null;
}

function statusTone(
  status: string
): "info" | "warning" | "success" | "neutral" {
  switch (status) {
    case "draft":
      return "info";
    case "finalized":
      return "warning";
    case "sent":
      return "warning";
    case "paid":
      return "success";
    default:
      return "neutral";
  }
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

export function StatementsManager({
  orgId,
  statements,
  properties,
  units,
}: {
  orgId: string;
  statements: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  return (
    <Suspense fallback={null}>
      <StatementsManagerInner
        orgId={orgId}
        properties={properties}
        statements={statements}
        units={units}
      />
    </Suspense>
  );
}

function StatementsManagerInner({
  orgId,
  statements,
  properties,
  units,
}: {
  orgId: string;
  statements: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const suffix = searchParams.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  }, [pathname, searchParams]);

  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [, _startTransition] = useTransition();

  const propertyOptions = useMemo(() => {
    return (properties as Record<string, unknown>[])
      .map((p) => {
        const id = asString(p.id).trim();
        const name = asString(p.name).trim();
        return id ? { id, label: name || id } : null;
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [properties]);

  const unitOptions = useMemo(() => {
    return (units as Record<string, unknown>[])
      .map((u) => {
        const id = asString(u.id).trim();
        const name = asString(u.name).trim();
        const code = asString(u.code).trim();
        const propName = asString(u.property_name).trim();
        const label = [propName, code || name || id]
          .filter(Boolean)
          .join(" · ");
        return id ? { id, label: label || id } : null;
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [units]);

  const rows = useMemo<StatementRow[]>(() => {
    return (statements as Record<string, unknown>[])
      .map((row) => ({
        id: asString(row.id).trim(),
        property_id: asOptionalString(row.property_id),
        property_name: asOptionalString(row.property_name),
        unit_id: asOptionalString(row.unit_id),
        unit_name: asOptionalString(row.unit_name),
        period_start: asOptionalString(row.period_start),
        period_end: asOptionalString(row.period_end),
        currency: asString(row.currency).trim() || "PYG",
        gross_revenue: asNumber(row.gross_revenue),
        operating_expenses: asNumber(row.operating_expenses),
        net_payout: asNumber(row.net_payout),
        status: asString(row.status).trim() || "draft",
        approval_status: asString(row.approval_status).trim() || "none",
        pdf_url: asOptionalString(row.pdf_url),
        created_at: asOptionalString(row.created_at),
      }))
      .filter((row) => {
        if (!row.id) return false;
        if (statusFilter !== "all" && row.status !== statusFilter) return false;
        if (propertyFilter !== "all" && row.property_id !== propertyFilter)
          return false;
        return true;
      });
  }, [statements, statusFilter, propertyFilter]);

  const summaries = useMemo(() => {
    const total = rows.length;
    const drafts = rows.filter((r) => r.status === "draft").length;
    const totalRevenue = rows.reduce((sum, r) => sum + r.gross_revenue, 0);
    const totalPayout = rows.reduce((sum, r) => sum + r.net_payout, 0);
    return { total, drafts, totalRevenue, totalPayout };
  }, [rows]);

  function exportCsv() {
    const headers = [
      "ID",
      isEn ? "Property" : "Propiedad",
      isEn ? "Unit" : "Unidad",
      isEn ? "Period" : "Período",
      isEn ? "Status" : "Estado",
      isEn ? "Gross Revenue" : "Ingresos Brutos",
      isEn ? "Expenses" : "Gastos",
      isEn ? "Net Payout" : "Pago Neto",
      isEn ? "Currency" : "Moneda",
    ];

    const csvRows = rows.map((r) => [
      r.id,
      r.property_name ?? "",
      r.unit_name ?? "",
      `${r.period_start ?? ""}–${r.period_end ?? ""}`,
      r.status,
      r.gross_revenue,
      r.operating_expenses,
      r.net_payout,
      r.currency,
    ]);

    const content = [headers, ...csvRows]
      .map((row) =>
        row
          .map((cell) => {
            const str = String(cell);
            return str.includes(",") || str.includes('"')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payout-statements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns = useMemo<ColumnDef<DataTableRow>[]>(
    () => [
      {
        accessorKey: "property_name",
        header: isEn ? "Property" : "Propiedad",
        cell: ({ getValue, row }) => {
          const prop = String(getValue() ?? "");
          const unit = String((row.original as StatementRow).unit_name ?? "");
          return (
            <span className="font-medium">
              {prop || "—"}
              {unit ? ` · ${unit}` : ""}
            </span>
          );
        },
      },
      {
        accessorKey: "period_start",
        header: isEn ? "Period" : "Período",
        cell: ({ row }) => {
          const data = row.original as StatementRow;
          const start = formatDate(data.period_start, locale);
          const end = formatDate(data.period_end, locale);
          return (
            <span className="text-sm">
              {start} – {end}
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        header: isEn ? "Status" : "Estado",
        cell: ({ getValue }) => {
          const status = String(getValue());
          return <StatusBadge tone={statusTone(status)} value={status} />;
        },
      },
      {
        accessorKey: "gross_revenue",
        header: isEn ? "Revenue" : "Ingresos",
        cell: ({ row }) => {
          const data = row.original as StatementRow;
          return (
            <span className="tabular-nums">
              {formatCurrency(data.gross_revenue, data.currency, locale)}
            </span>
          );
        },
      },
      {
        accessorKey: "operating_expenses",
        header: isEn ? "Expenses" : "Gastos",
        cell: ({ row }) => {
          const data = row.original as StatementRow;
          return (
            <span className="text-muted-foreground tabular-nums">
              {formatCurrency(data.operating_expenses, data.currency, locale)}
            </span>
          );
        },
      },
      {
        accessorKey: "net_payout",
        header: isEn ? "Net Payout" : "Pago Neto",
        cell: ({ row }) => {
          const data = row.original as StatementRow;
          return (
            <span className="font-semibold tabular-nums">
              {formatCurrency(data.net_payout, data.currency, locale)}
            </span>
          );
        },
      },
    ],
    [isEn, locale]
  );

  function renderRowActions(row: DataTableRow) {
    const data = row as unknown as StatementRow;

    return (
      <div className="flex items-center gap-1">
        {data.status === "draft" && data.approval_status === "none" ? (
          <Form action={requestApprovalAction}>
            <input name="statement_id" type="hidden" value={data.id} />
            <input name="next" type="hidden" value={nextPath} />
            <Button size="sm" type="submit" variant="outline">
              {isEn ? "Request Approval" : "Solicitar Aprobación"}
            </Button>
          </Form>
        ) : null}
        {data.status === "draft" && data.approval_status === "pending" ? (
          <Form action={approveStatementAction}>
            <input name="statement_id" type="hidden" value={data.id} />
            <input name="next" type="hidden" value={nextPath} />
            <Button size="sm" type="submit" variant="outline">
              {isEn ? "Approve" : "Aprobar"}
            </Button>
          </Form>
        ) : null}
        {data.status === "draft" && data.approval_status === "approved" ? (
          <Form action={finalizeStatementAction}>
            <input name="statement_id" type="hidden" value={data.id} />
            <input name="next" type="hidden" value={nextPath} />
            <Button size="sm" type="submit" variant="secondary">
              {isEn ? "Finalize" : "Finalizar"}
            </Button>
          </Form>
        ) : null}
        {data.pdf_url ? (
          <a
            className="inline-flex h-8 items-center rounded-md border px-2.5 text-sm hover:bg-muted"
            href={data.pdf_url}
            rel="noopener noreferrer"
            target="_blank"
          >
            PDF
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Total payout statements" : "Total liquidaciones"}
          </p>
          <p className="font-semibold text-2xl tabular-nums">
            {summaries.total}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Drafts" : "Borradores"}
          </p>
          <p className="font-semibold text-2xl tabular-nums">
            {summaries.drafts}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Total revenue" : "Ingresos totales"}
          </p>
          <p className="font-semibold text-2xl tabular-nums">
            {formatCurrency(summaries.totalRevenue, "PYG", locale)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Total payouts" : "Pagos totales"}
          </p>
          <p className="font-semibold text-2xl tabular-nums">
            {formatCurrency(summaries.totalPayout, "PYG", locale)}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            onChange={(e) => setStatusFilter(e.target.value)}
            value={statusFilter}
          >
            <option value="all">{isEn ? "All statuses" : "Todos"}</option>
            <option value="draft">{isEn ? "Draft" : "Borrador"}</option>
            <option value="finalized">
              {isEn ? "Finalized" : "Finalizado"}
            </option>
            <option value="sent">{isEn ? "Sent" : "Enviado"}</option>
            <option value="paid">{isEn ? "Paid" : "Pagado"}</option>
          </Select>
          <Select
            onChange={(e) => setPropertyFilter(e.target.value)}
            value={propertyFilter}
          >
            <option value="all">
              {isEn ? "All properties" : "Todas las propiedades"}
            </option>
            {propertyOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportCsv} type="button" variant="outline">
            {isEn ? "Export CSV" : "Exportar CSV"}
          </Button>
          <Button
            onClick={() => setOpen(true)}
            type="button"
            variant="secondary"
          >
            <Icon icon={PlusSignIcon} size={16} />
            {isEn ? "New payout statement" : "Nueva liquidación"}
          </Button>
        </div>
      </div>

      <NotionDataTable
        columns={columns}
        data={rows}
        renderRowActions={renderRowActions}
        rowActionsHeader={isEn ? "Actions" : "Acciones"}
      />

      <Sheet
        contentClassName="max-w-xl"
        description={
          isEn
            ? "Generate a new payout statement for a property and period."
            : "Genera una nueva liquidación para una propiedad y período."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New payout statement" : "Nueva liquidación"}
      >
        <Form action={createStatementAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />
          <input name="next" type="hidden" value={nextPath} />

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Property" : "Propiedad"}
            </span>
            <Select defaultValue="" name="property_id" required>
              <option disabled value="">
                {isEn ? "Select a property" : "Selecciona una propiedad"}
              </option>
              {propertyOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Unit (optional)" : "Unidad (opcional)"}
            </span>
            <Select defaultValue="" name="unit_id">
              <option value="">
                {isEn ? "All units" : "Todas las unidades"}
              </option>
              {unitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-muted-foreground">
                {isEn ? "Period start" : "Inicio del período"}
              </span>
              <DatePicker locale={locale} name="period_start" />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-muted-foreground">
                {isEn ? "Period end" : "Fin del período"}
              </span>
              <DatePicker locale={locale} name="period_end" />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Currency" : "Moneda"}
            </span>
            <Select defaultValue="PYG" name="currency">
              <option value="PYG">PYG</option>
              <option value="USD">USD</option>
            </Select>
          </label>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
            <Button type="submit" variant="secondary">
              {isEn ? "Generate" : "Generar"}
            </Button>
          </div>
        </Form>
      </Sheet>
    </div>
  );
}
