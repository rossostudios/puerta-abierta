"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { bulkTransitionReservationStatusAction } from "@/app/(admin)/module/reservations/actions";
import { ReservationFormSheet } from "@/app/(admin)/module/reservations/reservation-form-sheet";
import { ReservationsFilters } from "@/app/(admin)/module/reservations/reservations-filters";
import { ReservationsStats } from "@/app/(admin)/module/reservations/reservations-stats";
import { ReservationsTable } from "@/app/(admin)/module/reservations/reservations-table";
import { ReservationsToolbar } from "@/app/(admin)/module/reservations/reservations-toolbar";
import { ReservationsTrendChart } from "@/app/(admin)/module/reservations/reservations-trend-chart";
import {
  asNumber,
  asString,
  isIsoDate,
  overlapsRange,
  type QuickFilter,
  type ReservationRow,
  type UnitRow,
} from "@/app/(admin)/module/reservations/reservations-types";
import type { ChartConfig } from "@/components/ui/chart";
import type { DataTableRow } from "@/components/ui/data-table";
import {
  getAllViews,
  type ReservationSavedView,
} from "@/lib/features/reservations/saved-views";
import { useNewBookingToast } from "@/lib/features/reservations/use-new-booking-toast";
import { useActiveLocale } from "@/lib/i18n/client";

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
  const router = useRouter();

  useNewBookingToast({ orgId, enabled: true, isEn });

  const [open, setOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<DataTableRow[]>([]);
  const [bulkActionPending, setBulkActionPending] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-reservation-sheet", handler);
    return () => window.removeEventListener("open-reservation-sheet", handler);
  }, []);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [unitId, setUnitId] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const [activeViewId, setActiveViewId] = useState("all");

  const savedViews = useMemo(() => getAllViews(), []);

  const applySavedView = (view: ReservationSavedView) => {
    setActiveViewId(view.id);
    setStatus(view.statusFilter);
    setSourceFilter(view.sourceFilter);
    setUnitId(view.unitId);
    setQuickFilter(view.quickFilter as QuickFilter);
  };

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

        source: asString(row.source).trim() || null,
        listing_public_slug: asString(row.listing_public_slug).trim() || null,
      } satisfies DataTableRow;
    });
  }, [reservations]);

  const kpiStats = useMemo(() => {
    let arrivalsToday = 0;
    let departuresToday = 0;
    let inHouse = 0;
    let marketplace = 0;

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
      if (asString(row.source).toLowerCase() === "direct_booking") {
        marketplace++;
      }
    }

    return { arrivalsToday, departuresToday, inHouse, marketplace };
  }, [allRows, today]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const normalizedStatus = status.trim().toLowerCase();

    return allRows.filter((row) => {
      const rowStatus = asString(row.status).trim().toLowerCase();

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
      } else if (quickFilter === "pending" && rowStatus !== "pending")
        return false;

      if (
        quickFilter === "all" &&
        normalizedStatus !== "all" &&
        rowStatus !== normalizedStatus
      ) {
        return false;
      }

      const rowUnitId = asString(row.unit_id).trim();
      if (unitId !== "all" && rowUnitId !== unitId) {
        return false;
      }

      if (sourceFilter !== "all") {
        const rowSource = asString(row.source).trim().toLowerCase();
        if (sourceFilter === "direct_booking" && rowSource !== "direct_booking")
          return false;
        if (
          sourceFilter === "manual" &&
          rowSource !== "manual" &&
          rowSource !== ""
        )
          return false;
        if (sourceFilter === "external" && rowSource !== "external")
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
        row.source,
      ]
        .map((value) => asString(value).trim().toLowerCase())
        .filter(Boolean)
        .join(" | ");

      return haystack.includes(needle);
    });
  }, [
    allRows,
    from,
    query,
    quickFilter,
    sourceFilter,
    status,
    to,
    today,
    unitId,
  ]);

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

  const handleBulkAction = useCallback(
    async (targetStatus: string) => {
      const ids = selectedRows
        .map((r) => asString(r.id).trim())
        .filter(Boolean);
      if (ids.length === 0) return;
      setBulkActionPending(true);
      try {
        await bulkTransitionReservationStatusAction(ids, targetStatus);
        setSelectedRows([]);
        router.refresh();
        setBulkActionPending(false);
      } catch {
        setBulkActionPending(false);
      }
    },
    [selectedRows, router]
  );

  const handleStatusChange = useCallback((value: string) => {
    setStatus(value);
    if (value !== "all") setQuickFilter("all");
  }, []);

  return (
    <div className="space-y-4">
      <ReservationsStats
        isEn={isEn}
        kpiStats={kpiStats}
        locale={locale}
        periodRevenue={periodRevenue}
        total={total}
      />

      <ReservationsToolbar
        activeViewId={activeViewId}
        isEn={isEn}
        onApplySavedView={applySavedView}
        savedViews={savedViews}
      />

      <ReservationsFilters
        filteredRows={filteredRows}
        from={from}
        isEn={isEn}
        locale={locale}
        onFromChange={setFrom}
        onQueryChange={setQuery}
        onSourceFilterChange={setSourceFilter}
        onStatusChange={handleStatusChange}
        onToChange={setTo}
        onUnitIdChange={setUnitId}
        query={query}
        sourceFilter={sourceFilter}
        status={status}
        to={to}
        total={total}
        unitId={unitId}
        unitOptions={unitOptions}
      />

      <ReservationsTrendChart
        isEn={isEn}
        trendConfig={reservationsTrendConfig}
        trendData={reservationsTrendData}
      />

      <ReservationsTable
        bulkActionPending={bulkActionPending}
        filteredRows={filteredRows}
        isEn={isEn}
        locale={locale}
        onBulkAction={handleBulkAction}
        onClearSelection={() => setSelectedRows([])}
        onRowClick={handleRowClick}
        onSelectionChange={setSelectedRows}
        selectedRows={selectedRows}
      />

      <ReservationFormSheet
        isEn={isEn}
        locale={locale}
        onOpenChange={setOpen}
        open={open}
        orgId={orgId}
        unitOptions={unitOptions}
      />
    </div>
  );
}
