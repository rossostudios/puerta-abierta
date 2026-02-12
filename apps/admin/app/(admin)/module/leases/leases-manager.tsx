"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useOptimistic, useState } from "react";

import {
  createLeaseAction,
  setLeaseStatusAction,
} from "@/app/(admin)/module/leases/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canActivate(status: string): boolean {
  return status.trim().toLowerCase() === "draft";
}

function canTerminate(status: string): boolean {
  return ["active", "delinquent"].includes(status.trim().toLowerCase());
}

function canComplete(status: string): boolean {
  return status.trim().toLowerCase() === "terminated";
}

function statusLabel(value: string, isEn: boolean): string {
  const normalized = value.trim().toLowerCase();
  if (isEn) return normalized || "unknown";

  if (normalized === "draft") return "Borrador";
  if (normalized === "active") return "Activo";
  if (normalized === "delinquent") return "Moroso";
  if (normalized === "terminated") return "Terminado";
  if (normalized === "completed") return "Completado";

  return normalized || "desconocido";
}

type LeaseRow = DataTableRow & {
  id: string;
  lease_status: string;
  lease_status_label: string;
};

export function LeasesManager({
  orgId,
  leases,
  properties,
  units,
}: {
  orgId: string;
  leases: Record<string, unknown>[];
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
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const rows = useMemo<LeaseRow[]>(() => {
    return leases.map((row) => {
      const status = asString(row.lease_status).trim();
      return {
        id: asString(row.id).trim(),
        tenant_full_name: asString(row.tenant_full_name).trim(),
        tenant_email: asString(row.tenant_email).trim() || null,
        tenant_phone_e164: asString(row.tenant_phone_e164).trim() || null,
        lease_status: status,
        lease_status_label: statusLabel(status, isEn),
        property_name: asString(row.property_name).trim() || null,
        unit_name: asString(row.unit_name).trim() || null,
        starts_on: asString(row.starts_on).trim(),
        ends_on: asString(row.ends_on).trim() || null,
        currency: asString(row.currency).trim().toUpperCase() || "PYG",
        monthly_rent: asNumber(row.monthly_rent),
        total_move_in: asNumber(row.total_move_in),
        monthly_recurring_total: asNumber(row.monthly_recurring_total),
        collection_count: asNumber(row.collection_count),
        collection_paid_count: asNumber(row.collection_paid_count),
      } satisfies LeaseRow;
    });
  }, [leases, isEn]);

  const [optimisticRows, queueOptimisticRowUpdate] = useOptimistic(
    rows,
    (
      currentRows,
      action: { type: "set-status"; leaseId: string; nextStatus: string }
    ) => {
      return currentRows.map((row) => {
        if (row.id !== action.leaseId) return row;
        return {
          ...row,
          lease_status: action.nextStatus,
          lease_status_label: statusLabel(action.nextStatus, isEn),
        };
      });
    }
  );

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "tenant_full_name",
        header: isEn ? "Tenant" : "Inquilino",
        cell: ({ row, getValue }) => {
          const name = asString(getValue());
          const email = asString(row.original.tenant_email).trim();
          const phone = asString(row.original.tenant_phone_e164).trim();
          return (
            <div className="space-y-1">
              <p className="font-medium">{name}</p>
              {email ? (
                <p className="text-muted-foreground text-xs">{email}</p>
              ) : null}
              {phone ? (
                <p className="text-muted-foreground text-xs">{phone}</p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "lease_status_label",
        header: isEn ? "Status" : "Estado",
        cell: ({ row, getValue }) => (
          <StatusBadge
            label={asString(getValue())}
            value={asString(row.original.lease_status)}
          />
        ),
      },
      {
        accessorKey: "property_name",
        header: isEn ? "Property / Unit" : "Propiedad / Unidad",
        cell: ({ row }) => {
          const property = asString(row.original.property_name).trim();
          const unit = asString(row.original.unit_name).trim();
          return (
            <p className="text-sm">
              {[property, unit].filter(Boolean).join(" · ") || "-"}
            </p>
          );
        },
      },
      {
        accessorKey: "starts_on",
        header: isEn ? "Start" : "Inicio",
      },
      {
        accessorKey: "monthly_recurring_total",
        header: isEn ? "Monthly recurring" : "Mensual recurrente",
        cell: ({ row, getValue }) =>
          formatCurrency(
            asNumber(getValue()),
            asString(row.original.currency),
            locale
          ),
      },
      {
        accessorKey: "collection_paid_count",
        header: isEn ? "Collections paid" : "Cobros pagados",
        cell: ({ row, getValue }) => {
          const paid = asNumber(getValue());
          const total = asNumber(row.original.collection_count);
          return `${paid}/${total}`;
        },
      },
    ];
  }, [isEn, locale]);

  const propertyOptions = useMemo(() => {
    return properties
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        return {
          id,
          label: asString(row.name).trim() || id,
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [properties]);

  const unitOptions = useMemo(() => {
    return units
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        const unitName = asString(row.name).trim();
        const propertyName = asString(row.property_name).trim();
        return {
          id,
          label: [propertyName, unitName || id].filter(Boolean).join(" · "),
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [units]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {optimisticRows.length} {isEn ? "leases" : "contratos"}
        </p>
        <Button onClick={() => setOpen(true)} type="button">
          <Icon icon={PlusSignIcon} size={16} />
          {isEn ? "New lease" : "Nuevo contrato"}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={optimisticRows}
        renderRowActions={(row) => {
          const id = asString(row.id);
          const status = asString(row.lease_status);

          return (
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
                href="/module/collections"
              >
                {isEn ? "Collections" : "Cobros"}
              </Link>

              {canActivate(status) ? (
                <Form
                  action={setLeaseStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      leaseId: id,
                      nextStatus: "active",
                    })
                  }
                >
                  <input name="lease_id" type="hidden" value={id} />
                  <input name="lease_status" type="hidden" value="active" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "Activate" : "Activar"}
                  </Button>
                </Form>
              ) : null}

              {canTerminate(status) ? (
                <Form
                  action={setLeaseStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      leaseId: id,
                      nextStatus: "terminated",
                    })
                  }
                >
                  <input name="lease_id" type="hidden" value={id} />
                  <input name="lease_status" type="hidden" value="terminated" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "Terminate" : "Terminar"}
                  </Button>
                </Form>
              ) : null}

              {canComplete(status) ? (
                <Form
                  action={setLeaseStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      leaseId: id,
                      nextStatus: "completed",
                    })
                  }
                >
                  <input name="lease_id" type="hidden" value={id} />
                  <input name="lease_status" type="hidden" value="completed" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="secondary">
                    {isEn ? "Complete" : "Completar"}
                  </Button>
                </Form>
              ) : null}
            </div>
          );
        }}
      />

      <Sheet
        contentClassName="max-w-2xl"
        description={
          isEn
            ? "Create a lease and optionally generate the first collection record."
            : "Crea un contrato y opcionalmente genera el primer registro de cobro."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New lease" : "Nuevo contrato"}
      >
        <Form action={createLeaseAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />
          <input name="next" type="hidden" value={nextPath} />

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Tenant full name" : "Nombre completo"}</span>
              <Input name="tenant_full_name" required />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Email" : "Correo"}</span>
              <Input name="tenant_email" type="email" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Phone" : "Teléfono"}</span>
              <Input name="tenant_phone_e164" placeholder="+595..." />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Start date" : "Fecha de inicio"}</span>
              <DatePicker
                defaultValue={today}
                locale={locale}
                name="starts_on"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "End date" : "Fecha de término"}</span>
              <DatePicker locale={locale} name="ends_on" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Property" : "Propiedad"}</span>
              <Select defaultValue="" name="property_id">
                <option value="">
                  {isEn ? "Select property" : "Seleccionar"}
                </option>
                {propertyOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Unit" : "Unidad"}</span>
              <Select defaultValue="" name="unit_id">
                <option value="">{isEn ? "Select unit" : "Seleccionar"}</option>
                {unitOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Currency" : "Moneda"}</span>
              <Select defaultValue="PYG" name="currency">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Lease status" : "Estado del contrato"}</span>
              <Select defaultValue="active" name="lease_status">
                <option value="draft">{isEn ? "Draft" : "Borrador"}</option>
                <option value="active">{isEn ? "Active" : "Activo"}</option>
              </Select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Monthly rent" : "Alquiler mensual"}</span>
              <Input
                min={0}
                name="monthly_rent"
                required
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>IVA</span>
              <Input min={0} name="tax_iva" step="0.01" type="number" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Service fee" : "Tarifa de servicio"}</span>
              <Input
                min={0}
                name="service_fee_flat"
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Security deposit" : "Depósito de garantía"}</span>
              <Input
                min={0}
                name="security_deposit"
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Guarantee option fee" : "Costo de garantía"}</span>
              <Input
                min={0}
                name="guarantee_option_fee"
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Platform fee" : "Tarifa plataforma"}</span>
              <Input min={0} name="platform_fee" step="0.01" type="number" />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "Generate first collection" : "Generar primer cobro"}
              </span>
              <Select defaultValue="1" name="generate_first_collection">
                <option value="1">{isEn ? "Yes" : "Sí"}</option>
                <option value="0">{isEn ? "No" : "No"}</option>
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "First collection due" : "Vencimiento primer cobro"}
              </span>
              <DatePicker
                defaultValue={today}
                locale={locale}
                name="first_collection_due_date"
              />
            </label>
          </div>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Notes" : "Notas"}</span>
            <Textarea name="notes" rows={3} />
          </label>

          <div className="flex justify-end">
            <Button type="submit">
              {isEn ? "Create lease" : "Crear contrato"}
            </Button>
          </div>
        </Form>
      </Sheet>
    </div>
  );
}
