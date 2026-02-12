"use client";

import { Add01Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { createPropertyFromPropertiesModuleAction } from "@/app/(admin)/module/properties/actions";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useActiveLocale } from "@/lib/i18n/client";

type PropertyRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  status?: string | null;
  city?: string | null;
  address_line1?: string | null;
  country_code?: string | null;
  created_at?: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

export function PropertiesManager({
  orgId,
  properties,
}: {
  orgId: string;
  properties: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    return (properties as PropertyRow[]).map((row) => ({
      id: asString(row.id).trim(),
      name: asString(row.name).trim() || null,
      code: asString(row.code).trim() || null,
      status: asString(row.status).trim() || null,
      city: asString(row.city).trim() || null,
      address_line1: asString(row.address_line1).trim() || null,
      country_code: asString(row.country_code).trim() || null,
      created_at: asString(row.created_at).trim() || null,
    })) as DataTableRow[];
  }, [properties]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-foreground text-sm">
          {rows.length} {isEn ? "records" : "registros"}
        </div>
        <Button onClick={() => setOpen(true)} type="button" variant="secondary">
          <Icon icon={Add01Icon} size={16} />
          {isEn ? "New property" : "Nueva propiedad"}
        </Button>
      </div>

      <DataTable
        data={rows}
        rowHrefBase="/module/properties"
        searchPlaceholder={
          isEn ? "Filter properties..." : "Filtrar propiedades..."
        }
      />

      <Sheet
        description={
          isEn
            ? "Add a property to start assigning units and reservations."
            : "Agrega una propiedad para empezar a asignar unidades y reservas."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New property" : "Nueva propiedad"}
      >
        <Form
          action={createPropertyFromPropertiesModuleAction}
          className="space-y-4"
        >
          <input name="organization_id" type="hidden" value={orgId} />

          <label className="grid gap-1">
            <span className="font-medium text-muted-foreground text-xs">
              {isEn ? "Name" : "Nombre"}
            </span>
            <Input name="name" placeholder="Edificio Centro" required />
          </label>

          <label className="grid gap-1">
            <span className="font-medium text-muted-foreground text-xs">
              {isEn ? "Code" : "Código"}
            </span>
            <Input name="code" placeholder="CEN-01" />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground text-xs">
                {isEn ? "City" : "Ciudad"}
              </span>
              <Input
                defaultValue="Asuncion"
                name="city"
                placeholder="Asuncion"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground text-xs">
                {isEn ? "Address" : "Dirección"}
              </span>
              <Input name="address_line1" placeholder="Av. España 1234" />
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
