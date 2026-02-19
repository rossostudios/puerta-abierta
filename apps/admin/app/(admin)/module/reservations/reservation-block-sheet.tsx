"use client";

import { createCalendarBlockAction } from "@/app/(admin)/module/reservations/actions";
import { type UnitOption } from "@/app/(admin)/module/reservations/reservations-types";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import type { Locale } from "@/lib/i18n";

export function ReservationBlockSheet({
  isEn,
  locale,
  onOpenChange,
  open,
  orgId,
  unitOptions,
}: {
  isEn: boolean;
  locale: Locale;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  orgId: string;
  unitOptions: UnitOption[];
}) {
  return (
    <Sheet
      description={
        isEn
          ? "Create a manual availability block (maintenance, owner use, etc.)."
          : "Crea un bloqueo manual de disponibilidad (mantenimiento, uso del propietario, etc.)."
      }
      onOpenChange={onOpenChange}
      open={open}
      title={isEn ? "New calendar block" : "Nuevo bloqueo"}
    >
      <Form action={createCalendarBlockAction} className="space-y-4">
        <input name="organization_id" type="hidden" value={orgId} />

        <label className="block space-y-1" htmlFor="new-block-unit">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Unit" : "Unidad"}
          </span>
          <Select defaultValue="" id="new-block-unit" name="unit_id" required>
            <option disabled value="">
              {isEn ? "Select a unit" : "Selecciona una unidad"}
            </option>
            {unitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </Select>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1" htmlFor="new-block-starts">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Starts" : "Inicio"}
            </span>
            <DatePicker id="new-block-starts" locale={locale} name="starts_on" />
          </label>
          <label className="block space-y-1" htmlFor="new-block-ends">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Ends" : "Fin"}
            </span>
            <DatePicker id="new-block-ends" locale={locale} name="ends_on" />
          </label>
        </div>

        <label className="block space-y-1" htmlFor="new-block-reason">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Reason (optional)" : "Motivo (opcional)"}
          </span>
          <Input
            id="new-block-reason"
            name="reason"
            placeholder={
              isEn
                ? "Maintenance, owner use..."
                : "Mantenimiento, uso propietario..."
            }
          />
        </label>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            onClick={() => onOpenChange(false)}
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
  );
}
