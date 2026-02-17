"use client";

import {
  BedDoubleIcon,
  CheckmarkCircle02Icon,
  City01Icon,
  DollarCircleIcon,
  Home01Icon,
  Link01Icon,
  Megaphone01Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  PipelineIcon,
  Rocket01Icon,
  Task01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { updateListingInlineAction } from "@/app/(admin)/module/listings/actions";
import type { ListingRow } from "@/app/(admin)/module/listings/listings-manager";
import { EditableCell } from "@/components/properties/editable-cell";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

import { readinessScore } from "@/app/(admin)/module/listings/listings-manager";

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

function propertyTypeLabel(
  value: string | null,
  isEn: boolean
): string {
  if (!value) return "";
  const found = PROPERTY_TYPES.find((pt) => pt.value === value);
  if (!found) return value;
  return isEn ? found.labelEn : found.labelEs;
}

/* ---------- types ---------- */

export type ListingSummary = {
  totalCount: number;
  publishedCount: number;
  draftCount: number;
  totalApplications: number;
};

type OptimisticAction = {
  id: string;
  field: keyof ListingRow;
  value: string;
};

type Props = {
  rows: ListingRow[];
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
  summary: ListingSummary;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onEditInSheet: (row: ListingRow) => void;
  onPublish: (listingId: string) => void;
  onUnpublish: (listingId: string) => void;
};

/* ---------- component ---------- */

export function ListingNotionTable({
  rows,
  isEn,
  formatLocale,
  summary,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onEditInSheet,
  onPublish,
  onUnpublish,
}: Props) {
  const [, startTransition] = useTransition();

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

      const result = await updateListingInlineAction({
        listingId,
        field,
        value: next,
      });

      if (!result.ok) {
        toast.error(isEn ? "Failed to save" : "Error al guardar", {
          description: result.error,
        });
      } else {
        toast.success(isEn ? "Saved" : "Guardado");
      }
    },
    [addOptimistic, isEn, startTransition]
  );

  const columns = useMemo<ColumnDef<ListingRow>[]>(
    () => [
      {
        id: "select",
        size: 40,
        minSize: 40,
        maxSize: 40,
        enableResizing: false,
        header: () => (
          <Checkbox
            aria-label="Select all"
            checked={selectedIds.size === rows.length && rows.length > 0}
            onCheckedChange={onToggleSelectAll}
          />
        ),
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
          const subtitle = [data.property_name, data.unit_name]
            .filter(Boolean)
            .join(" · ");
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
        header: () => (
          <ColHeader
            icon={Task01Icon}
            label={isEn ? "Readiness" : "Preparación"}
          />
        ),
        cell: ({ row }) => {
          const r = readinessScore(row.original);
          if (r.level === "green") {
            return (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                {isEn ? "Ready" : "Listo"}
              </Badge>
            );
          }
          if (r.level === "yellow") {
            return (
              <div className="space-y-1">
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  {isEn
                    ? `${r.missing.length} missing`
                    : `${r.missing.length} faltante(s)`}
                </Badge>
                <p className="max-w-[180px] text-muted-foreground text-[11px]">
                  {r.missing.join(", ")}
                </p>
              </div>
            );
          }
          return (
            <div className="space-y-1">
              <Badge variant="destructive">
                {isEn ? "Not ready" : "No listo"}
              </Badge>
              <p className="max-w-[180px] text-muted-foreground text-[11px]">
                {r.missing.join(", ")}
              </p>
            </div>
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
        id: "specs",
        size: 110,
        minSize: 80,
        header: () => (
          <ColHeader
            icon={BedDoubleIcon}
            label={isEn ? "Specs" : "Specs"}
          />
        ),
        cell: ({ row }) => {
          const d = row.original;
          return (
            <span className="text-sm tabular-nums">
              {d.bedrooms} {isEn ? "bd" : "hab"} · {d.bathrooms}{" "}
              {isEn ? "ba" : "ba"} · {d.square_meters} m²
            </span>
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
                {listing.public_slug ? (
                  <DropdownMenuItem
                    onClick={() =>
                      window.open(
                        `/marketplace/${encodeURIComponent(listing.public_slug)}`,
                        "_blank"
                      )
                    }
                  >
                    <Icon className="mr-2" icon={ViewIcon} size={14} />
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
                <DropdownMenuItem
                  onClick={() => navigator.clipboard.writeText(listing.id)}
                >
                  <Icon className="mr-2" icon={Link01Icon} size={14} />
                  {isEn ? "Copy ID" : "Copiar ID"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [
      isEn,
      formatLocale,
      commitEdit,
      selectedIds,
      rows.length,
      onToggleSelect,
      onToggleSelectAll,
      onEditInSheet,
      onPublish,
      onUnpublish,
    ]
  );

  const table = useReactTable({
    data: optimisticRows,
    columns,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table
        className="table-fixed"
        style={{ width: table.getTotalSize() }}
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
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
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
          {table.getRowModel().rows.map((row) => (
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
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>

        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell grid style={{ width: 40 }} />
            <TableCell
              className="font-medium uppercase tracking-wider text-xs"
              grid
            >
              {summary.totalCount} {isEn ? "Listings" : "Anuncios"}
            </TableCell>
            <TableCell className="text-xs" grid>
              {summary.publishedCount} {isEn ? "pub" : "pub"} /{" "}
              {summary.draftCount} {isEn ? "draft" : "borr"}
            </TableCell>
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
            <TableCell className="tabular-nums text-xs" grid>
              {summary.totalApplications} {isEn ? "apps" : "apps"}
            </TableCell>
            <TableCell grid />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
