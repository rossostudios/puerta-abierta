"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  createReservationAction,
  transitionReservationStatusAction,
} from "@/app/(admin)/module/reservations/actions";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { type DataTableRow } from "@/components/ui/data-table";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import type { ColumnDef } from "@tanstack/react-table";

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
  total_amount?: number | string | null;
  currency?: string | null;

  unit_id?: string | null;
  unit_name?: string | null;

  property_id?: string | null;
  property_name?: string | null;

  guest_id?: string | null;
  guest_name?: string | null;

  channel_id?: string | null;
  channel_name?: string | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function statusActions(status: string): { next: string; label: string }[] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "pending") {
    return [
      { next: "confirmed", label: "Confirm" },
      { next: "cancelled", label: "Cancel" },
    ];
  }
  if (normalized === "confirmed") {
    return [
      { next: "checked_in", label: "Check-in" },
      { next: "no_show", label: "No-show" },
      { next: "cancelled", label: "Cancel" },
    ];
  }
  if (normalized === "checked_in") {
    return [{ next: "checked_out", label: "Check-out" }];
  }
  return [];
}

function localizedActionLabel(isEn: boolean, next: string): string {
  if (isEn) {
    if (next === "confirmed") return "Confirm";
    if (next === "checked_in") return "Check-in";
    if (next === "checked_out") return "Check-out";
    if (next === "cancelled") return "Cancel";
    if (next === "no_show") return "No-show";
    return next;
  }

  if (next === "confirmed") return "Confirmar";
  if (next === "checked_in") return "Check-in";
  if (next === "checked_out") return "Check-out";
  if (next === "cancelled") return "Cancelar";
  if (next === "no_show") return "No-show";
  return next;
}

function ReservationRowActions({ row }: { row: DataTableRow }) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const id = asString(row.id).trim();
  const status = asString(row.status).trim();
  if (!(id && status)) return null;

  const actions = statusActions(status);
  if (!actions.length) return null;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {actions.map((action) => (
        <Form action={transitionReservationStatusAction} key={action.next}>
          <input name="reservation_id" type="hidden" value={id} />
          <input name="status" type="hidden" value={action.next} />
          <Button size="sm" type="submit" variant="outline">
            {localizedActionLabel(isEn, action.next)}
          </Button>
        </Form>
      ))}
    </div>
  );
}

export function ReservationsManager({
  orgId,
  reservations,
  units,
}: {
  orgId: string;
  reservations: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const [open, setOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [unitId, setUnitId] = useState("all");
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

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const normalizedStatus = status.trim().toLowerCase();

    return (reservations as ReservationRow[])
      .filter((row) => {
        const rowStatus = asString(row.status).trim().toLowerCase();
        if (normalizedStatus !== "all" && rowStatus !== normalizedStatus) {
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
          status: asString(row.status).trim(),
          check_in_date: checkIn,
          check_out_date: checkOut,

          unit_id: asString(row.unit_id).trim() || null,
          unit_name: asString(row.unit_name).trim() || null,

          property_id: asString(row.property_id).trim() || null,
          property_name: asString(row.property_name).trim() || null,

          guest_id: asString(row.guest_id).trim() || null,
          guest_name: asString(row.guest_name).trim() || null,

          channel_id: asString(row.channel_id).trim() || null,
          channel_name: asString(row.channel_name).trim() || null,

          total_amount: asNumber(row.total_amount) ?? null,
          currency: asString(row.currency).trim() || null,
        } satisfies DataTableRow;
      });
  }, [from, query, reservations, status, to, unitId]);

  const reservationColumns = useMemo<ColumnDef<DataTableRow>[]>(
    () => [
      {
        accessorKey: "status",
        header: isEn ? "Status" : "Estado",
        size: 120,
        cell: ({ getValue }) => (
          <StatusBadge value={asString(getValue())} />
        ),
      },
      {
        accessorKey: "check_in_date",
        header: isEn ? "Check-in" : "Check-in",
        size: 120,
      },
      {
        accessorKey: "check_out_date",
        header: isEn ? "Check-out" : "Check-out",
        size: 120,
      },
      {
        accessorKey: "guest_name",
        header: isEn ? "Guest" : "Huésped",
        size: 160,
        cell: ({ getValue }) => {
          const name = asString(getValue()).trim();
          return name || <span className="text-muted-foreground">-</span>;
        },
      },
      {
        accessorKey: "unit_name",
        header: isEn ? "Unit" : "Unidad",
        size: 130,
        cell: ({ getValue }) => {
          const name = asString(getValue()).trim();
          return name || <span className="text-muted-foreground">-</span>;
        },
      },
      {
        accessorKey: "property_name",
        header: isEn ? "Property" : "Propiedad",
        size: 150,
        cell: ({ getValue }) => {
          const name = asString(getValue()).trim();
          return name || <span className="text-muted-foreground">-</span>;
        },
      },
      {
        accessorKey: "channel_name",
        header: isEn ? "Channel" : "Canal",
        size: 120,
        cell: ({ getValue }) => {
          const name = asString(getValue()).trim();
          return name || <span className="text-muted-foreground">-</span>;
        },
      },
      {
        accessorKey: "total_amount",
        header: isEn ? "Amount" : "Monto",
        size: 130,
        cell: ({ row }) => {
          const amount = asNumber(row.original.total_amount);
          const currency = asString(row.original.currency).trim() || "PYG";
          return amount != null ? (
            <span className="tabular-nums text-sm">
              {formatCurrency(amount, currency, locale)}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
    ],
    [isEn, locale]
  );

  const reservationsTrendData = useMemo(() => {
    const days: string[] = [];
    const today = new Date();
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      days.push(date.toISOString().slice(0, 10));
    }

    const byDay = new Map<string, { checkIns: number; checkOuts: number }>(
      days.map((day) => [day, { checkIns: 0, checkOuts: 0 }])
    );

    for (const row of filteredRows) {
      const checkIn = asString(row.check_in_date).trim();
      if (byDay.has(checkIn)) {
        const bucket = byDay.get(checkIn);
        if (bucket) {
          bucket.checkIns += 1;
        }
      }

      const checkOut = asString(row.check_out_date).trim();
      if (byDay.has(checkOut)) {
        const bucket = byDay.get(checkOut);
        if (bucket) {
          bucket.checkOuts += 1;
        }
      }
    }

    return days.map((day) => {
      const parsed = new Date(`${day}T00:00:00`);
      const values = byDay.get(day) ?? { checkIns: 0, checkOuts: 0 };
      return {
        day: Number.isNaN(parsed.valueOf())
          ? day
          : new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
            }).format(parsed),
        checkIns: values.checkIns,
        checkOuts: values.checkOuts,
      };
    });
  }, [filteredRows, locale]);

  const reservationsTrendConfig: ChartConfig = useMemo(
    () => ({
      checkIns: {
        label: isEn ? "Check-ins" : "Check-ins",
        color: "var(--chart-1)",
      },
      checkOuts: {
        label: isEn ? "Check-outs" : "Check-outs",
        color: "var(--chart-2)",
      },
    }),
    [isEn]
  );

  const total = filteredRows.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="grid w-full gap-2 md:grid-cols-4">
          <label className="space-y-1">
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
              {isEn ? "Status" : "Estado"}
            </span>
            <Select
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="all">{isEn ? "All" : "Todos"}</option>
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

          <div className="grid grid-cols-2 gap-2">
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
            {total} {isEn ? "records" : "registros"}
          </div>
          <Button
            onClick={() => setOpen(true)}
            type="button"
            variant="secondary"
          >
            <Icon icon={PlusSignIcon} size={16} />
            {isEn ? "New reservation" : "Nueva reserva"}
          </Button>
        </div>
      </div>

      <section className="rounded-3xl border border-border/80 bg-card/85 p-3.5">
        <div className="mb-2">
          <p className="font-semibold text-sm">
            {isEn
              ? "Check-in / check-out trend"
              : "Tendencia check-in/check-out"}
          </p>
          <p className="text-muted-foreground text-xs">
            {isEn
              ? "Next 7 days from current filters"
              : "Próximos 7 días con filtros actuales"}
          </p>
        </div>
        <ChartContainer
          className="h-52 w-full"
          config={reservationsTrendConfig}
        >
          <LineChart
            data={reservationsTrendData}
            margin={{ left: 2, right: 8 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="day"
              tickLine={false}
              tickMargin={8}
            />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
            <ChartTooltip
              content={(props) => (
                <ChartTooltipContent
                  {...props}
                  headerFormatter={() =>
                    isEn ? "Reservations trend" : "Tendencia de reservas"
                  }
                />
              )}
            />
            <Line
              dataKey="checkIns"
              dot={{ r: 3 }}
              stroke="var(--color-checkIns)"
              strokeWidth={2}
              type="monotone"
            />
            <Line
              dataKey="checkOuts"
              dot={{ r: 3 }}
              stroke="var(--color-checkOuts)"
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
      </section>

      <NotionDataTable
        columns={reservationColumns}
        data={filteredRows}
        hideSearch
        isEn={isEn}
        renderRowActions={(row) => <ReservationRowActions row={row} />}
        rowActionsHeader={isEn ? "Actions" : "Acciones"}
      />

      <Sheet
        description={
          isEn
            ? "Create a manual reservation and manage overlaps."
            : "Crea una reserva manual y gestiona solapamientos."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New reservation" : "Nueva reserva"}
      >
        <Form action={createReservationAction} className="space-y-4">
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
                {isEn ? "Check-in" : "Check-in"}
              </span>
              <DatePicker locale={locale} name="check_in_date" />
            </label>
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Check-out" : "Check-out"}
              </span>
              <DatePicker locale={locale} name="check_out_date" />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block space-y-1 md:col-span-2">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Total amount" : "Monto total"}
              </span>
              <Input
                min={0}
                name="total_amount"
                required
                step="0.01"
                type="number"
              />
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Currency" : "Moneda"}
              </span>
              <Select defaultValue="PYG" name="currency">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Initial status" : "Estado inicial"}
            </span>
            <Select defaultValue="pending" name="status">
              <option value="pending">pending</option>
              <option value="confirmed">confirmed</option>
              <option value="checked_in">checked_in</option>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Notes" : "Notas"}
            </span>
            <Input name="notes" placeholder={isEn ? "Optional" : "Opcional"} />
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
