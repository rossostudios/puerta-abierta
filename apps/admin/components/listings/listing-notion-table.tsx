"use client";

import {
  Bathtub01Icon,
  BedDoubleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  City01Icon,
  DollarCircleIcon,
  Home01Icon,
  Link01Icon,
  Megaphone01Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  PipelineIcon,
  RepairIcon,
  Rocket01Icon,
  RulerIcon,
  Task01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import type { ListingRow } from "@/app/(admin)/module/listings/listings-manager";
import { EditableCell } from "@/components/properties/editable-cell";
import {
  ListingsFilterBar,
  type ListingReadinessFilter,
  type ListingStatusFilter,
} from "@/components/listings/listings-filter-bar";
import type { SavedView } from "@/lib/features/listings/saved-views";
import { ReadinessRing } from "@/components/listings/readiness-ring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  readColumnVisibility,
  writeColumnVisibility,
  type ColumnVisibilityMap,
} from "@/lib/features/listings/column-visibility";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROPERTY_TYPES } from "@/lib/features/marketplace/constants";
import { formatCurrency } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/* ---------- helpers ---------- */

function ColHeader({
  icon,
  label,
}: {
  icon: typeof Megaphone01Icon;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="text-muted-foreground/70" icon={icon} size={13} />
      <span>{label}</span>
    </span>
  );
}

const PROPERTY_TYPE_OPTIONS = PROPERTY_TYPES.map((pt) => ({
  label: pt.labelEn,
  value: pt.value,
}));

function propertyTypeLabel(value: string | null, isEn: boolean): string {
  if (!value) return "";
  const found = PROPERTY_TYPES.find((pt) => pt.value === value);
  if (!found) return value;
  return isEn ? found.labelEn : found.labelEs;
}

const READINESS_DIMENSIONS: {
  field: string;
  label: string;
  labelEs: string;
  weight: number;
  critical: boolean;
}[] = [
  { field: "cover_image", label: "Cover Image", labelEs: "Imagen de portada", weight: 25, critical: true },
  { field: "fee_lines", label: "Fee Breakdown", labelEs: "Desglose de cuotas", weight: 25, critical: true },
  { field: "amenities", label: "Amenities", labelEs: "Amenidades", weight: 15, critical: false },
  { field: "bedrooms", label: "Bedrooms", labelEs: "Habitaciones", weight: 10, critical: false },
  { field: "square_meters", label: "Area (m²)", labelEs: "Área (m²)", weight: 10, critical: false },
  { field: "available_from", label: "Available From", labelEs: "Disponible desde", weight: 5, critical: false },
  { field: "minimum_lease", label: "Minimum Lease", labelEs: "Contrato mínimo", weight: 5, critical: false },
  { field: "description", label: "Description", labelEs: "Descripción", weight: 5, critical: false },
];

function readinessLevel(score: number): "green" | "yellow" | "red" {
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  return "red";
}


/* ---------- types ---------- */

type OptimisticAction = {
  id: string;
  field: keyof ListingRow;
  value: string;
};

type Props = {
  rows: ListingRow[];
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onEditInSheet: (row: ListingRow) => void;
  onMakeReady: (row: ListingRow) => void;
  onPublish: (listingId: string) => void;
  onUnpublish: (listingId: string) => void;
  onPreview: (row: ListingRow) => void;
  onCommitEdit: (
    listingId: string,
    field: string,
    value: string
  ) => Promise<{ ok: boolean; error?: string }>;
  /* server-side state */
  sorting: SortingState;
  onSortingChange: React.Dispatch<React.SetStateAction<SortingState>>;
  pagination: PaginationState;
  onPaginationChange: React.Dispatch<React.SetStateAction<PaginationState>>;
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  readinessFilter: string;
  onReadinessFilterChange: (value: string) => void;
  totalRows: number;
  pageCount: number;
  isLoading: boolean;
  activeViewId?: string | null;
  onApplyView?: (view: SavedView) => void;
};

/* ---------- component ---------- */

export function ListingNotionTable({
  rows,
  isEn,
  formatLocale,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onEditInSheet,
  onMakeReady,
  onPublish,
  onUnpublish,
  onPreview,
  onCommitEdit,
  sorting,
  onSortingChange,
  pagination,
  onPaginationChange,
  globalFilter,
  onGlobalFilterChange,
  statusFilter,
  onStatusFilterChange,
  readinessFilter,
  onReadinessFilterChange,
  totalRows,
  pageCount,
  isLoading,
  activeViewId,
  onApplyView,
}: Props) {
  const [, startTransition] = useTransition();

  /* --- optimistic editing --- */
  const [optimisticRows, addOptimistic] = useOptimistic(
    rows,
    (current: ListingRow[], action: OptimisticAction) =>
      current.map((r) =>
        r.id === action.id ? { ...r, [action.field]: action.value } : r
      )
  );

  const commitEdit = useCallback(
    async (listingId: string, field: string, next: string) => {
      startTransition(() => {
        addOptimistic({
          id: listingId,
          field: field as keyof ListingRow,
          value: next,
        });
      });

      const result = await onCommitEdit(listingId, field, next);

      if (!result.ok) {
        toast.error(isEn ? "Failed to save" : "Error al guardar", {
          description: result.error,
        });
      } else {
        toast.success(isEn ? "Saved" : "Guardado");
      }
    },
    [addOptimistic, isEn, startTransition, onCommitEdit]
  );

  /* --- client-side readiness filter (readiness is not server-filterable) --- */
  const filteredData = useMemo(() => {
    if (readinessFilter === "all") return optimisticRows;
    return optimisticRows.filter((r) => {
      const level = readinessLevel(r.readiness_score);
      if (readinessFilter === "ready") return level === "green";
      if (readinessFilter === "incomplete") return level === "yellow";
      return level === "red";
    });
  }, [optimisticRows, readinessFilter]);

  /* --- user column visibility (persisted) --- */
  const [userColumnPrefs, setUserColumnPrefs] = useState<ColumnVisibilityMap>(() =>
    readColumnVisibility()
  );

  const toggleColumnPref = useCallback((colId: string) => {
    setUserColumnPrefs((prev) => {
      const next = { ...prev, [colId]: prev[colId] === false ? true : false };
      writeColumnVisibility(next);
      return next;
    });
  }, []);

  /* --- responsive column visibility (merged with user prefs) --- */
  const isSm = useMediaQuery("(min-width: 640px)");
  const isMd = useMediaQuery("(min-width: 768px)");
  const isLg = useMediaQuery("(min-width: 1024px)");

  const responsiveDefaults = useMemo<VisibilityState>(() => ({
    city: isSm,
    monthly_recurring_total: isSm,
    property_type: isMd,
    bedrooms: isMd,
    bathrooms: isMd,
    square_meters: isMd,
    readiness: isLg,
    pipeline: isLg,
  }), [isSm, isMd, isLg]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const merged = { ...responsiveDefaults };
    for (const colId of Object.keys(userColumnPrefs)) {
      // User can hide columns, but can't force-show columns hidden by responsive rules
      if (responsiveDefaults[colId] === false) continue;
      merged[colId] = userColumnPrefs[colId] !== false;
    }
    return merged;
  }, [responsiveDefaults, userColumnPrefs]);

  /* --- columns --- */
  const columns = useMemo<ColumnDef<ListingRow>[]>(
    () => [
      {
        id: "select",
        size: 40,
        minSize: 40,
        maxSize: 40,
        enableResizing: false,
        enableSorting: false,
        header: ({ table: t }) => {
          const pageRowIds = t
            .getRowModel()
            .rows.map((r) => r.original.id);
          const allPageSelected =
            pageRowIds.length > 0 &&
            pageRowIds.every((id) => selectedIds.has(id));
          return (
            <Checkbox
              aria-label="Select all"
              checked={allPageSelected}
              onCheckedChange={() => onToggleSelectAll(pageRowIds)}
            />
          );
        },
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={selectedIds.has(row.original.id)}
            onCheckedChange={() => onToggleSelect(row.original.id)}
          />
        ),
      },
      {
        accessorKey: "title",
        size: 220,
        minSize: 140,
        header: () => (
          <ColHeader
            icon={Megaphone01Icon}
            label={isEn ? "Listing" : "Anuncio"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          const parts = [data.property_name, data.unit_name].filter(Boolean);
          if (!isSm && data.city) parts.push(data.city);
          const subtitle = parts.join(" · ");
          return (
            <EditableCell
              displayNode={
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-foreground text-sm truncate">
                    {data.title}
                  </span>
                  {subtitle ? (
                    <span className="text-muted-foreground text-xs truncate">
                      {subtitle}
                    </span>
                  ) : null}
                </div>
              }
              onCommit={(next) => commitEdit(data.id, "title", next)}
              value={data.title}
            />
          );
        },
      },
      {
        accessorKey: "is_published",
        size: 110,
        minSize: 90,
        header: () => (
          <ColHeader
            icon={CheckmarkCircle02Icon}
            label={isEn ? "Status" : "Estado"}
          />
        ),
        cell: ({ row }) => {
          return row.original.is_published ? (
            <Badge variant="secondary">
              {isEn ? "Published" : "Publicado"}
            </Badge>
          ) : (
            <Badge variant="outline">{isEn ? "Draft" : "Borrador"}</Badge>
          );
        },
      },
      {
        id: "readiness",
        size: 120,
        minSize: 90,
        enableSorting: false,
        header: () => (
          <ColHeader
            icon={Task01Icon}
            label={isEn ? "Readiness" : "Preparación"}
          />
        ),
        cell: ({ row }) => {
          const { readiness_score, readiness_blocking } = row.original;
          const blockingSet = new Set(readiness_blocking);

          return (
            <Tooltip>
              <TooltipTrigger>
                <div className="inline-flex items-center gap-1.5 cursor-default">
                  <ReadinessRing score={readiness_score} />
                  <span className="tabular-nums text-xs font-medium">
                    {readiness_score}%
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-[220px] p-2.5" side="left">
                <ul className="space-y-1">
                  {READINESS_DIMENSIONS.map((dim) => {
                    const satisfied = !blockingSet.has(dim.field);
                    return (
                      <li
                        className="flex items-center gap-1.5 text-[11px]"
                        key={dim.field}
                      >
                        <Icon
                          className={
                            satisfied
                              ? "text-emerald-500"
                              : "text-muted-foreground/50"
                          }
                          icon={satisfied ? CheckmarkCircle02Icon : Cancel01Icon}
                          size={12}
                        />
                        <span
                          className={
                            satisfied
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }
                        >
                          {isEn ? dim.label : dim.labelEs}
                        </span>
                        <span className="ml-auto text-muted-foreground/60 text-[10px]">
                          {dim.weight}pt
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </TooltipContent>
            </Tooltip>
          );
        },
      },
      {
        accessorKey: "city",
        size: 130,
        minSize: 80,
        header: () => (
          <ColHeader icon={City01Icon} label={isEn ? "City" : "Ciudad"} />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              onCommit={(next) => commitEdit(data.id, "city", next)}
              value={data.city}
            />
          );
        },
      },
      {
        accessorKey: "property_type",
        size: 120,
        minSize: 90,
        header: () => (
          <ColHeader
            icon={Home01Icon}
            label={isEn ? "Type" : "Tipo"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={
                <span className="text-sm">
                  {propertyTypeLabel(data.property_type, isEn) || "\u00A0"}
                </span>
              }
              onCommit={(next) =>
                commitEdit(data.id, "property_type", next)
              }
              options={PROPERTY_TYPE_OPTIONS}
              type="select"
              value={data.property_type ?? ""}
            />
          );
        },
      },
      {
        accessorKey: "bedrooms",
        size: 70,
        minSize: 60,
        header: () => (
          <ColHeader icon={BedDoubleIcon} label={isEn ? "Bd" : "Hab"} />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              onCommit={(next) => commitEdit(data.id, "bedrooms", next)}
              value={String(data.bedrooms)}
            />
          );
        },
      },
      {
        accessorKey: "bathrooms",
        size: 70,
        minSize: 60,
        header: () => (
          <ColHeader icon={Bathtub01Icon} label={isEn ? "Ba" : "Ba"} />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              onCommit={(next) => commitEdit(data.id, "bathrooms", next)}
              value={String(data.bathrooms)}
            />
          );
        },
      },
      {
        accessorKey: "square_meters",
        size: 80,
        minSize: 60,
        header: () => <ColHeader icon={RulerIcon} label="m²" />,
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              onCommit={(next) => commitEdit(data.id, "square_meters", next)}
              value={String(data.square_meters)}
            />
          );
        },
      },
      {
        accessorKey: "monthly_recurring_total",
        size: 130,
        minSize: 100,
        header: () => (
          <ColHeader
            icon={DollarCircleIcon}
            label={isEn ? "Monthly" : "Mensual"}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {formatCurrency(
              row.original.monthly_recurring_total,
              row.original.currency,
              formatLocale
            )}
          </span>
        ),
      },
      {
        id: "pipeline",
        size: 90,
        minSize: 70,
        accessorFn: (row) => row.application_count,
        header: () => (
          <ColHeader
            icon={PipelineIcon}
            label={isEn ? "Pipeline" : "Pipeline"}
          />
        ),
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="space-y-1 text-sm">
              <p>
                {d.application_count} {isEn ? "apps" : "apps"}
              </p>
              {d.active_lease_count > 0 ? (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  {isEn ? "Leased" : "Arrendado"}
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "actions",
        size: 48,
        minSize: 48,
        maxSize: 48,
        enableResizing: false,
        enableSorting: false,
        cell: ({ row }) => {
          const listing = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "h-7 w-7 p-0"
                )}
              >
                <span className="sr-only">Open menu</span>
                <Icon icon={MoreVerticalIcon} size={15} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {isEn ? "Actions" : "Acciones"}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onEditInSheet(listing)}>
                  <Icon className="mr-2" icon={PencilEdit02Icon} size={14} />
                  {isEn ? "Edit" : "Editar"}
                </DropdownMenuItem>
                {listing.readiness_blocking.length > 0 ? (
                  <DropdownMenuItem onClick={() => onMakeReady(listing)}>
                    <Icon className="mr-2" icon={RepairIcon} size={14} />
                    {isEn ? "Make ready" : "Completar"}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => onPreview(listing)}>
                  <Icon className="mr-2" icon={ViewIcon} size={14} />
                  {isEn ? "Preview" : "Vista previa"}
                </DropdownMenuItem>
                {listing.public_slug ? (
                  <DropdownMenuItem
                    onClick={() =>
                      window.open(
                        `/marketplace/${encodeURIComponent(listing.public_slug)}`,
                        "_blank"
                      )
                    }
                  >
                    <Icon className="mr-2" icon={Link01Icon} size={14} />
                    {isEn ? "View public" : "Ver público"}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                {listing.is_published ? (
                  <DropdownMenuItem onClick={() => onUnpublish(listing.id)}>
                    <Icon className="mr-2" icon={Rocket01Icon} size={14} />
                    {isEn ? "Unpublish" : "Despublicar"}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onPublish(listing.id)}>
                    <Icon className="mr-2" icon={Rocket01Icon} size={14} />
                    {isEn ? "Publish" : "Publicar"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isEn,
      isSm,
      formatLocale,
      commitEdit,
      selectedIds,
      onToggleSelect,
      onToggleSelectAll,
      onEditInSheet,
      onMakeReady,
      onPublish,
      onUnpublish,
      onPreview,
    ]
  );

  /* --- table instance (manual mode) --- */
  const table = useReactTable({
    data: filteredData,
    columns,
    columnResizeMode: "onChange",
    manualPagination: true,
    manualSorting: true,
    state: { sorting, pagination, columnVisibility },
    onSortingChange,
    onPaginationChange,
    pageCount,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-3">
      <ListingsFilterBar
        activeViewId={activeViewId}
        columnVisibility={columnVisibility}
        globalFilter={globalFilter}
        isEn={isEn}
        onApplyView={onApplyView}
        onGlobalFilterChange={onGlobalFilterChange}
        onReadinessFilterChange={(v) =>
          onReadinessFilterChange(v as ListingReadinessFilter)
        }
        onStatusFilterChange={(v) =>
          onStatusFilterChange(v as ListingStatusFilter)
        }
        onToggleColumn={toggleColumnPref}
        readinessFilter={readinessFilter as ListingReadinessFilter}
        responsiveDefaults={responsiveDefaults}
        sorting={sorting}
        statusFilter={statusFilter as ListingStatusFilter}
      />

      <div className="overflow-x-auto rounded-md border">
        <Table
          className="table-fixed w-full"
          style={{ minWidth: table.getTotalSize() }}
        >
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead
                    className="relative whitespace-nowrap select-none text-[11px] uppercase tracking-wider"
                    grid
                    key={header.id}
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        className="inline-flex items-center gap-1 hover:underline"
                        onClick={header.column.getToggleSortingHandler()}
                        type="button"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {header.column.getIsSorted() === "asc"
                          ? " \u2191"
                          : header.column.getIsSorted() === "desc"
                            ? " \u2193"
                            : ""}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )
                    )}

                    {header.column.getCanResize() && (
                      <div
                        className={cn(
                          "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none",
                          "hover:bg-primary/30",
                          header.column.getIsResizing() && "bg-primary/50"
                        )}
                        onDoubleClick={() => header.column.resetSize()}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  className="py-8 text-center text-muted-foreground"
                  colSpan={table.getVisibleLeafColumns().length}
                >
                  {isEn ? "Loading..." : "Cargando..."}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  className="hover:bg-muted/20"
                  data-state={selectedIds.has(row.original.id) && "selected"}
                  key={row.id}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      className="py-1.5"
                      grid
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  className="py-8 text-center text-muted-foreground"
                  colSpan={table.getVisibleLeafColumns().length}
                >
                  {isEn ? "No listings found" : "No se encontraron anuncios"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>

          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell
                className="font-medium text-xs"
                colSpan={table.getVisibleLeafColumns().length}
              >
                {totalRows} {isEn ? "listings" : "anuncios"}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground text-sm">
          {totalRows} {isEn ? "listings" : "anuncios"}
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            size="sm"
            variant="outline"
          >
            {isEn ? "Previous" : "Anterior"}
          </Button>
          <span className="text-muted-foreground text-sm">
            {pagination.pageIndex + 1} / {pageCount}
          </span>
          <Button
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            size="sm"
            variant="outline"
          >
            {isEn ? "Next" : "Siguiente"}
          </Button>
        </div>
      </div>
    </div>
  );
}
