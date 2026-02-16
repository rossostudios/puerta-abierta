"use client";

import {
  Calendar02Icon,
  Home01Icon,
  LeftToRightListBulletIcon,
  Login03Icon,
  Logout03Icon,
  Money01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  createCalendarBlockAction,
  createReservationAction,
  deleteCalendarBlockAction,
  transitionReservationStatusAction,
} from "@/app/(admin)/module/reservations/actions";
import { WeeklyCalendar } from "@/app/(admin)/module/reservations/weekly-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { type DataTableRow } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
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
  amount_paid?: number | string | null;
  currency?: string | null;

  unit_id?: string | null;
  unit_name?: string | null;

  property_id?: string | null;
  property_name?: string | null;

  guest_id?: string | null;
  guest_name?: string | null;

  adults?: number | string | null;
  children?: number | string | null;

  integration_id?: string | null;
  integration_name?: string | null;
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

  return !(end <= rangeStart || start >= rangeEnd);
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!(a && b && isIsoDate(a) && isIsoDate(b))) return null;
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (Number.isNaN(d1.valueOf()) || Number.isNaN(d2.valueOf())) return null;
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86_400_000));
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

function humanizeStatus(status: string, isEn: boolean): string {
  const s = status.trim().toLowerCase();
  if (isEn) {
    if (s === "pending") return "Pending";
    if (s === "confirmed") return "Confirmed";
    if (s === "checked_in") return "Checked In";
    if (s === "checked_out") return "Checked Out";
    if (s === "cancelled") return "Cancelled";
    if (s === "no_show") return "No Show";
    return status;
  }
  if (s === "pending") return "Pendiente";
  if (s === "confirmed") return "Confirmada";
  if (s === "checked_in") return "Check-in";
  if (s === "checked_out") return "Check-out";
  if (s === "cancelled") return "Cancelada";
  if (s === "no_show") return "No show";
  return status;
}

type QuickFilter =
  | "all"
  | "arrivals_today"
  | "departures_today"
  | "in_house"
  | "pending";

function ReservationRowActions({ row }: { row: DataTableRow }) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const id = asString(row.id).trim();
  const status = asString(row.status).trim();
  if (!(id && status)) return null;

  const actions = statusActions(status);
  if (!actions.length) return null;

  return (
    <div className="flex flex-wrap justify-end gap-2" data-row-click="ignore">
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
  blocks,
  defaultView = "list",
  orgId,
  reservations,
  units,
}: {
  blocks: Record<string, unknown>[];
  defaultView?: "list" | "calendar";
  orgId: string;
  reservations: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [blockSheetOpen, setBlockSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">(defaultView);

  // Listen for header button custom event
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-reservation-sheet", handler);
    return () => window.removeEventListener("open-reservation-sheet", handler);
  }, []);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [unitId, setUnitId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

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
          .join(" \u00B7 ");
        return { id, label: label || id };
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [units]);

  const allRows = useMemo(() => {
    return (reservations as ReservationRow[]).map((row) => {
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

        adults: asNumber(row.adults) ?? 0,
        children: asNumber(row.children) ?? 0,

        integration_id: asString(row.integration_id).trim() || null,
        integration_name: asString(row.integration_name).trim() || null,
        channel_name: asString(row.channel_name).trim() || null,

        total_amount: asNumber(row.total_amount) ?? null,
        amount_paid: asNumber(row.amount_paid) ?? null,
        currency: asString(row.currency).trim() || null,
      } satisfies DataTableRow;
    });
  }, [reservations]);

  // KPI stats computed from all reservations (unfiltered)
  const kpiStats = useMemo(() => {
    let arrivalsToday = 0;
    let departuresToday = 0;
    let inHouse = 0;

    for (const row of allRows) {
      const s = asString(row.status).toLowerCase();
      const ci = asString(row.check_in_date);
      const co = asString(row.check_out_date);

      if (ci === today && (s === "confirmed" || s === "pending")) {
        arrivalsToday++;
      }
      if (co === today && s === "checked_in") {
        departuresToday++;
      }
      if (s === "checked_in") {
        inHouse++;
      }
    }

    return { arrivalsToday, departuresToday, inHouse };
  }, [allRows, today]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const normalizedStatus = status.trim().toLowerCase();

    return allRows.filter((row) => {
      const rowStatus = asString(row.status).trim().toLowerCase();

      // Quick filter logic
      if (quickFilter === "arrivals_today") {
        const ci = asString(row.check_in_date);
        if (
          ci !== today ||
          !(rowStatus === "confirmed" || rowStatus === "pending")
        )
          return false;
      } else if (quickFilter === "departures_today") {
        const co = asString(row.check_out_date);
        if (co !== today || rowStatus !== "checked_in") return false;
      } else if (quickFilter === "in_house") {
        if (rowStatus !== "checked_in") return false;
      } else if (quickFilter === "pending") {
        if (rowStatus !== "pending") return false;
      }

      // Standard filters (only apply when quick filter is "all")
      if (quickFilter === "all") {
        if (normalizedStatus !== "all" && rowStatus !== normalizedStatus) {
          return false;
        }
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
        row.integration_name,
        row.channel_name,
        row.status,
      ]
        .map((value) => asString(value).trim().toLowerCase())
        .filter(Boolean)
        .join(" | ");

      return haystack.includes(needle);
    });
  }, [allRows, from, query, quickFilter, status, to, today, unitId]);

  // Period revenue from filtered rows
  const periodRevenue = useMemo(() => {
    let total = 0;
    let currency = "PYG";
    for (const row of filteredRows) {
      const amount = asNumber(row.total_amount);
      if (amount != null) total += amount;
      const cur = asString(row.currency).trim();
      if (cur) currency = cur;
    }
    return { total, currency };
  }, [filteredRows]);

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
        header: "Check-in",
        size: 110,
      },
      {
        accessorKey: "check_out_date",
        header: "Check-out",
        size: 110,
      },
      {
        id: "nights",
        header: isEn ? "Nights" : "Noches",
        size: 70,
        cell: ({ row }) => {
          const nights = daysBetween(
            asString(row.original.check_in_date),
            asString(row.original.check_out_date)
          );
          return nights != null ? (
            <span className="tabular-nums text-sm">{nights}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        accessorKey: "guest_name",
        header: isEn ? "Guest" : "Huésped",
        size: 180,
        cell: ({ row }) => {
          const name = asString(row.original.guest_name).trim();
          const adults = asNumber(row.original.adults) ?? 0;
          const children = asNumber(row.original.children) ?? 0;

          if (!name) {
            return <span className="text-muted-foreground">-</span>;
          }

          const comp =
            adults > 0 || children > 0
              ? [adults > 0 && `${adults}A`, children > 0 && `${children}C`]
                  .filter(Boolean)
                  .join(" ")
              : null;

          return (
            <div className="flex items-center gap-2">
              <span className="truncate">{name}</span>
              {comp ? (
                <Badge
                  className="shrink-0 px-1.5 py-0 text-[10px]"
                  variant="secondary"
                >
                  {comp}
                </Badge>
              ) : null}
            </div>
          );
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
        id: "channel",
        header: isEn ? "Channel" : "Canal",
        size: 110,
        cell: ({ row }) => {
          const channel = asString(row.original.channel_name).trim();
          const integration = asString(row.original.integration_name).trim();
          const display = channel || integration;
          if (!display)
            return <span className="text-muted-foreground">-</span>;
          return (
            <Badge
              className="px-1.5 py-0 text-[10px]"
              variant="outline"
            >
              {display}
            </Badge>
          );
        },
      },
      {
        id: "payment",
        header: isEn ? "Payment" : "Pago",
        size: 90,
        cell: ({ row }) => {
          const total = asNumber(row.original.total_amount);
          const paid = asNumber(row.original.amount_paid);
          if (total == null || total === 0) {
            return <span className="text-muted-foreground">-</span>;
          }
          const paidAmount = paid ?? 0;
          const ratio = Math.min(1, paidAmount / total);

          if (ratio >= 1) {
            return (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 px-1.5 py-0 text-[10px]">
                {isEn ? "Paid" : "Pagado"}
              </Badge>
            );
          }
          if (ratio <= 0) {
            return (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 px-1.5 py-0 text-[10px]">
                {isEn ? "Unpaid" : "Sin pago"}
              </Badge>
            );
          }
          return (
            <Badge
              className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0 px-1.5 py-0 text-[10px] tabular-nums"
            >
              {Math.round(ratio * 100)}%
            </Badge>
          );
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
    const todayDate = new Date();
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(todayDate);
      date.setDate(todayDate.getDate() + index);
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
        label: "Check-ins",
        color: "var(--chart-1)",
      },
      checkOuts: {
        label: "Check-outs",
        color: "var(--chart-2)",
      },
    }),
    []
  );

  const total = filteredRows.length;

  const handleRowClick = (row: DataTableRow) => {
    const id = asString(row.id).trim();
    if (id) {
      router.push(`/module/reservations/${id}`);
    }
  };

  const applyQuickFilter = (filter: QuickFilter) => {
    setQuickFilter(filter);
    if (filter !== "all") {
      setStatus("all");
    }
  };

  const quickFilterTabs: { key: QuickFilter; label: string }[] = [
    { key: "all", label: isEn ? "All" : "Todas" },
    {
      key: "arrivals_today",
      label: isEn ? "Arrivals Today" : "Llegadas hoy",
    },
    {
      key: "departures_today",
      label: isEn ? "Departures Today" : "Salidas hoy",
    },
    { key: "in_house", label: isEn ? "In-House" : "In-house" },
    { key: "pending", label: isEn ? "Pending" : "Pendientes" },
  ];

  // Footer row for total amount sum
  const footerRow = useMemo(() => {
    let sum = 0;
    let currency = "PYG";
    for (const row of filteredRows) {
      const amount = asNumber(row.total_amount);
      if (amount != null) sum += amount;
      const cur = asString(row.currency).trim();
      if (cur) currency = cur;
    }
    if (sum === 0) return null;
    return { sum, currency };
  }, [filteredRows]);

  return (
    <div className="space-y-4">
      {/* KPI Stat Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Login03Icon}
          label={isEn ? "Today's Arrivals" : "Llegadas hoy"}
          value={String(kpiStats.arrivalsToday)}
        />
        <StatCard
          icon={Logout03Icon}
          label={isEn ? "Today's Departures" : "Salidas hoy"}
          value={String(kpiStats.departuresToday)}
        />
        <StatCard
          icon={Home01Icon}
          label={isEn ? "In-House" : "In-house"}
          value={String(kpiStats.inHouse)}
        />
        <StatCard
          helper={`${total} ${isEn ? "filtered records" : "registros filtrados"}`}
          icon={Money01Icon}
          label={isEn ? "Period Revenue" : "Ingresos del periodo"}
          value={formatCurrency(
            periodRevenue.total,
            periodRevenue.currency,
            locale
          )}
        />
      </div>

      {/* Quick-filter tabs + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {quickFilterTabs.map((tab) => (
            <Button
              key={tab.key}
              onClick={() => applyQuickFilter(tab.key)}
              size="sm"
              variant={quickFilter === tab.key ? "secondary" : "ghost"}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1 rounded-xl border border-border/40 bg-background/40 p-1">
          <Button
            className="h-8 w-8 rounded-lg p-0 transition-all"
            onClick={() => setViewMode("list")}
            size="sm"
            variant={viewMode === "list" ? "secondary" : "ghost"}
          >
            <Icon icon={LeftToRightListBulletIcon} size={14} />
          </Button>
          <Button
            className="h-8 w-8 rounded-lg p-0 transition-all"
            onClick={() => setViewMode("calendar")}
            size="sm"
            variant={viewMode === "calendar" ? "secondary" : "ghost"}
          >
            <Icon icon={Calendar02Icon} size={14} />
          </Button>
        </div>
      </div>

      {viewMode === "list" ? (
        <>
          {/* Filters */}
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
                  onChange={(event) => {
                    setStatus(event.target.value);
                    if (event.target.value !== "all") setQuickFilter("all");
                  }}
                  value={status}
                >
                  <option value="all">{isEn ? "All" : "Todos"}</option>
                  <option value="pending">{humanizeStatus("pending", isEn)}</option>
                  <option value="confirmed">
                    {humanizeStatus("confirmed", isEn)}
                  </option>
                  <option value="checked_in">
                    {humanizeStatus("checked_in", isEn)}
                  </option>
                  <option value="checked_out">
                    {humanizeStatus("checked_out", isEn)}
                  </option>
                  <option value="cancelled">
                    {humanizeStatus("cancelled", isEn)}
                  </option>
                  <option value="no_show">
                    {humanizeStatus("no_show", isEn)}
                  </option>
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
            </div>
          </div>

          {/* Collapsible trend chart */}
          <Collapsible defaultOpen={false}>
            <section className="rounded-3xl border border-border/80 bg-card/85 p-3.5">
              <CollapsibleTrigger className="flex w-full items-center justify-between">
                <div>
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
                <span className="text-muted-foreground text-xs">
                  {isEn ? "Toggle" : "Mostrar"}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2">
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
                      <YAxis
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                      />
                      <ChartTooltip
                        content={(props) => (
                          <ChartTooltipContent
                            {...props}
                            headerFormatter={() =>
                              isEn
                                ? "Reservations trend"
                                : "Tendencia de reservas"
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
                </div>
              </CollapsibleContent>
            </section>
          </Collapsible>

          <NotionDataTable
            columns={reservationColumns}
            data={filteredRows}
            footer={
              footerRow ? (
                <TableRow>
                  <TableCell className="py-2 font-semibold text-xs" colSpan={8}>
                    {isEn ? "Total" : "Total"}
                  </TableCell>
                  <TableCell className="py-2 text-right font-semibold tabular-nums text-xs">
                    {formatCurrency(footerRow.sum, footerRow.currency, locale)}
                  </TableCell>
                </TableRow>
              ) : undefined
            }
            hideSearch
            isEn={isEn}
            onRowClick={handleRowClick}
            renderRowActions={(row) => <ReservationRowActions row={row} />}
            rowActionsHeader={isEn ? "Actions" : "Acciones"}
          />
        </>
      ) : (
        <>
          {/* Calendar view */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {unitId !== "all" ? (
                <span className="text-muted-foreground text-sm">
                  {isEn ? "Filtered by unit" : "Filtrado por unidad"}
                </span>
              ) : null}
            </div>
            <Button
              onClick={() => setBlockSheetOpen(true)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Icon icon={PlusSignIcon} size={14} />
              {isEn ? "New block" : "Nuevo bloqueo"}
            </Button>
          </div>

          <WeeklyCalendar
            blocks={
              unitId !== "all"
                ? blocks.filter(
                    (b) => asString((b as Record<string, unknown>).unit_id).trim() === unitId
                  )
                : blocks
            }
            isEn={isEn}
            locale={locale}
            reservations={
              unitId !== "all"
                ? filteredRows.map((r) => r as unknown as Record<string, unknown>)
                : reservations
            }
            units={unitOptions}
          />
        </>
      )}

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

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Guest name" : "Nombre del huésped"}
            </span>
            <Input
              name="guest_name"
              placeholder={isEn ? "Guest full name" : "Nombre completo"}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                Check-in
              </span>
              <DatePicker locale={locale} name="check_in_date" />
            </label>
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                Check-out
              </span>
              <DatePicker locale={locale} name="check_out_date" />
            </label>
          </div>

          {/* Guest composition */}
          <div className="grid grid-cols-4 gap-2">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Adults" : "Adultos"}
              </span>
              <Input
                defaultValue={1}
                min={0}
                name="adults"
                type="number"
              />
            </label>
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Children" : "Niños"}
              </span>
              <Input
                defaultValue={0}
                min={0}
                name="children"
                type="number"
              />
            </label>
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Infants" : "Infantes"}
              </span>
              <Input
                defaultValue={0}
                min={0}
                name="infants"
                type="number"
              />
            </label>
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Pets" : "Mascotas"}
              </span>
              <Input
                defaultValue={0}
                min={0}
                name="pets"
                type="number"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Nightly rate" : "Tarifa/noche"}
              </span>
              <Input
                min={0}
                name="nightly_rate"
                step="0.01"
                type="number"
              />
            </label>

            <label className="block space-y-1">
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
              <option value="pending">{humanizeStatus("pending", isEn)}</option>
              <option value="confirmed">
                {humanizeStatus("confirmed", isEn)}
              </option>
              <option value="checked_in">
                {humanizeStatus("checked_in", isEn)}
              </option>
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

      <Sheet
        description={
          isEn
            ? "Create a manual availability block (maintenance, owner use, etc.)."
            : "Crea un bloqueo manual de disponibilidad (mantenimiento, uso del propietario, etc.)."
        }
        onOpenChange={setBlockSheetOpen}
        open={blockSheetOpen}
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
              onClick={() => setBlockSheetOpen(false)}
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
