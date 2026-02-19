"use client";

import { createReservationAction } from "@/app/(admin)/module/reservations/actions";
import { humanizeStatus, type UnitOption } from "@/app/(admin)/module/reservations/reservations-types";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import type { Locale } from "@/lib/i18n";

export function ReservationFormSheet({
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
          ? "Create a manual reservation and manage overlaps."
          : "Crea una reserva manual y gestiona solapamientos."
      }
      onOpenChange={onOpenChange}
      open={open}
      title={isEn ? "New reservation" : "Nueva reserva"}
    >
      <Form action={createReservationAction} className="space-y-4">
        <input name="organization_id" type="hidden" value={orgId} />

        <label className="block space-y-1" htmlFor="new-res-unit">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Unit" : "Unidad"}
          </span>
          <Select defaultValue="" id="new-res-unit" name="unit_id" required>
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

        <label className="block space-y-1" htmlFor="new-res-guest-name">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Guest name" : "Nombre del hu\u00e9sped"}
          </span>
          <Input
            id="new-res-guest-name"
            name="guest_name"
            placeholder={isEn ? "Guest full name" : "Nombre completo"}
          />
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1" htmlFor="new-res-check-in">
            <span className="block font-medium text-muted-foreground text-xs">
              Check-in
            </span>
            <DatePicker id="new-res-check-in" locale={locale} name="check_in_date" />
          </label>
          <label className="block space-y-1" htmlFor="new-res-check-out">
            <span className="block font-medium text-muted-foreground text-xs">
              Check-out
            </span>
            <DatePicker id="new-res-check-out" locale={locale} name="check_out_date" />
          </label>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <label className="block space-y-1" htmlFor="new-res-adults">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Adults" : "Adultos"}
            </span>
            <Input
              defaultValue={1}
              id="new-res-adults"
              min={0}
              name="adults"
              type="number"
            />
          </label>
          <label className="block space-y-1" htmlFor="new-res-children">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Children" : "Ni\u00f1os"}
            </span>
            <Input
              defaultValue={0}
              id="new-res-children"
              min={0}
              name="children"
              type="number"
            />
          </label>
          <label className="block space-y-1" htmlFor="new-res-infants">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Infants" : "Infantes"}
            </span>
            <Input
              defaultValue={0}
              id="new-res-infants"
              min={0}
              name="infants"
              type="number"
            />
          </label>
          <label className="block space-y-1" htmlFor="new-res-pets">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Pets" : "Mascotas"}
            </span>
            <Input
              defaultValue={0}
              id="new-res-pets"
              min={0}
              name="pets"
              type="number"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block space-y-1" htmlFor="new-res-nightly-rate">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Nightly rate" : "Tarifa/noche"}
            </span>
            <Input
              id="new-res-nightly-rate"
              min={0}
              name="nightly_rate"
              step="0.01"
              type="number"
            />
          </label>

          <label className="block space-y-1" htmlFor="new-res-total-amount">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Total amount" : "Monto total"}
            </span>
            <Input
              id="new-res-total-amount"
              min={0}
              name="total_amount"
              required
              step="0.01"
              type="number"
            />
          </label>

          <label className="block space-y-1" htmlFor="new-res-currency">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Currency" : "Moneda"}
            </span>
            <Select defaultValue="PYG" id="new-res-currency" name="currency">
              <option value="PYG">PYG</option>
              <option value="USD">USD</option>
            </Select>
          </label>
        </div>

        <label className="block space-y-1" htmlFor="new-res-status">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Initial status" : "Estado inicial"}
          </span>
          <Select defaultValue="pending" id="new-res-status" name="status">
            <option value="pending">{humanizeStatus("pending", isEn)}</option>
            <option value="confirmed">
              {humanizeStatus("confirmed", isEn)}
            </option>
            <option value="checked_in">
              {humanizeStatus("checked_in", isEn)}
            </option>
          </Select>
        </label>

        <label className="block space-y-1" htmlFor="new-res-notes">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Notes" : "Notas"}
          </span>
          <Input id="new-res-notes" name="notes" placeholder={isEn ? "Optional" : "Opcional"} />
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
