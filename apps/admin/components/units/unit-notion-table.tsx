"use client";

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
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { updateUnitInlineAction } from "@/app/(admin)/module/units/actions";
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

  const [optimisticRows, addOptimistic] = useOptimistic(
    rows,
    (current: UnitRow[], action: OptimisticAction) =>
      current.map((r) =>
        r.id === action.id ? { ...r, [action.field]: action.value } : r
      )
  );

  const commitEdit = useCallback(
    async (
      unitId: string,
      field: string,
      next: string | number | boolean
    ) => {
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
          <span className="text-sm truncate">
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
                <span className="font-mono text-xs text-muted-foreground">
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
                <span className="tabular-nums text-sm">
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
                <span className="tabular-nums text-sm">
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
          <ColHeader
            icon={Door01Icon}
            label={isEn ? "Bathrooms" : "Baños"}
          />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <EditableCell
              displayNode={
                <span className="tabular-nums text-sm">
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
                  onClick={() =>
                    router.push(`/module/units/${unit.id}`)
                  }
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

  const table = useReactTable({
    data: optimisticRows,
    columns,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="table-fixed w-full" style={{ minWidth: table.getTotalSize() }}>
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
              {optimisticRows.length} {isEn ? (optimisticRows.length === 1 ? "Unit" : "Units") : (optimisticRows.length === 1 ? "Unidad" : "Unidades")}
            </TableCell>
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
