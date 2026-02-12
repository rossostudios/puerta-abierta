"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  createPricingTemplateAction,
  setPricingTemplateDefaultAction,
  togglePricingTemplateActiveAction,
} from "@/app/(admin)/module/pricing/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";

type PricingTemplateRow = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

export function PricingManager({
  orgId,
  templates,
}: {
  orgId: string;
  templates: Record<string, unknown>[];
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

  const rows = useMemo(() => {
    return (templates as PricingTemplateRow[]).map((template) => {
      const lineCount = Array.isArray(template.lines)
        ? template.lines.length
        : 0;
      const currency =
        asString(template.currency).trim().toUpperCase() || "PYG";

      return {
        id: asString(template.id).trim(),
        name: asString(template.name).trim(),
        currency,
        is_default: asBoolean(template.is_default),
        is_active: asBoolean(template.is_active),
        total_move_in: asNumber(template.total_move_in),
        monthly_recurring_total: asNumber(template.monthly_recurring_total),
        line_count: lineCount,
        updated_at: asString(template.updated_at).trim() || null,
      } satisfies DataTableRow;
    });
  }, [templates]);

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: isEn ? "Template" : "Plantilla",
      },
      {
        accessorKey: "is_default",
        header: isEn ? "Default" : "Predeterminada",
        cell: ({ getValue }) => {
          const value = getValue();
          return value ? (
            <Badge className="text-[11px]" variant="secondary">
              {isEn ? "Default" : "Predeterminada"}
            </Badge>
          ) : (
            <Badge className="text-[11px]" variant="outline">
              {isEn ? "No" : "No"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "is_active",
        header: isEn ? "Status" : "Estado",
        cell: ({ getValue }) => {
          const value = getValue();
          return value ? (
            <Badge className="text-[11px]" variant="secondary">
              {isEn ? "Active" : "Activa"}
            </Badge>
          ) : (
            <Badge className="text-[11px]" variant="outline">
              {isEn ? "Inactive" : "Inactiva"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "total_move_in",
        header: isEn ? "Total move-in" : "Ingreso total",
        cell: ({ row, getValue }) => {
          const amount = asNumber(getValue());
          const currency = asString(row.original.currency).trim() || "PYG";
          return formatCurrency(amount, currency, locale);
        },
      },
      {
        accessorKey: "monthly_recurring_total",
        header: isEn ? "Monthly recurring" : "Mensual recurrente",
        cell: ({ row, getValue }) => {
          const amount = asNumber(getValue());
          const currency = asString(row.original.currency).trim() || "PYG";
          return formatCurrency(amount, currency, locale);
        },
      },
      {
        accessorKey: "line_count",
        header: isEn ? "Lines" : "Líneas",
      },
    ];
  }, [isEn, locale]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {rows.length} {isEn ? "templates" : "plantillas"}
        </p>
        <Button onClick={() => setOpen(true)} type="button">
          <Icon icon={PlusSignIcon} size={16} />
          {isEn ? "New template" : "Nueva plantilla"}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        renderRowActions={(row) => {
          const id = asString(row.id);
          const isDefault = asBoolean(row.is_default);
          const isActive = asBoolean(row.is_active);

          return (
            <div className="flex flex-wrap justify-end gap-2">
              {isDefault ? null : (
                <Form action={setPricingTemplateDefaultAction}>
                  <input name="template_id" type="hidden" value={id} />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "Set default" : "Definir"}
                  </Button>
                </Form>
              )}

              <Form action={togglePricingTemplateActiveAction}>
                <input name="template_id" type="hidden" value={id} />
                <input name="next" type="hidden" value={nextPath} />
                <input
                  name="is_active"
                  type="hidden"
                  value={isActive ? "0" : "1"}
                />
                <Button size="sm" type="submit" variant="ghost">
                  {isActive
                    ? isEn
                      ? "Deactivate"
                      : "Desactivar"
                    : isEn
                      ? "Activate"
                      : "Activar"}
                </Button>
              </Form>
            </div>
          );
        }}
      />

      <Sheet
        contentClassName="max-w-xl"
        description={
          isEn
            ? "Create a transparent move-in pricing template."
            : "Crea una plantilla transparente de costos de ingreso."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New pricing template" : "Nueva plantilla de precios"}
      >
        <Form action={createPricingTemplateAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />
          <input name="next" type="hidden" value={nextPath} />

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Template name" : "Nombre de plantilla"}</span>
            <Input name="name" placeholder="Largo plazo estándar" required />
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Currency" : "Moneda"}</span>
            <Select defaultValue="PYG" name="currency">
              <option value="PYG">PYG</option>
              <option value="USD">USD</option>
            </Select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
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
              <span>{isEn ? "Advance rent" : "Adelanto"}</span>
              <Input min={0} name="advance_rent" step="0.01" type="number" />
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Security deposit" : "Garantía"}</span>
              <Input
                min={0}
                name="security_deposit"
                step="0.01"
                type="number"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Service fee (flat)" : "Servicio (fijo)"}</span>
              <Input
                min={0}
                name="service_fee_flat"
                step="0.01"
                type="number"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>IVA</span>
              <Input min={0} name="tax_iva" step="0.01" type="number" />
            </label>
            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "Guarantee option fee" : "Costo opción de garantía"}
              </span>
              <Input
                min={0}
                name="guarantee_option_fee"
                step="0.01"
                type="number"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button type="submit">
              {isEn ? "Create template" : "Crear plantilla"}
            </Button>
          </div>
        </Form>
      </Sheet>

      <div className="rounded-md border p-3 text-muted-foreground text-xs">
        {isEn
          ? "Tip: required publish fee lines are Monthly rent, Advance rent, Service fee, and at least one guarantee option."
          : "Tip: para publicar se requieren Alquiler mensual, Adelanto, Servicio y al menos una opción de garantía."}
      </div>
    </div>
  );
}
