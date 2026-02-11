"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  createCollectionAction,
  markCollectionPaidAction,
} from "@/app/(admin)/module/collections/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";

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
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const rows = useMemo(() => {
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
      } satisfies DataTableRow;
    });
  }, [collections, isEn]);

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
                <Badge className="text-[11px]" variant="outline">
                  {isEn ? `${days}d overdue` : `${days}d atrasado`}
                </Badge>
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
          const variant = raw === "paid" ? "secondary" : "outline";
          return <Badge variant={variant}>{value}</Badge>;
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
        header: isEn ? "Payment method" : "Método de pago",
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {rows.length} {isEn ? "collections" : "cobros"}
        </p>
        <Button onClick={() => setOpen(true)} type="button">
          <Icon icon={PlusSignIcon} size={16} />
          {isEn ? "New collection" : "Nuevo cobro"}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        renderRowActions={(row) => {
          const id = asString(row.id);
          const status = asString(row.status).trim().toLowerCase();
          if (status === "paid") {
            return (
              <Badge className="text-[11px]" variant="secondary">
                {isEn ? "Paid" : "Pagado"}
              </Badge>
            );
          }

          return (
            <form action={markCollectionPaidAction}>
              <input name="collection_id" type="hidden" value={id} />
              <input
                name="payment_method"
                type="hidden"
                value="bank_transfer"
              />
              <input
                name="paid_at"
                type="hidden"
                value={new Date().toISOString()}
              />
              <input name="next" type="hidden" value={nextPath} />
              <Button size="sm" type="submit" variant="secondary">
                {isEn ? "Mark paid" : "Marcar pagado"}
              </Button>
            </form>
          );
        }}
      />

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
        <form action={createCollectionAction} className="space-y-4">
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
              <Input
                defaultValue={today}
                name="due_date"
                required
                type="date"
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
              <span>{isEn ? "Payment method" : "Método de pago"}</span>
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
        </form>
      </Sheet>
    </div>
  );
}
