"use client";
"use no memo";

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
  SlidersHorizontalIcon,
  SparklesIcon,
  Tag01Icon,
  Task01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { updatePropertyInlineAction } from "@/app/(admin)/module/properties/actions";
import { EditableCell } from "@/components/properties/editable-cell";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { formatCurrency, humanizeKey } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/* ---------- helpers ---------- */

function ColHeader({
  icon,
  label,
  tooltip,
}: {
  icon: typeof Building06Icon;
  label: string;
  tooltip?: string;
}) {
  const inner = (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="text-muted-foreground/70" icon={icon} size={13} />
      <span>{label}</span>
    </span>
  );

  if (!tooltip) return inner;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

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
  isSidebarOpen?: boolean;
  agentStatus?: "active" | "offline" | "loading";
};

const STICKY_ACTIONS = "sticky right-0 z-10 bg-background shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)] dark:shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.3)]";

/* ---------- component ---------- */

export function PropertyNotionTable({
  rows,
  isEn,
  formatLocale,
  summary,
  isSidebarOpen,
  agentStatus,
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

      if (result.ok) {
        toast.success(isEn ? "Saved" : "Guardado");
      } else {
        toast.error(isEn ? "Failed to save" : "Error al guardar", {
          description: result.error,
        });
      }
    },
    [addOptimistic, isEn]
  );

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  /* --- responsive column visibility --- */
  const isMd = useMediaQuery("(min-width: 768px)");
  const isLg = useMediaQuery("(min-width: 1024px)");
  const isXl = useMediaQuery("(min-width: 1280px)");
  const isXxl = useMediaQuery("(min-width: 1440px)");
  const is2xl = useMediaQuery("(min-width: 1536px)");

  const responsiveDefaults = useMemo<VisibilityState>(() => {
    if (isSidebarOpen) {
      return {
        code: false,
        city: false,
        aiStatus: false,
        revenueMtdPyg: false,
        openTaskCount: isXl,
        occupancyRate: isXxl,
        overdueCollectionCount: is2xl,
      };
    }
    return {
      occupancyRate: isMd,
      openTaskCount: isMd,
      overdueCollectionCount: isMd,
      code: isLg,
      aiStatus: isXl,
      city: isXxl,
      revenueMtdPyg: is2xl,
    };
  }, [isSidebarOpen, isMd, isLg, isXl, isXxl, is2xl]);

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(responsiveDefaults);

  // Reset to responsive defaults when breakpoints or sidebar change
  const prevDefaultsRef = useRef(responsiveDefaults);
  useEffect(() => {
    if (prevDefaultsRef.current !== responsiveDefaults) {
      prevDefaultsRef.current = responsiveDefaults;
      setColumnVisibility(responsiveDefaults);
    }
  }, [responsiveDefaults]);

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
            tooltip={isEn ? "Property name and address" : "Nombre y dirección de la propiedad"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-foreground text-sm">
                    {data.name}
                  </span>
                  <span className="truncate text-muted-foreground text-xs">
                    {data.address}
                  </span>
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
          <ColHeader icon={Tag01Icon} label={isEn ? "Code" : "Código"} tooltip={isEn ? "Internal property code" : "Código interno de la propiedad"} />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {row.original.code}
          </span>
        ),
      },
      {
        accessorKey: "city",
        size: 130,
        minSize: 80,
        header: () => (
          <ColHeader icon={City01Icon} label={isEn ? "City" : "Ciudad"} tooltip={isEn ? "City location" : "Ciudad de ubicación"} />
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
          <ColHeader icon={Door01Icon} label={isEn ? "Units" : "Unidades"} tooltip={isEn ? "Total rental units" : "Total de unidades de alquiler"} />
        ),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{row.original.unitCount}</span>
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
            tooltip={isEn ? "Current occupancy rate" : "Tasa de ocupación actual"}
          />
        ),
        cell: ({ row }) => {
          const rate = row.original.occupancyRate;
          let colorClass = "text-[var(--status-success-fg)]";
          if (rate < 50) colorClass = "text-[var(--status-danger-fg)]";
          else if (rate < 80) colorClass = "text-[var(--status-warning-fg)]";
          return (
            <span
              className={cn("font-medium text-sm tabular-nums", colorClass)}
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
            tooltip={isEn ? "Active or inactive" : "Activo o inactivo"}
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
        id: "aiStatus",
        size: 90,
        minSize: 70,
        header: () => (
          <ColHeader icon={SparklesIcon} label="AI" tooltip={isEn ? "AI agent connection status" : "Estado de conexión del agente IA"} />
        ),
        cell: () => {
          if (agentStatus === "loading") {
            return (
              <span className="text-muted-foreground text-xs">&hellip;</span>
            );
          }
          return agentStatus === "active" ? (
            <Badge
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-[10px]"
              variant="outline"
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {isEn ? "Active" : "Activo"}
            </Badge>
          ) : (
            <Badge
              className="border-border/40 bg-muted/20 text-muted-foreground text-[10px]"
              variant="outline"
            >
              {isEn ? "Offline" : "Sin conexión"}
            </Badge>
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
            tooltip={isEn ? "Month-to-date revenue" : "Ingresos del mes en curso"}
          />
        ),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {formatCurrency(row.original.revenueMtdPyg, "PYG", formatLocale)}
          </span>
        ),
      },
      {
        accessorKey: "openTaskCount",
        size: 80,
        minSize: 60,
        header: () => (
          <ColHeader icon={Task01Icon} label={isEn ? "Tasks" : "Tareas"} tooltip={isEn ? "Open maintenance tasks" : "Tareas de mantenimiento abiertas"} />
        ),
        cell: ({ row }) => {
          const count = row.original.openTaskCount;
          const urgent = row.original.urgentTaskCount;
          if (count === 0) {
            return (
              <span className="text-muted-foreground text-sm tabular-nums">0</span>
            );
          }
          return (
            <span
              className={cn(
                "text-sm tabular-nums",
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
          <ColHeader icon={Alert02Icon} label={isEn ? "Overdue" : "Vencidos"} tooltip={isEn ? "Overdue collection payments" : "Pagos de cobro vencidos"} />
        ),
        cell: ({ row }) => {
          const count = row.original.overdueCollectionCount;
          if (count === 0) {
            return (
              <span className="text-muted-foreground text-sm tabular-nums">0</span>
            );
          }
          return (
            <span className="font-medium text-[var(--status-danger-fg)] text-sm tabular-nums">
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
        header: () => <ColHeader icon={MoreVerticalIcon} label="" />,
        cell: ({ row }) => {
          const property = row.original;
          return (
            <div className="flex items-center justify-center">
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
                <DropdownMenuLabel>
                  {isEn ? "AI Agent" : "Agente IA"}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() =>
                    router.push(
                      `/module/agent-playground?property_id=${encodeURIComponent(property.id)}&property_name=${encodeURIComponent(property.name)}`
                    )
                  }
                >
                  <Icon className="mr-2" icon={SparklesIcon} size={14} />
                  {isEn ? "Ask AI about this property" : "Preguntar a IA sobre esta propiedad"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    router.push(
                      `/module/agent-playground?property_id=${encodeURIComponent(property.id)}&property_name=${encodeURIComponent(property.name)}&agent=dynamic-pricing`
                    )
                  }
                >
                  <Icon className="mr-2" icon={DollarCircleIcon} size={14} />
                  {isEn ? "Run Dynamic Pricing" : "Ejecutar Precio Dinámico"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    router.push(
                      `/module/agent-playground?property_id=${encodeURIComponent(property.id)}&property_name=${encodeURIComponent(property.name)}&agent=maintenance-coordinator`
                    )
                  }
                >
                  <Icon className="mr-2" icon={Task01Icon} size={14} />
                  {isEn ? "Scan Maintenance" : "Escanear Mantenimiento"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-600 focus:bg-red-50 focus:text-red-600 dark:focus:bg-red-900/10">
                  <Icon className="mr-2" icon={Delete02Icon} size={14} />
                  {isEn ? "Delete" : "Eliminar"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [isEn, formatLocale, commitEdit, router, agentStatus]
  );

  // eslint-disable-next-line react-hooks-js/incompatible-library
  const table = useReactTable({
    data: optimisticRows,
    columns,
    columnResizeMode: "onChange",
    state: { columnVisibility, sorting, columnFilters },
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <PopoverRoot>
          <PopoverTrigger
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-9 gap-2 rounded-xl border-border/60 font-semibold text-muted-foreground hover:bg-muted"
            )}
          >
            <Icon icon={SlidersHorizontalIcon} size={15} />
            {isEn ? "Columns" : "Columnas"}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[200px] p-2">
            {table
              .getAllLeafColumns()
              .filter((col) => col.getCanHide())
              .map((col) => (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                  key={col.id}
                >
                  <Checkbox
                    checked={col.getIsVisible()}
                    onCheckedChange={(v) => col.toggleVisibility(!!v)}
                  />
                  <span className="truncate">{{
                    name: isEn ? "Property" : "Propiedad",
                    code: isEn ? "Code" : "Código",
                    city: isEn ? "City" : "Ciudad",
                    unitCount: isEn ? "Units" : "Unidades",
                    occupancyRate: isEn ? "Occupancy" : "Ocupación",
                    status: isEn ? "Status" : "Estado",
                    aiStatus: "AI",
                    revenueMtdPyg: isEn ? "Revenue" : "Ingresos",
                    openTaskCount: isEn ? "Tasks" : "Tareas",
                    overdueCollectionCount: isEn ? "Overdue" : "Vencidos",
                    actions: isEn ? "Actions" : "Acciones",
                  }[col.id] ?? humanizeKey(col.id)}</span>
                </label>
              ))}
          </PopoverContent>
        </PopoverRoot>
      </div>
      <div className="overflow-x-auto rounded-md border">
      <Table
        className="w-full table-fixed"
        style={{ minWidth: table.getTotalSize() }}
      >
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => (
                <TableHead
                  className={cn(
                    "relative select-none whitespace-nowrap text-[11px] uppercase tracking-wider",
                    header.id === "actions" && cn(STICKY_ACTIONS, "px-0")
                  )}
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
                    <button
                      aria-label="Resize column"
                      className={cn(
                        "absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none select-none",
                        "hover:bg-primary/30",
                        header.column.getIsResizing() && "bg-primary/50"
                      )}
                      onDoubleClick={() => header.column.resetSize()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      type="button"
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
                  className={cn(
                    "py-1.5",
                    cell.column.id === "actions" && cn(STICKY_ACTIONS, "px-0")
                  )}
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
            {table.getVisibleLeafColumns().map((col) => {
              const footerContent: Record<string, React.ReactNode> = {
                name: (
                  <span className="font-medium text-xs uppercase tracking-wider">
                    {optimisticRows.length} {isEn ? "Properties" : "Propiedades"}
                  </span>
                ),
                unitCount: summary.totalUnits,
                occupancyRate: `${summary.averageOccupancy}%`,
                revenueMtdPyg: formatCurrency(summary.totalRevenueMtdPyg, "PYG", formatLocale),
                openTaskCount: summary.totalOpenTasks,
                overdueCollectionCount: summary.totalOverdueCollections,
              };
              const content = footerContent[col.id];
              return (
                <TableCell
                  className={cn(
                    col.id === "actions" && STICKY_ACTIONS,
                    content && col.id !== "name" && "tabular-nums"
                  )}
                  grid
                  key={col.id}
                  style={{ width: col.getSize() }}
                >
                  {content ?? null}
                </TableCell>
              );
            })}
          </TableRow>
        </TableFooter>
      </Table>
      </div>
      <DataTablePagination
        filteredRows={table.getFilteredRowModel().rows.length}
        isEn={isEn}
        table={table}
        totalRows={table.getCoreRowModel().rows.length}
      />
    </div>
  );
}
