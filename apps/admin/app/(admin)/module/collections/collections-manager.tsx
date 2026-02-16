"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useOptimistic, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createCollectionAction,
  generatePaymentLinkAction,
  markCollectionPaidAction,
} from "@/app/(admin)/module/collections/actions";
import { Button } from "@/components/ui/button";
import { type DataTableRow } from "@/components/ui/data-table";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusLabel(value: string, isEn: boolean): string {
  const normalized = value.trim().toLowerCase();
  if (isEn) return normalized || "unknown";

  if (normalized === "scheduled") return "Programado";
  if (normalized === "pending") return "Pendiente";
  if (normalized === "paid") return "Pagado";
  if (normalized === "late") return "Atrasado";
  if (normalized === "waived") return "Exonerado";

  return normalized || "desconocido";
}

function overdueDays(dueDate: string, status: string): number {
  if (status.trim().toLowerCase() === "paid") return 0;
  if (!ISO_DATE_RE.test(dueDate)) return 0;

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const [year, month, day] = dueDate.split("-").map(Number);
  const dueUtc = Date.UTC(year, month - 1, day);
  const diff = Math.floor((todayUtc - dueUtc) / 86_400_000);
  return Math.max(diff, 0);
}

function isCurrentMonth(dateStr: string): boolean {
  if (!ISO_DATE_RE.test(dateStr)) return false;
  const now = new Date();
  const [year, month] = dateStr.split("-").map(Number);
  return year === now.getFullYear() && month === now.getMonth() + 1;
}

type CollectionRow = DataTableRow & {
  id: string;
  status: string;
  status_label: string;
  paid_at: string | null;
  overdue_days: number;
  amount: number;
  currency: string;
  due_date: string;
};

type SummaryByCurrency = {
  outstanding: number;
  overdue: number;
  collectedThisMonth: number;
  totalThisMonth: number;
};

function useReceiptUpload(orgId: string) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [uploading, setUploading] = useState(false);

  const upload = async (
    file: File | null,
    onSuccess: (publicUrl: string) => void
  ) => {
    if (!file || !orgId) return;
    setUploading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const safeName = file.name.replaceAll(/[^\w.-]+/g, "-");
      const key = `${orgId}/collections/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(key, file, { upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      const { data } = supabase.storage.from("receipts").getPublicUrl(key);
      if (!data.publicUrl) throw new Error("Could not resolve public URL.");
      onSuccess(data.publicUrl);
      toast.success(isEn ? "Receipt uploaded" : "Comprobante subido");
    } catch (err) {
      toast.error(
        isEn ? "Receipt upload failed" : "Fallo la subida del comprobante",
        { description: err instanceof Error ? err.message : String(err) }
      );
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
}

export function CollectionsManager({
  orgId,
  collections,
  leases,
}: {
  orgId: string;
  collections: Record<string, unknown>[];
  leases: Record<string, unknown>[];
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
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "aging">("list");
  const { upload, uploading } = useReceiptUpload(orgId);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const rows = useMemo<CollectionRow[]>(() => {
    return collections.map((row) => {
      const due_date = asString(row.due_date).trim();
      const status = asString(row.status).trim();
      return {
        id: asString(row.id).trim(),
        lease_id: asString(row.lease_id).trim(),
        tenant_full_name: asString(row.tenant_full_name).trim() || null,
        status,
        status_label: statusLabel(status, isEn),
        due_date,
        overdue_days: overdueDays(due_date, status),
        amount: asNumber(row.amount),
        currency: asString(row.currency).trim().toUpperCase() || "PYG",
        payment_method: asString(row.payment_method).trim() || null,
        payment_reference: asString(row.payment_reference).trim() || null,
        paid_at: asString(row.paid_at).trim() || null,
        lease_status: asString(row.lease_status).trim() || null,
      } satisfies CollectionRow;
    });
  }, [collections, isEn]);

  // Summary cards data
  const summaries = useMemo(() => {
    const byCurrency = new Map<string, SummaryByCurrency>();

    const ensure = (cur: string): SummaryByCurrency => {
      let s = byCurrency.get(cur);
      if (!s) {
        s = { outstanding: 0, overdue: 0, collectedThisMonth: 0, totalThisMonth: 0 };
        byCurrency.set(cur, s);
      }
      return s;
    };

    const unpaidStatuses = new Set(["scheduled", "pending", "late"]);
    const todayDate = new Date();
    const todayUtc = Date.UTC(
      todayDate.getUTCFullYear(),
      todayDate.getUTCMonth(),
      todayDate.getUTCDate()
    );

    for (const row of rows) {
      const s = ensure(row.currency);
      const statusNorm = row.status.toLowerCase();

      if (unpaidStatuses.has(statusNorm)) {
        s.outstanding += row.amount;

        if (ISO_DATE_RE.test(row.due_date)) {
          const [y, m, d] = row.due_date.split("-").map(Number);
          const dueUtc = Date.UTC(y, m - 1, d);
          if (dueUtc < todayUtc) {
            s.overdue += row.amount;
          }
        }
      }

      const paidAt = row.paid_at || row.due_date;
      if (statusNorm === "paid" && isCurrentMonth(paidAt)) {
        s.collectedThisMonth += row.amount;
      }

      if (isCurrentMonth(row.due_date)) {
        s.totalThisMonth += 1;
        if (statusNorm === "paid") {
          // counted above
        }
      }
    }

    // Collection rate this month
    let paidThisMonth = 0;
    let totalThisMonth = 0;
    for (const row of rows) {
      if (isCurrentMonth(row.due_date)) {
        totalThisMonth++;
        if (row.status.toLowerCase() === "paid") paidThisMonth++;
      }
    }
    const collectionRate =
      totalThisMonth > 0 ? paidThisMonth / totalThisMonth : 0;

    return { byCurrency, collectionRate, paidThisMonth, totalThisMonth };
  }, [rows]);

  const [optimisticRows, queueOptimisticRowUpdate] = useOptimistic(
    rows,
    (
      currentRows,
      action:
        | { type: "mark-paid"; collectionId: string; paidAt: string }
        | { type: "set-status"; collectionId: string; status: string }
    ) => {
      return currentRows.map((row) => {
        if (row.id !== action.collectionId) return row;
        if (action.type === "mark-paid") {
          return {
            ...row,
            status: "paid",
            status_label: statusLabel("paid", isEn),
            paid_at: action.paidAt,
            overdue_days: 0,
          };
        }
        return {
          ...row,
          status: action.status,
          status_label: statusLabel(action.status, isEn),
        };
      });
    }
  );

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "due_date",
        header: isEn ? "Due date" : "Vencimiento",
        cell: ({ row, getValue }) => {
          const due = asString(getValue());
          const days = asNumber(row.original.overdue_days);
          return (
            <div className="space-y-1">
              <p>{due || "-"}</p>
              {days > 0 ? (
                <StatusBadge
                  className="text-[11px]"
                  label={isEn ? `${days}d overdue` : `${days}d atrasado`}
                  tone="danger"
                  value="late"
                />
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "tenant_full_name",
        header: isEn ? "Tenant" : "Inquilino",
        cell: ({ row, getValue }) => {
          const tenant = asString(getValue()).trim() || "-";
          const leaseId = asString(row.original.lease_id).trim();
          return (
            <div className="space-y-1">
              <p className="font-medium">{tenant}</p>
              <p className="font-mono text-muted-foreground text-xs">
                {leaseId}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "status_label",
        header: isEn ? "Status" : "Estado",
        cell: ({ row, getValue }) => {
          const value = asString(getValue());
          const raw = asString(row.original.status).trim().toLowerCase();
          return <StatusBadge label={value} value={raw} />;
        },
      },
      {
        accessorKey: "amount",
        header: isEn ? "Amount" : "Monto",
        cell: ({ row, getValue }) =>
          formatCurrency(
            asNumber(getValue()),
            asString(row.original.currency),
            locale
          ),
      },
      {
        accessorKey: "payment_method",
        header: isEn ? "Payment method" : "Metodo de pago",
      },
      {
        accessorKey: "paid_at",
        header: isEn ? "Paid at" : "Pagado en",
      },
    ];
  }, [isEn, locale]);

  const leaseOptions = useMemo(() => {
    return leases
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        const tenant = asString(row.tenant_full_name).trim();
        const property = asString(row.property_name).trim();
        const unit = asString(row.unit_name).trim();
        return {
          id,
          label: [tenant || id, property, unit].filter(Boolean).join(" · "),
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [leases]);

  const handleReceiptFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      upload(file, (url) => setReceiptUrl(url));
    },
    [upload]
  );

  // CSV export
  const exportCsv = useCallback(() => {
    const headers = ["due_date", "tenant", "status", "amount", "currency", "payment_method", "paid_at"];
    const csvRows = [headers.join(",")];
    for (const row of optimisticRows) {
      csvRows.push(
        [
          row.due_date,
          asString(row.tenant_full_name).replace(/,/g, " "),
          row.status,
          row.amount,
          row.currency,
          asString(row.payment_method),
          row.paid_at ?? "",
        ].join(",")
      );
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collections-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [optimisticRows, today]);

  type AgingRow = {
    tenant: string;
    leaseId: string;
    currency: string;
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90plus: number;
    total: number;
  };

  const agingRows = useMemo<AgingRow[]>(() => {
    const unpaid = new Set(["scheduled", "pending", "late"]);
    const map = new Map<string, AgingRow>();

    for (const row of optimisticRows) {
      if (!unpaid.has(row.status.toLowerCase())) continue;
      const key = `${asString(row.lease_id)}|${row.currency}`;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          tenant: asString(row.tenant_full_name) || asString(row.lease_id),
          leaseId: asString(row.lease_id),
          currency: row.currency,
          current: 0,
          d1_30: 0,
          d31_60: 0,
          d61_90: 0,
          d90plus: 0,
          total: 0,
        };
        map.set(key, entry);
      }
      const days = row.overdue_days;
      if (days <= 0) entry.current += row.amount;
      else if (days <= 30) entry.d1_30 += row.amount;
      else if (days <= 60) entry.d31_60 += row.amount;
      else if (days <= 90) entry.d61_90 += row.amount;
      else entry.d90plus += row.amount;
      entry.total += row.amount;
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [optimisticRows]);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from(summaries.byCurrency.entries()).map(([cur, s]) => (
          <StatCard
            key={`outstanding-${cur}`}
            label={`${isEn ? "Outstanding" : "Pendiente"} (${cur})`}
            value={formatCurrency(s.outstanding, cur, locale)}
            helper={
              s.overdue > 0
                ? `${isEn ? "Overdue" : "Vencido"}: ${formatCurrency(s.overdue, cur, locale)}`
                : isEn
                  ? "No overdue"
                  : "Sin vencidos"
            }
          />
        ))}
        {Array.from(summaries.byCurrency.entries()).map(([cur, s]) => (
          <StatCard
            key={`collected-${cur}`}
            label={`${isEn ? "Collected this month" : "Cobrado este mes"} (${cur})`}
            value={formatCurrency(s.collectedThisMonth, cur, locale)}
          />
        ))}
        <StatCard
          label={isEn ? "Collection rate" : "Tasa de cobro"}
          value={`${(summaries.collectionRate * 100).toFixed(1)}%`}
          helper={`${summaries.paidThisMonth}/${summaries.totalThisMonth} ${isEn ? "this month" : "este mes"}`}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground text-sm">
            {optimisticRows.length} {isEn ? "collections" : "cobros"}
          </p>
          <div className="flex rounded-md border">
            <button
              className={cn(
                "px-3 py-1 text-xs font-medium transition-colors",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              )}
              onClick={() => setViewMode("list")}
              type="button"
            >
              {isEn ? "List" : "Lista"}
            </button>
            <button
              className={cn(
                "px-3 py-1 text-xs font-medium transition-colors",
                viewMode === "aging"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              )}
              onClick={() => setViewMode("aging")}
              type="button"
            >
              {isEn ? "Aging" : "Antigüedad"}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportCsv} type="button" variant="outline">
            {isEn ? "Export CSV" : "Exportar CSV"}
          </Button>
          <Button onClick={() => setOpen(true)} type="button">
            <Icon icon={PlusSignIcon} size={16} />
            {isEn ? "New collection" : "Nuevo cobro"}
          </Button>
        </div>
      </div>

      {viewMode === "aging" ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">
                  {isEn ? "Tenant" : "Inquilino"}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {isEn ? "Current" : "Vigente"}
                </th>
                <th className="px-3 py-2 text-right font-medium">1-30d</th>
                <th className="px-3 py-2 text-right font-medium">31-60d</th>
                <th className="px-3 py-2 text-right font-medium">61-90d</th>
                <th className="px-3 py-2 text-right font-medium">90+d</th>
                <th className="px-3 py-2 text-right font-medium">
                  {isEn ? "Total" : "Total"}
                </th>
              </tr>
            </thead>
            <tbody>
              {agingRows.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-6 text-center text-muted-foreground"
                    colSpan={7}
                  >
                    {isEn
                      ? "No outstanding collections"
                      : "Sin cobros pendientes"}
                  </td>
                </tr>
              ) : (
                agingRows.map((r) => (
                  <tr
                    className="border-b last:border-0"
                    key={`${r.leaseId}-${r.currency}`}
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.tenant}</p>
                      <p className="text-muted-foreground text-xs">
                        {r.currency}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.current > 0
                        ? formatCurrency(r.current, r.currency, locale)
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.d1_30 > 0
                        ? formatCurrency(r.d1_30, r.currency, locale)
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.d31_60 > 0
                        ? formatCurrency(r.d31_60, r.currency, locale)
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.d61_90 > 0
                        ? formatCurrency(r.d61_90, r.currency, locale)
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">
                      {r.d90plus > 0
                        ? formatCurrency(r.d90plus, r.currency, locale)
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatCurrency(r.total, r.currency, locale)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {viewMode === "list" ? (
        <NotionDataTable
        columns={columns}
        data={optimisticRows}
        hideSearch
        isEn={isEn}
        renderRowActions={(row) => {
          const id = asString(row.id);
          const status = asString(row.status).trim().toLowerCase();
          if (status === "paid") {
            return (
              <StatusBadge label={isEn ? "Paid" : "Pagado"} value="paid" />
            );
          }

          return (
            <div className="flex items-center gap-2">
              <Form action={generatePaymentLinkAction}>
                <input name="collection_id" type="hidden" value={id} />
                <input name="next" type="hidden" value={nextPath} />
                <Button size="sm" type="submit" variant="outline">
                  {isEn ? "Payment link" : "Link de pago"}
                </Button>
              </Form>
              <Button
                onClick={() => {
                  setMarkPaidId(id);
                  setReceiptUrl("");
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                {isEn ? "Mark paid" : "Marcar pagado"}
              </Button>
            </div>
          );
        }}
      />
      ) : null}

      {/* Mark paid sheet */}
      <Sheet
        contentClassName="max-w-md"
        description={
          isEn
            ? "Record payment details and attach a receipt."
            : "Registra los detalles de pago y adjunta un comprobante."
        }
        onOpenChange={(next) => {
          if (!next) setMarkPaidId(null);
        }}
        open={markPaidId !== null}
        title={isEn ? "Mark as paid" : "Marcar como pagado"}
      >
        <Form
          action={markCollectionPaidAction}
          className="space-y-4"
          onSubmit={() => {
            if (markPaidId) {
              queueOptimisticRowUpdate({
                type: "mark-paid",
                collectionId: markPaidId,
                paidAt: new Date().toISOString(),
              });
            }
            setMarkPaidId(null);
          }}
        >
          <input
            name="collection_id"
            type="hidden"
            value={markPaidId ?? ""}
          />
          <input name="next" type="hidden" value={nextPath} />
          <input name="receipt_url" type="hidden" value={receiptUrl} />

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Payment method" : "Metodo de pago"}</span>
            <Select defaultValue="bank_transfer" name="payment_method">
              <option value="bank_transfer">
                {isEn ? "Bank transfer" : "Transferencia bancaria"}
              </option>
              <option value="cash">{isEn ? "Cash" : "Efectivo"}</option>
              <option value="qr">QR</option>
              <option value="other">{isEn ? "Other" : "Otro"}</option>
            </Select>
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Payment reference" : "Referencia de pago"}</span>
            <Input name="payment_reference" placeholder={isEn ? "Transfer #, receipt code..." : "# transferencia, codigo..."} />
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Paid at" : "Fecha de pago"}</span>
            <DatePicker
              defaultValue={today}
              locale={locale}
              name="paid_at"
            />
          </label>

          <div className="space-y-1 text-sm">
            <span>{isEn ? "Receipt" : "Comprobante"}</span>
            <div
              className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 px-4 py-4 text-sm transition-colors hover:border-muted-foreground/50"
              onClick={() => receiptInputRef.current?.click()}
            >
              <p className="text-muted-foreground">
                {uploading
                  ? isEn
                    ? "Uploading..."
                    : "Subiendo..."
                  : receiptUrl
                    ? isEn
                      ? "Receipt attached"
                      : "Comprobante adjunto"
                    : isEn
                      ? "Click to upload receipt"
                      : "Clic para subir comprobante"}
              </p>
            </div>
            <input
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleReceiptFile}
              ref={receiptInputRef}
              type="file"
            />
            {receiptUrl ? (
              <p className="truncate text-muted-foreground text-xs">
                {receiptUrl.split("/").pop()}
              </p>
            ) : null}
          </div>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Notes" : "Notas"}</span>
            <Textarea name="notes" rows={2} />
          </label>

          <div className="flex justify-end">
            <Button disabled={uploading} type="submit">
              {isEn ? "Confirm payment" : "Confirmar pago"}
            </Button>
          </div>
        </Form>
      </Sheet>

      {/* Create collection sheet */}
      <Sheet
        contentClassName="max-w-xl"
        description={
          isEn
            ? "Create a scheduled collection record linked to a lease."
            : "Crea un registro de cobro programado vinculado a un contrato."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New collection" : "Nuevo cobro"}
      >
        <Form action={createCollectionAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />
          <input name="next" type="hidden" value={nextPath} />

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Lease" : "Contrato"}</span>
            <Select defaultValue="" name="lease_id" required>
              <option value="">
                {isEn ? "Select lease" : "Seleccionar contrato"}
              </option>
              {leaseOptions.map((lease) => (
                <option key={lease.id} value={lease.id}>
                  {lease.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Due date" : "Fecha de vencimiento"}</span>
              <DatePicker
                defaultValue={today}
                locale={locale}
                name="due_date"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Amount" : "Monto"}</span>
              <Input min={0} name="amount" required step="0.01" type="number" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Currency" : "Moneda"}</span>
              <Select defaultValue="PYG" name="currency">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Status" : "Estado"}</span>
              <Select defaultValue="scheduled" name="status">
                <option value="scheduled">
                  {isEn ? "Scheduled" : "Programado"}
                </option>
                <option value="pending">
                  {isEn ? "Pending" : "Pendiente"}
                </option>
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Payment method" : "Metodo de pago"}</span>
              <Input
                defaultValue="bank_transfer"
                name="payment_method"
                placeholder="bank_transfer"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Reference" : "Referencia"}</span>
              <Input name="payment_reference" />
            </label>
          </div>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Notes" : "Notas"}</span>
            <Textarea name="notes" rows={3} />
          </label>

          <div className="flex justify-end">
            <Button type="submit">
              {isEn ? "Create collection" : "Crear cobro"}
            </Button>
          </div>
        </Form>
      </Sheet>
    </div>
  );
}
