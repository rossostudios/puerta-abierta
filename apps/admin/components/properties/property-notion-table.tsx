"use client";

import {
  Alert02Icon,
  Building06Icon,
  CheckmarkCircle02Icon,
  City01Icon,
  Delete02Icon,
  DollarCircleIcon,
  Door01Icon,
  Layers01Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  Tag01Icon,
  Task01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { updatePropertyInlineAction } from "@/app/(admin)/module/properties/actions";
import { EditableCell } from "@/components/properties/editable-cell";
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
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  PropertyPortfolioRow,
  PropertyPortfolioSummary,
} from "@/lib/features/properties/types";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ---------- helpers ---------- */

function ColHeader({
  icon,
  label,
}: {
  icon: typeof Building06Icon;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="text-muted-foreground/70" icon={icon} size={13} />
      <span>{label}</span>
    </span>
  );
}

const HEALTH_DOT: Record<string, string> = {
  stable: "bg-[var(--status-success-fg)]",
  watch: "bg-[var(--status-warning-fg)]",
  critical: "bg-[var(--status-danger-fg)]",
};

const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
];

/* ---------- types ---------- */

type OptimisticAction = {
  id: string;
  field: keyof PropertyPortfolioRow;
  value: string;
};

type Props = {
  rows: PropertyPortfolioRow[];
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
  summary: PropertyPortfolioSummary;
};

/* ---------- component ---------- */

export function PropertyNotionTable({
  rows,
  isEn,
  formatLocale,
  summary,
}: Props) {
  "use no memo";
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [optimisticRows, addOptimistic] = useOptimistic(
    rows,
    (current: PropertyPortfolioRow[], action: OptimisticAction) =>
      current.map((r) =>
        r.id === action.id ? { ...r, [action.field]: action.value } : r
      )
  );

  const commitEdit = useCallback(
    async (propertyId: string, field: string, next: string) => {
      startTransition(() => {
        addOptimistic({
          id: propertyId,
          field: field as keyof PropertyPortfolioRow,
          value: next,
        });
      });

      const result = await updatePropertyInlineAction({
        propertyId,
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

  const columns = useMemo<ColumnDef<PropertyPortfolioRow>[]>(
    () => [
      {
        id: "select",
        size: 40,
        minSize: 40,
        maxSize: 40,
        enableResizing: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
          />
        ),
      },
      {
        accessorKey: "name",
        size: 220,
        minSize: 140,
        header: () => (
          <ColHeader
            icon={Building06Icon}
            label={isEn ? "Property" : "Propiedad"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          const dotClass = HEALTH_DOT[data.health] ?? "bg-muted-foreground";
          return (
            <EditableCell
              displayNode={
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      dotClass
                    )}
                    title={data.health}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-foreground text-sm truncate">
                      {data.name}
                    </span>
                    <span className="text-muted-foreground text-xs truncate">
                      {data.address}
                    </span>
                  </div>
                </div>
              }
              onCommit={(next) => commitEdit(data.id, "name", next)}
              value={data.name}
            />
          );
        },
      },
      {
        accessorKey: "code",
        size: 100,
        minSize: 70,
        header: () => (
          <ColHeader icon={Tag01Icon} label={isEn ? "Code" : "Código"} />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.code}
          </span>
        ),
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
        accessorKey: "unitCount",
        size: 80,
        minSize: 60,
        header: () => (
          <ColHeader icon={Door01Icon} label={isEn ? "Units" : "Unidades"} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {row.original.unitCount}
          </span>
        ),
      },
      {
        accessorKey: "occupancyRate",
        size: 100,
        minSize: 70,
        header: () => (
          <ColHeader
            icon={Layers01Icon}
            label={isEn ? "Occupancy" : "Ocupación"}
          />
        ),
        cell: ({ row }) => {
          const rate = row.original.occupancyRate;
          let colorClass = "text-[var(--status-success-fg)]";
          if (rate < 50) colorClass = "text-[var(--status-danger-fg)]";
          else if (rate < 80) colorClass = "text-[var(--status-warning-fg)]";
          return (
            <span
              className={cn("tabular-nums text-sm font-medium", colorClass)}
            >
              {rate}%
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        size: 110,
        minSize: 90,
        header: () => (
          <ColHeader
            icon={CheckmarkCircle02Icon}
            label={isEn ? "Status" : "Estado"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={<StatusBadge value={data.status} />}
              onCommit={(next) => commitEdit(data.id, "status", next)}
              options={STATUS_OPTIONS}
              type="select"
              value={data.status}
            />
          );
        },
      },
      {
        accessorKey: "revenueMtdPyg",
        size: 140,
        minSize: 100,
        header: () => (
          <ColHeader
            icon={DollarCircleIcon}
            label={isEn ? "Revenue" : "Ingresos"}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {formatCurrency(row.original.revenueMtdPyg, "PYG", formatLocale)}
          </span>
        ),
      },
      {
        accessorKey: "openTaskCount",
        size: 80,
        minSize: 60,
        header: () => (
          <ColHeader icon={Task01Icon} label={isEn ? "Tasks" : "Tareas"} />
        ),
        cell: ({ row }) => {
          const count = row.original.openTaskCount;
          const urgent = row.original.urgentTaskCount;
          if (count === 0) {
            return (
              <span className="text-muted-foreground text-sm">&mdash;</span>
            );
          }
          return (
            <span
              className={cn(
                "tabular-nums text-sm",
                urgent > 0 && "font-medium text-[var(--status-warning-fg)]"
              )}
            >
              {count}
            </span>
          );
        },
      },
      {
        accessorKey: "overdueCollectionCount",
        size: 90,
        minSize: 60,
        header: () => (
          <ColHeader
            icon={Alert02Icon}
            label={isEn ? "Overdue" : "Vencidos"}
          />
        ),
        cell: ({ row }) => {
          const count = row.original.overdueCollectionCount;
          if (count === 0) {
            return (
              <span className="text-muted-foreground text-sm">&mdash;</span>
            );
          }
          return (
            <span className="tabular-nums text-sm font-medium text-[var(--status-danger-fg)]">
              {count}
            </span>
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
          const property = row.original;
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
                <DropdownMenuItem
                  onClick={() =>
                    router.push(`/module/properties/${property.id}`)
                  }
                >
                  <Icon className="mr-2" icon={ViewIcon} size={14} />
                  {isEn ? "View details" : "Ver detalles"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigator.clipboard.writeText(property.id)}
                >
                  <Icon className="mr-2" icon={PencilEdit02Icon} size={14} />
                  {isEn ? "Copy ID" : "Copiar ID"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-600 focus:bg-red-50 focus:text-red-600 dark:focus:bg-red-900/10">
                  <Icon className="mr-2" icon={Delete02Icon} size={14} />
                  {isEn ? "Delete" : "Eliminar"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [isEn, formatLocale, commitEdit, router]
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
              data-state={row.getIsSelected() && "selected"}
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
              {optimisticRows.length} {isEn ? "Properties" : "Propiedades"}
            </TableCell>
            <TableCell grid />
            <TableCell grid />
            <TableCell className="tabular-nums" grid>
              {summary.totalUnits}
            </TableCell>
            <TableCell className="tabular-nums" grid>
              {summary.averageOccupancy}%
            </TableCell>
            <TableCell grid />
            <TableCell className="tabular-nums" grid>
              {formatCurrency(summary.totalRevenueMtdPyg, "PYG", formatLocale)}
            </TableCell>
            <TableCell className="tabular-nums" grid>
              {summary.totalOpenTasks}
            </TableCell>
            <TableCell className="tabular-nums" grid>
              {summary.totalOverdueCollections}
            </TableCell>
            <TableCell grid />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
