"use client";

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Copy01Icon,
  FileSearchIcon,
  InboxIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import {
  type ColumnDef,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import Link from "next/link";
import type React from "react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HoverLink } from "@/components/ui/hover-link";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { humanizeKey } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";
import { FOREIGN_KEY_HREF_BASE_BY_KEY } from "@/lib/links";
import { cn } from "@/lib/utils";

export type DataTableRow = Record<string, unknown>;

export type EmptyStateConfig = {
  title: string;
  description: string;
  icon?: typeof InboxIcon;
  actionLabel?: string;
  actionHref?: string;
  secondaryActions?: Array<{ label: string; href: string }>;
};

type DataTableProps<TRow extends DataTableRow = DataTableRow> = {
  data: TRow[];
  columns?: ColumnDef<TRow>[];
  defaultPageSize?: number;
  locale?: Locale;
  searchPlaceholder?: string;
  hideSearch?: boolean;
  renderRowActions?: (row: TRow) => ReactNode;
  rowActionsHeader?: string;
  rowHrefBase?: string;
  foreignKeyHrefBaseByKey?: Record<string, string>;
  onRowClick?: (row: TRow) => void;
  emptyStateConfig?: EmptyStateConfig;
  borderless?: boolean;
  footer?: ReactNode;
  focusedRowIndex?: number;
};


const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function idKeyFromNameKey(key: string): string {
  return key.endsWith("_name") ? `${key.slice(0, -5)}_id` : key;
}

function nameKeyFromIdKey(key: string): string {
  return key.endsWith("_id") ? `${key.slice(0, -3)}_name` : key;
}

function baseKeyFromIdKey(key: string): string {
  return key.endsWith("_id") ? key.slice(0, -3) : key;
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function isIdKey(key: string): boolean {
  return key === "id" || key.endsWith("_id");
}

function isUuidString(value: string): boolean {
  return UUID_RE.test(value);
}

function metaFromHrefBase(base: string | undefined | null): string | null {
  if (!base) return null;
  const slug = base.split("/").filter(Boolean).pop();
  if (!slug) return null;
  return humanizeKey(slug.replaceAll("-", "_"));
}

function asDateLabel(value: string, locale: Locale): string | null {
  if (!(ISO_DATE_TIME_RE.test(value) || ISO_DATE_RE.test(value))) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;

  if (ISO_DATE_RE.test(value)) {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date
    );
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function stringifyForFilter(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value).toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

const globalFilterFn: FilterFn<DataTableRow> = (row, columnId, filterValue) => {
  const needle = String(filterValue ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return true;
  const haystack = stringifyForFilter(row.getValue(columnId));
  return haystack.includes(needle);
};

function keysFromRows(rows: DataTableRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      set.add(key);
    }
  }
  const keys = Array.from(set);

  const priority = [
    "id",
    "name",
    "title",
    "code",
    "status",
    "kind",
    "organization_id",
    "property_id",
    "unit_id",
    "channel_id",
    "listing_id",
    "guest_id",
    "reservation_id",
    "template_id",
    "assigned_user_id",
    "check_in_date",
    "check_out_date",
    "starts_on",
    "ends_on",
    "created_at",
    "updated_at",
  ];

  // Use sparse numeric buckets so we can slot friendly *_name fields immediately
  // after their corresponding *_id keys.
  const score = new Map(priority.map((key, index) => [key, index * 10]));
  const scoreFor = (key: string): number => {
    const direct = score.get(key);
    if (direct !== undefined) return direct;

    if (key.endsWith("_name")) {
      const idKey = idKeyFromNameKey(key);
      const idScore = score.get(idKey);
      if (idScore !== undefined) return idScore + 1;
    }

    return Number.POSITIVE_INFINITY;
  };

  return keys.sort((a, b) => {
    const aScore = scoreFor(a);
    const bScore = scoreFor(b);
    if (aScore !== bScore) return aScore - bScore;
    return a.localeCompare(b);
  });
}

function firstNonNullValue(rows: DataTableRow[], key: string): unknown {
  for (const row of rows) {
    const value = row[key];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function DataIdCell({
  value,
  href,
  label,
  meta,
  locale,
}: {
  value: string;
  href?: string | null;
  label?: string;
  meta?: string | null;
  locale: Locale;
}) {
  const [copied, setCopied] = useState(false);
  const isEn = locale === "en-US";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(isEn ? "Copied to clipboard" : "Copiado al portapapeles", {
        description: shortId(value),
      });
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error(isEn ? "Could not copy" : "No se pudo copiar", {
        description: isEn
          ? "Your browser blocked clipboard access."
          : "Tu navegador bloqueó el acceso al portapapeles.",
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      {href ? (
        <HoverLink
          className="font-mono text-primary text-xs underline-offset-4 hover:underline"
          description={
            isEn ? "Open record details." : "Abrir el detalle del registro."
          }
          href={href}
          id={value}
          label={label ?? (isEn ? "Open details" : "Abrir detalle")}
          meta={meta ?? undefined}
        >
          <span
            title={
              isEn ? `Open details for ${value}` : `Abrir detalle de ${value}`
            }
          >
            {shortId(value)}
          </span>
        </HoverLink>
      ) : (
        <span className="font-mono text-xs" title={value}>
          {shortId(value)}
        </span>
      )}
      <button
        aria-label={isEn ? "Copy value" : "Copiar valor"}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-7 w-7"
        )}
        onClick={onCopy}
        title={isEn ? "Copy" : "Copiar"}
        type="button"
      >
        <Icon icon={copied ? Tick01Icon : Copy01Icon} size={14} />
      </button>
    </div>
  );
}

function DataCell({
  columnKey,
  value,
  row,
  rowHrefBase,
  foreignKeyHrefBaseByKey,
  locale,
}: {
  columnKey: string;
  value: unknown;
  row: DataTableRow;
  rowHrefBase?: string;
  foreignKeyHrefBaseByKey?: Record<string, string>;
  locale: Locale;
}) {
  const isEn = locale === "en-US";

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (typeof value === "string") {
    if (columnKey === "status") {
      return <StatusBadge value={value} />;
    }

    const dateLabel = asDateLabel(value, locale);
    if (dateLabel) {
      return <span title={value}>{dateLabel}</span>;
    }

    const normalizedKey = columnKey.trim();
    const normalizedValue = value.trim();

    // Prefer human-readable links over raw IDs when possible.
    if (
      rowHrefBase &&
      ["name", "title", "public_name", "code"].includes(normalizedKey)
    ) {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (isUuidString(id)) {
        const meta = metaFromHrefBase(rowHrefBase);
        return (
          <HoverLink
            className="hover:underline"
            description={
              isEn ? "Open record details." : "Abrir el detalle del registro."
            }
            href={`${stripTrailingSlash(rowHrefBase)}/${id}`}
            id={id}
            label={normalizedValue}
            meta={meta ?? undefined}
            prefetch={false}
          >
            {normalizedValue}
          </HoverLink>
        );
      }
    }

    if (normalizedKey.endsWith("_name")) {
      const idKey = idKeyFromNameKey(normalizedKey);
      const idValue =
        typeof row[idKey] === "string" ? String(row[idKey]).trim() : "";
      const base = foreignKeyHrefBaseByKey?.[idKey];
      if (base && isUuidString(idValue)) {
        const meta = humanizeKey(baseKeyFromIdKey(idKey));
        return (
          <HoverLink
            className="text-primary underline-offset-4 hover:underline"
            description={
              isEn ? `Open ${meta} details.` : `Abrir detalle de ${meta}.`
            }
            href={`${stripTrailingSlash(base)}/${idValue}`}
            id={idValue}
            label={normalizedValue}
            meta={meta}
            prefetch={false}
          >
            {normalizedValue}
          </HoverLink>
        );
      }
    }

    if (isIdKey(columnKey) || isUuidString(value)) {
      let href: string | null = null;
      let meta: string | null = null;
      if (
        normalizedKey === "id" &&
        rowHrefBase &&
        isUuidString(normalizedValue)
      ) {
        href = `${stripTrailingSlash(rowHrefBase)}/${normalizedValue}`;
        meta = metaFromHrefBase(rowHrefBase);
      } else if (
        normalizedKey !== "id" &&
        foreignKeyHrefBaseByKey?.[normalizedKey] &&
        isUuidString(normalizedValue)
      ) {
        const base = foreignKeyHrefBaseByKey[normalizedKey];
        href = `${stripTrailingSlash(base)}/${normalizedValue}`;
        meta = metaFromHrefBase(base);
      }

      return (
        <DataIdCell
          href={href}
          label={humanizeKey(normalizedKey)}
          locale={locale}
          meta={meta}
          value={normalizedValue}
        />
      );
    }

    const trimmed = normalizedValue;
    const display =
      trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
    return (
      <span
        className={cn(
          "break-words",
          trimmed.length > 120 ? "text-muted-foreground" : ""
        )}
        title={trimmed}
      >
        {display}
      </span>
    );
  }

  if (typeof value === "number") {
    const formatted = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 2,
    }).format(value);
    return <span className="tabular-nums">{formatted}</span>;
  }

  if (typeof value === "boolean") {
    if (columnKey === "is_active") {
      return <StatusBadge value={value ? "active" : "inactive"} />;
    }
    return (
      <span className="font-medium">
        {value ? (isEn ? "Yes" : "Sí") : "No"}
      </span>
    );
  }

  if (Array.isArray(value)) {
    return (
      <span className="text-muted-foreground">{`Array(${value.length})`}</span>
    );
  }

  const raw = (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  })();

  const preview = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
  return (
    <span
      className="break-all font-mono text-muted-foreground text-xs"
      title={raw}
    >
      {preview}
    </span>
  );
}

function inferColumns(options: {
  rows: DataTableRow[];
  locale: Locale;
  rowHrefBase?: string;
  foreignKeyHrefBaseByKey?: Record<string, string>;
}): ColumnDef<DataTableRow>[] {
  const { rows, locale, rowHrefBase, foreignKeyHrefBaseByKey } = options;
  const keys = keysFromRows(rows);
  return keys.map((key) => {
    const sample = firstNonNullValue(rows, key);
    const isComplex = typeof sample === "object" && sample !== null;

    return {
      accessorKey: key,
      header: humanizeKey(key),
      enableSorting: !isComplex,
      cell: ({ getValue, row }) => (
        <DataCell
          columnKey={key}
          foreignKeyHrefBaseByKey={foreignKeyHrefBaseByKey}
          locale={locale}
          row={row.original}
          rowHrefBase={rowHrefBase}
          value={getValue()}
        />
      ),
    } satisfies ColumnDef<DataTableRow>;
  });
}

function FocusableTableRow({
  isFocused,
  children,
  ...props
}: React.ComponentProps<typeof TableRow> & { isFocused: boolean }) {
  const ref = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (isFocused && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isFocused]);

  return (
    <TableRow ref={ref} {...props}>
      {children}
    </TableRow>
  );
}

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

    // This value is constant given org context, so it clutters tables by default.
    next.organization_id = false;
    next.owner_user_id = false;

    // Prefer human-readable names over raw foreign key IDs when both exist.
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

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => defaultVisibility
  );
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  useEffect(() => {
    setColumnVisibility(defaultVisibility);
  }, [defaultVisibility]);

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
    onColumnVisibilityChange: setColumnVisibility,
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
    setColumnVisibility(defaultVisibility);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };

  const filteredRows = table.getFilteredRowModel().rows.length;
  const totalRows = table.getCoreRowModel().rows.length;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {!hideSearch && (
            <>
              <Input
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder={searchPlaceholder}
                value={globalFilter}
              />
              {active ? (
                <Button onClick={reset} size="sm" variant="outline">
                  {isEn ? "Reset" : "Reiniciar"}
                </Button>
              ) : null}
            </>
          )}
        </div>

        <details className="relative">
          <summary
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "cursor-pointer list-none"
            )}
          >
            {isEn ? "Columns" : "Columnas"}
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-md border bg-popover p-2 shadow-md">
            <p className="px-2 pb-1 font-medium text-muted-foreground text-xs">
              {isEn ? "Show/hide columns" : "Mostrar/ocultar columnas"}
            </p>
            <div className="max-h-64 overflow-auto">
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50"
                    key={column.id}
                  >
                    <input
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                      type="checkbox"
                    />
                    <span className="truncate">{humanizeKey(column.id)}</span>
                  </label>
                ))}
            </div>
          </div>
        </details>
      </div>

      <div className={cn("rounded-md border", borderless && "rounded-none border-0")}>
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const column = header.column;
                  const canSort = column.getCanSort();
                  const sortState = column.getIsSorted();

                  const SortIcon =
                    sortState === "asc"
                      ? ArrowUp01Icon
                      : sortState === "desc"
                        ? ArrowDown01Icon
                        : ArrowUpDownIcon;

                  return (
                    <TableHead className="whitespace-nowrap" key={header.id}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={column.getToggleSortingHandler()}
                          type="button"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          <Icon
                            className="text-muted-foreground"
                            icon={SortIcon}
                            size={14}
                          />
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, visualIndex) => {
                const isFocused = focusedRowIndex >= 0 && row.index === focusedRowIndex;
                return (
                  <FocusableTableRow
                    className={cn(
                      onRowClick ? "cursor-pointer hover:bg-muted/30" : "",
                      isFocused ? "ring-2 ring-primary/30 bg-primary/[0.03]" : ""
                    )}
                    isFocused={isFocused}
                    key={row.id}
                    onClick={(event) => {
                      if (!onRowClick) return;
                      const target = event.target as HTMLElement | null;
                      if (
                        target?.closest(
                          'a,button,input,select,textarea,label,[role="button"],[data-row-click="ignore"]'
                        )
                      ) {
                        return;
                      }
                      onRowClick(row.original);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        className="max-w-72 break-words align-top"
                        key={cell.id}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </FocusableTableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  className="p-0"
                  colSpan={table.getAllLeafColumns().length}
                >
                  {data.length === 0 ? (
                    <EmptyState
                      action={
                        emptyStateConfig ? (
                          <>
                            {emptyStateConfig.actionLabel && emptyStateConfig.actionHref ? (
                              <Link
                                className={cn(
                                  buttonVariants({
                                    variant: "default",
                                    size: "sm",
                                  })
                                )}
                                href={emptyStateConfig.actionHref}
                              >
                                {emptyStateConfig.actionLabel}
                              </Link>
                            ) : null}
                            {emptyStateConfig.secondaryActions?.map((sa) => (
                              <Link
                                className={cn(
                                  buttonVariants({
                                    variant: "outline",
                                    size: "sm",
                                  })
                                )}
                                href={sa.href}
                                key={sa.href}
                              >
                                {sa.label}
                              </Link>
                            ))}
                          </>
                        ) : rowHrefBase &&
                          [
                            "organizations",
                            "properties",
                            "units",
                            "channels",
                          ].includes(
                            String(rowHrefBase.split("/").filter(Boolean).pop())
                          ) ? (
                          <Link
                            className={cn(
                              buttonVariants({
                                variant: "outline",
                                size: "sm",
                              })
                            )}
                            href="/setup"
                          >
                            {isEn ? "Open onboarding" : "Abrir onboarding"}
                          </Link>
                        ) : null
                      }
                      className="py-14"
                      description={
                        emptyStateConfig?.description ?? (
                        isEn
                          ? "As you add data (onboarding, operations, or integrations), it will show up here."
                          : "Cuando agregues datos (onboarding, operaciones o integraciones), aparecerán aquí."
                        )
                      }
                      icon={emptyStateConfig?.icon ?? InboxIcon}
                      title={emptyStateConfig?.title ?? (isEn ? "No records" : "Sin registros")}
                    />
                  ) : (
                    <EmptyState
                      action={
                        active ? (
                          <Button
                            onClick={reset}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {isEn ? "Reset table" : "Reiniciar tabla"}
                          </Button>
                        ) : null
                      }
                      className="py-14"
                      description={
                        active
                          ? isEn
                            ? "Try clearing filters or showing hidden columns."
                            : "Prueba limpiar filtros o mostrar columnas ocultas."
                          : isEn
                            ? "There are no rows to show."
                            : "No hay filas para mostrar."
                      }
                      icon={FileSearchIcon}
                      title={isEn ? "No results" : "Sin resultados"}
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {footer}
        </Table>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="text-muted-foreground text-sm">
          {isEn ? (
            <>
              Showing{" "}
              <span className="font-medium text-foreground">
                {filteredRows}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">{totalRows}</span>{" "}
              rows
            </>
          ) : (
            <>
              Mostrando{" "}
              <span className="font-medium text-foreground">
                {filteredRows}
              </span>{" "}
              de{" "}
              <span className="font-medium text-foreground">{totalRows}</span>{" "}
              filas
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-muted-foreground text-sm">
            {isEn ? "Rows" : "Filas"}
            <select
              className="h-8 rounded-md border bg-background px-2 text-foreground text-sm"
              onChange={(event) =>
                table.setPageSize(Number(event.target.value))
              }
              value={table.getState().pagination.pageSize}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            <Button
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              size="sm"
              variant="outline"
            >
              {isEn ? "Previous" : "Anterior"}
            </Button>
            <Button
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              size="sm"
              variant="outline"
            >
              {isEn ? "Next" : "Siguiente"}
            </Button>
          </div>

          <div className="text-muted-foreground text-sm">
            {isEn ? "Page" : "Página"}{" "}
            <span className="font-medium text-foreground">
              {table.getState().pagination.pageIndex + 1}
            </span>{" "}
            {isEn ? "of" : "de"}{" "}
            <span className="font-medium text-foreground">
              {table.getPageCount()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
