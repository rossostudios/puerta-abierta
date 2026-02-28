"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useState,
} from "react";

import { useActiveLocale } from "@/lib/i18n/client";

import { CollectionsAgingTable } from "./collections-aging-table";
import { CollectionsListTable } from "./collections-list-table";
import { CollectionsSummary } from "./collections-summary";
import { CollectionsToolbar } from "./collections-toolbar";
import {
  asNumber,
  asString,
  type CollectionRow,
  computeAgingRows,
  computeSummaries,
  exportCollectionsCsv,
  overdueDays,
  statusLabel,
} from "./collections-utils";
import { CreateCollectionSheet } from "./create-collection-sheet";
import { MarkPaidSheet } from "./mark-paid-sheet";

export function CollectionsManager({
  orgId,
  collections,
  leases,
}: {
  orgId: string;
  collections: Record<string, unknown>[];
  leases: Record<string, unknown>[];
}) {
  return (
    <Suspense fallback={null}>
      <CollectionsManagerInner
        collections={collections}
        leases={leases}
        orgId={orgId}
      />
    </Suspense>
  );
}

function CollectionsManagerInner({
  orgId,
  collections,
  leases,
}: {
  orgId: string;
  collections: Record<string, unknown>[];
  leases: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    const suffix = params.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  }, [pathname, searchParams]);

  const [open, setOpen] = useState(false);
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "aging">("list");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<CollectionRow[]>(() => {
    return collections.map((row) => {
      const due_date = asString(row.due_date).trim();
      const status = asString(row.status).trim();
      return {
        id: asString(row.id).trim(),
        lease_id: asString(row.lease_id).trim(),
        tenant_full_name: asString(row.tenant_full_name).trim() || null,
        status,
        status_label: statusLabel(status, isEn),
        due_date,
        overdue_days: overdueDays(due_date, status),
        amount: asNumber(row.amount),
        currency: asString(row.currency).trim().toUpperCase() || "PYG",
        payment_method: asString(row.payment_method).trim() || null,
        payment_reference: asString(row.payment_reference).trim() || null,
        paid_at: asString(row.paid_at).trim() || null,
        lease_status: asString(row.lease_status).trim() || null,
      } satisfies CollectionRow;
    });
  }, [collections, isEn]);

  const summaries = useMemo(() => computeSummaries(rows), [rows]);

  const [optimisticRows, queueOptimisticRowUpdate] = useOptimistic(
    rows,
    (
      currentRows,
      action:
        | { type: "mark-paid"; collectionId: string; paidAt: string }
        | { type: "set-status"; collectionId: string; status: string }
    ) => {
      return currentRows.map((row) => {
        if (row.id !== action.collectionId) return row;
        if (action.type === "mark-paid") {
          return {
            ...row,
            status: "paid",
            status_label: statusLabel("paid", isEn),
            paid_at: action.paidAt,
            overdue_days: 0,
          };
        }
        return {
          ...row,
          status: action.status,
          status_label: statusLabel(action.status, isEn),
        };
      });
    }
  );

  const leaseOptions = useMemo(() => {
    return leases
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        const tenant = asString(row.tenant_full_name).trim();
        const property = asString(row.property_name).trim();
        const unit = asString(row.unit_name).trim();
        return {
          id,
          label: [tenant || id, property, unit].filter(Boolean).join(" · "),
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [leases]);

  const exportCsv = useCallback(
    () => exportCollectionsCsv(optimisticRows, today),
    [optimisticRows, today]
  );

  const agingRows = useMemo(
    () => computeAgingRows(optimisticRows),
    [optimisticRows]
  );

  const handleMarkPaid = useCallback((id: string) => {
    setMarkPaidId(id);
  }, []);

  const handleMarkPaidSubmit = useCallback(() => {
    if (markPaidId) {
      queueOptimisticRowUpdate({
        type: "mark-paid",
        collectionId: markPaidId,
        paidAt: new Date().toISOString(),
      });
    }
    setMarkPaidId(null);
  }, [markPaidId, queueOptimisticRowUpdate]);

  return (
    <div className="space-y-4">
      <CollectionsSummary isEn={isEn} locale={locale} summaries={summaries} />

      <CollectionsToolbar
        isEn={isEn}
        onExportCsv={exportCsv}
        onNewCollection={() => setOpen(true)}
        onViewModeChange={setViewMode}
        rowCount={optimisticRows.length}
        viewMode={viewMode}
      />

      {viewMode === "aging" ? (
        <CollectionsAgingTable
          agingRows={agingRows}
          isEn={isEn}
          locale={locale}
        />
      ) : null}

      {viewMode === "list" ? (
        <CollectionsListTable
          isEn={isEn}
          locale={locale}
          nextPath={nextPath}
          onMarkPaid={handleMarkPaid}
          rows={optimisticRows}
        />
      ) : null}

      <MarkPaidSheet
        isEn={isEn}
        locale={locale}
        markPaidId={markPaidId}
        nextPath={nextPath}
        onClose={() => setMarkPaidId(null)}
        onSubmit={handleMarkPaidSubmit}
        orgId={orgId}
        today={today}
      />

      <CreateCollectionSheet
        isEn={isEn}
        leaseOptions={leaseOptions}
        locale={locale}
        nextPath={nextPath}
        onOpenChange={setOpen}
        open={open}
        orgId={orgId}
        today={today}
      />
    </div>
  );
}
