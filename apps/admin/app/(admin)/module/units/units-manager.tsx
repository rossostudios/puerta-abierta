"use client";

import { Add01Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { createUnitFromUnitsModuleAction } from "@/app/(admin)/module/units/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useActiveLocale } from "@/lib/i18n/client";

type PropertyRow = {
  id: string;
  name?: string | null;
  code?: string | null;
};

type UnitRow = {
  id: string;
  property_id?: string | null;
  property_name?: string | null;
  code?: string | null;
  name?: string | null;
  max_guests?: number | string | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  currency?: string | null;
  is_active?: boolean | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function UnitsManager({
  orgId,
  units,
  properties,
}: {
  orgId: string;
  units: Record<string, unknown>[];
  properties: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [open, setOpen] = useState(false);
  const [propertyFilter, setPropertyFilter] = useState("all");

  const propertyOptions = useMemo(() => {
    return (properties as PropertyRow[])
      .map((property) => {
        const id = asString(property.id).trim();
        if (!id) return null;
        const name = asString(property.name).trim();
        const code = asString(property.code).trim();
        const label = [name, code].filter(Boolean).join(" · ");
        return { id, label: label || id };
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [properties]);

  const rows = useMemo(() => {
    return (units as UnitRow[])
      .map((row) => ({
        id: asString(row.id).trim(),
        property_id: asString(row.property_id).trim() || null,
        property_name: asString(row.property_name).trim() || null,
        code: asString(row.code).trim() || null,
        name: asString(row.name).trim() || null,
        max_guests: asNumber(row.max_guests),
        bedrooms: asNumber(row.bedrooms),
        bathrooms: asNumber(row.bathrooms),
        currency: asString(row.currency).trim() || null,
        is_active:
          typeof row.is_active === "boolean"
            ? row.is_active
            : Boolean(row.is_active),
      }))
      .filter((row) =>
        propertyFilter === "all" ? true : row.property_id === propertyFilter
      ) as DataTableRow[];
  }, [units, propertyFilter]);

  return (
    <div className="space-y-4">
      {propertyOptions.length === 0 ? (
        <Alert variant="warning">
          <AlertTitle>
            {isEn ? "Create a property first" : "Crea una propiedad primero"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "Units require a property. Create at least one property before adding units."
              : "Las unidades requieren una propiedad. Crea al menos una propiedad antes de agregar unidades."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select
            onChange={(event) => setPropertyFilter(event.target.value)}
            value={propertyFilter}
          >
            <option value="all">
              {isEn ? "All properties" : "Todas las propiedades"}
            </option>
            {propertyOptions.map((property) => (
              <option key={property.id} value={property.id}>
                {property.label}
              </option>
            ))}
          </Select>
          <span className="text-muted-foreground text-sm">
            {rows.length} {isEn ? "records" : "registros"}
          </span>
        </div>

        <Button
          disabled={propertyOptions.length === 0}
          onClick={() => setOpen(true)}
          type="button"
          variant="secondary"
        >
          <Icon icon={Add01Icon} size={16} />
          {isEn ? "New unit" : "Nueva unidad"}
        </Button>
      </div>

      <DataTable
        data={rows}
        rowHrefBase="/module/units"
        searchPlaceholder={isEn ? "Filter units..." : "Filtrar unidades..."}
      />

      <Sheet
        description={
          isEn
            ? "Create a unit under an existing property."
            : "Crea una unidad dentro de una propiedad existente."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New unit" : "Nueva unidad"}
      >
        <Form action={createUnitFromUnitsModuleAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />

          <label className="grid gap-1">
            <span className="font-medium text-muted-foreground text-xs">
              {isEn ? "Property" : "Propiedad"}
            </span>
            <Select defaultValue="" name="property_id" required>
              <option disabled value="">
                {isEn ? "Select a property" : "Selecciona una propiedad"}
              </option>
              {propertyOptions.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground text-xs">
                {isEn ? "Code" : "Código"}
              </span>
              <Input name="code" placeholder="A1" required />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground text-xs">
                {isEn ? "Name" : "Nombre"}
              </span>
              <Input name="name" placeholder="Apto 1A" required />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground text-xs">
                {isEn ? "Guests" : "Huéspedes"}
              </span>
              <Input defaultValue={2} min={1} name="max_guests" type="number" />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground text-xs">
                {isEn ? "Bedrooms" : "Dormitorios"}
              </span>
              <Input defaultValue={1} min={0} name="bedrooms" type="number" />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground text-xs">
                {isEn ? "Bathrooms" : "Baños"}
              </span>
              <Input
                defaultValue={1}
                min={0}
                name="bathrooms"
                step="0.5"
                type="number"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground text-xs">
                {isEn ? "Currency" : "Moneda"}
              </span>
              <Select defaultValue="PYG" name="currency">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
            <Button type="submit" variant="secondary">
              {isEn ? "Create" : "Crear"}
            </Button>
          </div>
        </Form>
      </Sheet>
    </div>
  );
}
