"use client";
"use no memo";

import {
  Building06Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  DollarCircleIcon,
  Door01Icon,
  Layers01Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  Tag01Icon,
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
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { updateUnitInlineAction } from "@/app/(admin)/module/units/actions";
import { EditableCell } from "@/components/properties/editable-cell";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

/* ---------- types ---------- */

export type UnitRow = {
  id: string;
  property_id: string | null;
  property_name: string | null;
  code: string | null;
  name: string | null;
  max_guests: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  currency: string | null;
  is_active: boolean;
};

type OptimisticAction = {
  id: string;
  field: keyof UnitRow;
  value: string | number | boolean;
};

const CURRENCY_OPTIONS = [
  { label: "PYG", value: "PYG" },
  { label: "USD", value: "USD" },
];

/* ---------- component ---------- */

export function UnitNotionTable({
  rows,
  isEn,
}: {
  rows: UnitRow[];
  isEn: boolean;
}) {
  "use no memo";
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const uniqueProperties = useMemo(() => {
    return Array.from(
      new Set(rows.map((r) => r.property_name).filter(Boolean))
    ) as string[];
  }, [rows]);

  const uniqueBedrooms = useMemo(() => {
    return Array.from(
      new Set(
        rows.map((r) => r.bedrooms).filter((r) => r !== null && r !== undefined)
      )
    ).sort((a, b) => Number(a) - Number(b)) as number[];
  }, [rows]);

  const [optimisticRows, addOptimistic] = useOptimistic(
    rows,
    (current: UnitRow[], action: OptimisticAction) =>
      current.map((r) =>
        r.id === action.id ? { ...r, [action.field]: action.value } : r
      )
  );

  const commitEdit = useCallback(
    async (unitId: string, field: string, next: string | number | boolean) => {
      startTransition(() => {
        addOptimistic({
          id: unitId,
          field: field as keyof UnitRow,
          value: next,
        });
      });

      const result = await updateUnitInlineAction({
        unitId,
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

  const commitText = useCallback(
    (unitId: string, field: string) => (next: string) =>
      commitEdit(unitId, field, next),
    [commitEdit]
  );

  const commitNumber = useCallback(
    (unitId: string, field: string) => async (next: string) => {
      const parsed = Number(next);
      if (!Number.isFinite(parsed)) return;
      await commitEdit(unitId, field, parsed);
    },
    [commitEdit]
  );

  const columns = useMemo<ColumnDef<UnitRow>[]>(
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
        accessorKey: "property_name",
        size: 160,
        minSize: 100,
        header: () => (
          <ColHeader
            icon={Building06Icon}
            label={isEn ? "Property" : "Propiedad"}
          />
        ),
        cell: ({ row }) => (
          <span className="truncate text-sm">
            {row.original.property_name ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "name",
        size: 160,
        minSize: 100,
        header: () => (
          <ColHeader icon={Door01Icon} label={isEn ? "Name" : "Nombre"} />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              onCommit={commitText(data.id, "name")}
              value={data.name ?? ""}
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
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={
                <span className="font-mono text-muted-foreground text-xs">
                  {data.code ?? ""}
                </span>
              }
              onCommit={commitText(data.id, "code")}
              value={data.code ?? ""}
            />
          );
        },
      },
      {
        accessorKey: "max_guests",
        size: 90,
        minSize: 60,
        header: () => (
          <ColHeader
            icon={Layers01Icon}
            label={isEn ? "Guests" : "Huéspedes"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={
                <span className="text-sm tabular-nums">
                  {data.max_guests ?? "-"}
                </span>
              }
              onCommit={commitNumber(data.id, "max_guests")}
              value={String(data.max_guests ?? "")}
            />
          );
        },
      },
      {
        accessorKey: "bedrooms",
        size: 100,
        minSize: 60,
        header: () => (
          <ColHeader
            icon={Door01Icon}
            label={isEn ? "Bedrooms" : "Dormitorios"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={
                <span className="text-sm tabular-nums">
                  {data.bedrooms ?? "-"}
                </span>
              }
              onCommit={commitNumber(data.id, "bedrooms")}
              value={String(data.bedrooms ?? "")}
            />
          );
        },
      },
      {
        accessorKey: "bathrooms",
        size: 100,
        minSize: 60,
        header: () => (
          <ColHeader icon={Door01Icon} label={isEn ? "Bathrooms" : "Baños"} />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={
                <span className="text-sm tabular-nums">
                  {data.bathrooms ?? "-"}
                </span>
              }
              onCommit={commitNumber(data.id, "bathrooms")}
              value={String(data.bathrooms ?? "")}
            />
          );
        },
      },
      {
        accessorKey: "currency",
        size: 90,
        minSize: 70,
        header: () => (
          <ColHeader
            icon={DollarCircleIcon}
            label={isEn ? "Currency" : "Moneda"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={
                <span className="font-mono text-xs">
                  {data.currency ?? "-"}
                </span>
              }
              onCommit={commitText(data.id, "currency")}
              options={CURRENCY_OPTIONS}
              type="select"
              value={data.currency ?? "PYG"}
            />
          );
        },
      },
      {
        accessorKey: "is_active",
        size: 100,
        minSize: 80,
        header: () => (
          <ColHeader
            icon={CheckmarkCircle02Icon}
            label={isEn ? "Active" : "Activo"}
          />
        ),
        cell: ({ row }) => (
          <StatusBadge value={row.original.is_active ? "active" : "inactive"} />
        ),
      },
      {
        id: "actions",
        size: 48,
        minSize: 48,
        maxSize: 48,
        enableResizing: false,
        cell: ({ row }) => {
          const unit = row.original;
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
                  onClick={() => router.push(`/module/units/${unit.id}`)}
                >
                  <Icon className="mr-2" icon={ViewIcon} size={14} />
                  {isEn ? "View details" : "Ver detalles"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigator.clipboard.writeText(unit.id)}
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
    [isEn, commitText, commitNumber, router]
  );

  // eslint-disable-next-line react-hooks-js/incompatible-library
  const table = useReactTable({
    data: optimisticRows,
    columns,
    columnResizeMode: "onChange",
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <DataTableToolbar
          active={globalFilter.length > 0 || columnFilters.length > 0}
          globalFilter={globalFilter}
          hideSearch={false}
          isEn={isEn}
          reset={() => {
            setGlobalFilter("");
            setColumnFilters([]);
          }}
          searchPlaceholder={isEn ? "Search units..." : "Buscar unidades..."}
          setGlobalFilter={setGlobalFilter}
          table={table}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-[180px]"
            onChange={(e) => {
              const val = e.target.value;
              table
                .getColumn("property_name")
                ?.setFilterValue(val === "all" ? undefined : val);
            }}
            value={
              (table.getColumn("property_name")?.getFilterValue() as string) ??
              "all"
            }
          >
            <option value="all">
              {isEn ? "All properties" : "Todas las propiedades"}
            </option>
            {uniqueProperties.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Select
            className="w-[140px]"
            onChange={(e) => {
              const val = e.target.value;
              table
                .getColumn("bedrooms")
                ?.setFilterValue(val === "all" ? undefined : Number(val));
            }}
            value={
              (table.getColumn("bedrooms")?.getFilterValue() as string) ?? "all"
            }
          >
            <option value="all">{isEn ? "All beds" : "Todas las camas"}</option>
            {uniqueBedrooms.map((b) => (
              <option key={String(b)} value={String(b)}>
                {b}{" "}
                {isEn ? (b === 1 ? "bed" : "beds") : b === 1 ? "hab." : "habs."}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-background shadow-[var(--shadow-floating)]">
        <Table
          className="w-full table-fixed"
          style={{ minWidth: table.getTotalSize() }}
        >
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead
                    className="relative select-none whitespace-nowrap text-[11px] uppercase tracking-wider"
                    grid
                    key={header.id}
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={header.column.getToggleSortingHandler()}
                        type="button"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {{
                          asc: <span className="ml-1 text-[10px]">↑</span>,
                          desc: <span className="ml-1 text-[10px]">↓</span>,
                        }[header.column.getIsSorted() as string] ?? null}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )
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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
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
                  className="h-24 text-center"
                  colSpan={columns.length}
                >
                  {isEn ? "No results." : "Sin resultados."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
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
