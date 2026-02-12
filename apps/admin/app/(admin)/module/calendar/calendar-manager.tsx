"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";

import {
  createCalendarBlockAction,
  deleteCalendarBlockAction,
} from "@/app/(admin)/module/calendar/actions";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useActiveLocale } from "@/lib/i18n/client";

type UnitRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  property_name?: string | null;
};

type ReservationRow = {
  id: string;
  status?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  guest_name?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
  property_name?: string | null;
  channel_name?: string | null;
};

type BlockRow = {
  id: string;
  starts_on?: string | null;
  ends_on?: string | null;
  reason?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
  property_name?: string | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_RESERVATION_STATUSES = new Set([
  "pending",
  "confirmed",
  "checked_in",
]);

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function overlapsRange(options: {
  start: string;
  end: string;
  from?: string;
  to?: string;
}): boolean {
  const { start, end, from, to } = options;
  if (!(isIsoDate(start) && isIsoDate(end))) return true;
  const windowFrom = isIsoDate(from) ? from : null;
  const windowTo = isIsoDate(to) ? to : null;
  if (!(windowFrom || windowTo)) return true;

  const rangeStart = windowFrom ?? start;
  const rangeEnd = windowTo ?? end;

  // Inclusive-exclusive semantics: [start, end)
  return !(end <= rangeStart || start >= rangeEnd);
}

function CalendarBlockRowActions({ row }: { row: DataTableRow }) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const [confirming, setConfirming] = useState(false);

  const id = asString(row.id).trim();
  if (!id) return null;

  if (!confirming) {
    return (
      <Button
        onClick={() => setConfirming(true)}
        size="sm"
        type="button"
        variant="destructive"
      >
        {isEn ? "Delete" : "Eliminar"}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Form action={deleteCalendarBlockAction}>
        <input name="block_id" type="hidden" value={id} />
        <Button size="sm" type="submit" variant="destructive">
          {isEn ? "Confirm" : "Confirmar"}
        </Button>
      </Form>
      <Button
        onClick={() => setConfirming(false)}
        size="sm"
        type="button"
        variant="outline"
      >
        {isEn ? "Cancel" : "Cancelar"}
      </Button>
    </div>
  );
}

export function CalendarManager({
  orgId,
  reservations,
  blocks,
  units,
}: {
  orgId: string;
  reservations: Record<string, unknown>[];
  blocks: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const [open, setOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [unitId, setUnitId] = useState("all");
  const [reservationStatus, setReservationStatus] = useState("active");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const unitOptions = useMemo(() => {
    return (units as UnitRow[])
      .map((unit) => {
        const id = asString(unit.id).trim();
        if (!id) return null;
        const name = asString(unit.name).trim();
        const code = asString(unit.code).trim();
        const property = asString(unit.property_name).trim();
        const label = [property, code || name || id]
          .filter(Boolean)
          .join(" · ");
        return { id, label: label || id };
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [units]);

  const reservationRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const normalizedStatus = reservationStatus.trim().toLowerCase();

    return (reservations as ReservationRow[])
      .filter((row) => {
        const rowStatus = asString(row.status).trim().toLowerCase();
        if (normalizedStatus === "active") {
          if (!ACTIVE_RESERVATION_STATUSES.has(rowStatus)) return false;
        } else if (
          normalizedStatus !== "all" &&
          rowStatus !== normalizedStatus
        ) {
          return false;
        }

        const rowUnitId = asString(row.unit_id).trim();
        if (unitId !== "all" && rowUnitId !== unitId) {
          return false;
        }

        const start = asString(row.check_in_date).trim();
        const end = asString(row.check_out_date).trim();
        if (!overlapsRange({ start, end, from, to })) {
          return false;
        }

        if (!needle) return true;

        const haystack = [
          row.id,
          row.guest_name,
          row.unit_name,
          row.property_name,
          row.channel_name,
          row.status,
        ]
          .map((value) => asString(value).trim().toLowerCase())
          .filter(Boolean)
          .join(" | ");

        return haystack.includes(needle);
      })
      .map((row) => {
        const checkIn = isIsoDate(row.check_in_date) ? row.check_in_date : null;
        const checkOut = isIsoDate(row.check_out_date)
          ? row.check_out_date
          : null;

        return {
          id: asString(row.id).trim(),
          status: asString(row.status).trim() || null,
          check_in_date: checkIn,
          check_out_date: checkOut,
          unit_id: asString(row.unit_id).trim() || null,
          unit_name: asString(row.unit_name).trim() || null,
          property_name: asString(row.property_name).trim() || null,
          guest_name: asString(row.guest_name).trim() || null,
          channel_name: asString(row.channel_name).trim() || null,
        };
      })
      .filter((row) => row.id);
  }, [from, query, reservationStatus, reservations, to, unitId]);

  const blockRows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return (blocks as BlockRow[])
      .filter((block) => {
        const rowUnitId = asString(block.unit_id).trim();
        if (unitId !== "all" && rowUnitId !== unitId) {
          return false;
        }

        const start = asString(block.starts_on).trim();
        const end = asString(block.ends_on).trim();
        if (!overlapsRange({ start, end, from, to })) {
          return false;
        }

        if (!needle) return true;

        const haystack = [
          block.id,
          block.reason,
          block.unit_name,
          block.property_name,
          block.starts_on,
          block.ends_on,
        ]
          .map((value) => asString(value).trim().toLowerCase())
          .filter(Boolean)
          .join(" | ");

        return haystack.includes(needle);
      })
      .map((block) => {
        return {
          id: asString(block.id).trim(),
          starts_on: isIsoDate(block.starts_on) ? block.starts_on : null,
          ends_on: isIsoDate(block.ends_on) ? block.ends_on : null,
          reason: asString(block.reason).trim() || null,
          unit_id: asString(block.unit_id).trim() || null,
          unit_name: asString(block.unit_name).trim() || null,
          property_name: asString(block.property_name).trim() || null,
        };
      })
      .filter((row) => row.id);
  }, [blocks, from, query, to, unitId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="space-y-1 md:col-span-2">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Search" : "Buscar"}
            </span>
            <Input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isEn ? "Guest, unit, status..." : "Huésped, unidad, estado..."
              }
              value={query}
            />
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Reservation status" : "Estado de reserva"}
            </span>
            <Select
              onChange={(event) => setReservationStatus(event.target.value)}
              value={reservationStatus}
            >
              <option value="active">{isEn ? "Active" : "Activas"}</option>
              <option value="all">{isEn ? "All" : "Todas"}</option>
              <option value="pending">pending</option>
              <option value="confirmed">confirmed</option>
              <option value="checked_in">checked_in</option>
              <option value="checked_out">checked_out</option>
              <option value="cancelled">cancelled</option>
              <option value="no_show">no_show</option>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Unit" : "Unidad"}
            </span>
            <Select
              onChange={(event) => setUnitId(event.target.value)}
              value={unitId}
            >
              <option value="all">{isEn ? "All units" : "Todas"}</option>
              {unitOptions.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="grid grid-cols-2 gap-2 md:col-span-5 md:max-w-xl">
            <label className="space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "From" : "Desde"}
              </span>
              <DatePicker
                locale={locale}
                max={to || undefined}
                onValueChange={setFrom}
                value={from}
              />
            </label>
            <label className="space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "To" : "Hasta"}
              </span>
              <DatePicker
                locale={locale}
                min={from || undefined}
                onValueChange={setTo}
                value={to}
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-muted-foreground text-sm">
            {reservationRows.length} {isEn ? "reservations" : "reservas"} ·{" "}
            {blockRows.length} {isEn ? "blocks" : "bloqueos"}
          </div>
          <Button
            onClick={() => setOpen(true)}
            type="button"
            variant="secondary"
          >
            <Icon icon={PlusSignIcon} size={16} />
            {isEn ? "New block" : "Nuevo bloqueo"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{isEn ? "Reservations" : "Reservas"}</p>
            <p className="text-muted-foreground text-sm">
              {reservationRows.length} {isEn ? "records" : "registros"}
            </p>
          </div>
          <DataTable
            data={reservationRows}
            rowHrefBase="/module/reservations"
            searchPlaceholder={
              isEn ? "Filter reservations..." : "Filtrar reservas..."
            }
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{isEn ? "Calendar" : "Calendario"}</p>
            <p className="text-muted-foreground text-sm">
              {blockRows.length} {isEn ? "records" : "registros"}
            </p>
          </div>
          <DataTable
            data={blockRows}
            renderRowActions={(row) => <CalendarBlockRowActions row={row} />}
            rowActionsHeader={isEn ? "Actions" : "Acciones"}
            rowHrefBase="/module/calendar"
            searchPlaceholder={
              isEn ? "Filter blocks..." : "Filtrar bloqueos..."
            }
          />
        </section>
      </div>

      <Sheet
        description={
          isEn
            ? "Create a manual availability block (maintenance, owner use, etc.)."
            : "Crea un bloqueo manual de disponibilidad (mantenimiento, uso del propietario, etc.)."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New calendar block" : "Nuevo bloqueo"}
      >
        <Form action={createCalendarBlockAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Unit" : "Unidad"}
            </span>
            <Select defaultValue="" name="unit_id" required>
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
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Starts" : "Inicio"}
              </span>
              <DatePicker locale={locale} name="starts_on" />
            </label>
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Ends" : "Fin"}
              </span>
              <DatePicker locale={locale} name="ends_on" />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Reason (optional)" : "Motivo (opcional)"}
            </span>
            <Input
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
