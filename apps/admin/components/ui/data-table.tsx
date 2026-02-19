"use client";
"use no memo";

import {
  type ColumnDef,
  type FilterFn,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";

import { useActiveLocale } from "@/lib/i18n/client";
import { FOREIGN_KEY_HREF_BASE_BY_KEY } from "@/lib/links";

import { DataTableBody } from "./data-table-body";
import { inferColumns } from "./data-table-columns";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";
import {
  type DataTableRow,
  type DataTableProps,
  type EmptyStateConfig,
  globalFilterFn,
  keysFromRows,
  nameKeyFromIdKey,
} from "./data-table-types";

export type { DataTableRow, EmptyStateConfig };

export function DataTable<TRow extends DataTableRow = DataTableRow>({
  data,
  columns: columnsProp,
  defaultPageSize = 20,
  locale: localeProp,
  searchPlaceholder: searchPlaceholderProp,
  hideSearch = false,
  renderRowActions,
  rowActionsHeader,
  rowHrefBase,
  foreignKeyHrefBaseByKey,
  onRowClick,
  emptyStateConfig,
  borderless = false,
  footer,
  focusedRowIndex = -1,
}: DataTableProps<TRow>) {
  "use no memo";
  const activeLocale = useActiveLocale();
  const locale = localeProp ?? activeLocale;
  const isEn = locale === "en-US";

  const searchPlaceholder =
    searchPlaceholderProp ?? (isEn ? "Filter..." : "Filtrar...");

  const orderedKeys = useMemo(() => keysFromRows(data), [data]);
  const foreignKeyMap = useMemo(
    () => foreignKeyHrefBaseByKey ?? FOREIGN_KEY_HREF_BASE_BY_KEY,
    [foreignKeyHrefBaseByKey]
  );
  const inferredColumns = useMemo(() => {
    if (columnsProp) return null;
    return inferColumns({
      rows: data,
      locale,
      rowHrefBase,
      foreignKeyHrefBaseByKey: foreignKeyMap,
    });
  }, [columnsProp, data, foreignKeyMap, locale, rowHrefBase]);
  const columns = useMemo(() => {
    const baseColumns =
      columnsProp ?? ((inferredColumns ?? []) as ColumnDef<TRow>[]);

    if (!renderRowActions) return baseColumns;

    return [
      ...baseColumns,
      {
        id: "__actions",
        header: rowActionsHeader ?? "",
        enableSorting: false,
        enableHiding: false,
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            {renderRowActions(row.original)}
          </div>
        ),
      } satisfies ColumnDef<TRow>,
    ];
  }, [columnsProp, inferredColumns, renderRowActions, rowActionsHeader]);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const defaultVisibility = useMemo(() => {
    const visibleCount = 8;
    const next: VisibilityState = {};

    for (const [index, key] of orderedKeys.entries()) {
      if (index >= visibleCount) {
        next[key] = false;
      }
    }

    next.organization_id = false;
    next.owner_user_id = false;

    const keySet = new Set(orderedKeys);
    for (const key of orderedKeys) {
      if (key === "id") continue;
      if (!key.endsWith("_id")) continue;
      const nameKey = nameKeyFromIdKey(key);
      if (!keySet.has(nameKey)) continue;
      next[key] = false;
      next[nameKey] = true;
    }

    return next;
  }, [orderedKeys]);

  const [columnVisibilityOverrides, setColumnVisibilityOverrides] =
    useState<VisibilityState>({});
  const columnVisibility = useMemo(
    () => ({ ...defaultVisibility, ...columnVisibilityOverrides }),
    [columnVisibilityOverrides, defaultVisibility]
  );
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  const handleColumnVisibilityChange: OnChangeFn<VisibilityState> = useCallback(
    (updater) => {
      setColumnVisibilityOverrides((currentOverrides) => {
        const current = { ...defaultVisibility, ...currentOverrides };
        const next =
          typeof updater === "function"
            ? updater(current)
            : updater;

        const nextOverrides: VisibilityState = {};
        for (const [key, value] of Object.entries(next)) {
          if (defaultVisibility[key] !== value) {
            nextOverrides[key] = value;
          }
        }
        return nextOverrides;
      });
    },
    [defaultVisibility]
  );

  // eslint-disable-next-line react-hooks-js/incompatible-library
  const table = useReactTable<TRow>({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      pagination,
    },
    globalFilterFn: globalFilterFn as FilterFn<TRow>,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const active = useMemo(() => {
    const hasFilter = globalFilter.trim().length > 0;
    const hasSorting = sorting.length > 0;
    const visibilityKeys = new Set([
      ...Object.keys(defaultVisibility),
      ...Object.keys(columnVisibility),
    ]);

    const asVisible = (state: VisibilityState, key: string) =>
      state[key] === undefined ? true : state[key];
    const hasVisibilityChanges = Array.from(visibilityKeys).some(
      (key) =>
        asVisible(columnVisibility, key) !== asVisible(defaultVisibility, key)
    );

    return hasFilter || hasSorting || hasVisibilityChanges;
  }, [columnVisibility, defaultVisibility, globalFilter, sorting]);

  const reset = () => {
    setGlobalFilter("");
    setSorting([]);
    setColumnVisibilityOverrides({});
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };

  const filteredRows = table.getFilteredRowModel().rows.length;
  const totalRows = table.getCoreRowModel().rows.length;

  return (
    <div className="min-w-0 space-y-3">
      <DataTableToolbar
        active={active}
        globalFilter={globalFilter}
        hideSearch={hideSearch}
        isEn={isEn}
        reset={reset}
        searchPlaceholder={searchPlaceholder}
        setGlobalFilter={setGlobalFilter}
        table={table}
      />

      <DataTableBody
        active={active}
        borderless={borderless}
        dataLength={data.length}
        emptyStateConfig={emptyStateConfig}
        focusedRowIndex={focusedRowIndex}
        footer={footer}
        isEn={isEn}
        onRowClick={onRowClick}
        reset={reset}
        rowHrefBase={rowHrefBase}
        table={table}
      />

      <DataTablePagination
        filteredRows={filteredRows}
        isEn={isEn}
        table={table}
        totalRows={totalRows}
      />
    </div>
  );
}
