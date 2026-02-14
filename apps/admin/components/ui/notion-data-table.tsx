"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type NotionDataTableProps<TRow> = {
  data: TRow[];
  columns: ColumnDef<TRow, unknown>[];
  renderRowActions?: (row: TRow) => ReactNode;
  rowActionsHeader?: string;
  hideSearch?: boolean;
  searchPlaceholder?: string;
  footer?: ReactNode;
  defaultPageSize?: number;
  isEn?: boolean;
};

export function NotionDataTable<TRow>({
  data,
  columns: columnsProp,
  renderRowActions,
  rowActionsHeader,
  hideSearch = false,
  searchPlaceholder,
  footer,
  defaultPageSize = 50,
  isEn = true,
}: NotionDataTableProps<TRow>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  const columns = useMemo(() => {
    if (!renderRowActions) return columnsProp;
    return [
      ...columnsProp,
      {
        id: "__actions",
        header: rowActionsHeader ?? "",
        size: 120,
        minSize: 80,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            {renderRowActions(row.original)}
          </div>
        ),
      } satisfies ColumnDef<TRow, unknown>,
    ];
  }, [columnsProp, renderRowActions, rowActionsHeader]);

  const table = useReactTable({
    data,
    columns,
    columnResizeMode: "onChange",
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = data.length;

  return (
    <div className="min-w-0 space-y-3">
      {!hideSearch && (
        <div className="flex items-center gap-2">
          <Input
            className="max-w-xs"
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={
              searchPlaceholder ?? (isEn ? "Filter..." : "Filtrar...")
            }
            value={globalFilter}
          />
          {globalFilter && (
            <Button
              onClick={() => setGlobalFilter("")}
              size="sm"
              variant="outline"
            >
              {isEn ? "Reset" : "Reiniciar"}
            </Button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table className="table-fixed" style={{ width: table.getTotalSize() }}>
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
                          ? " ↑"
                          : header.column.getIsSorted() === "desc"
                            ? " ↓"
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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow className="hover:bg-muted/20" key={row.id}>
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
                  colSpan={columns.length}
                >
                  {isEn ? "No records" : "Sin registros"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>

          {footer ? (
            <TableFooter>{footer}</TableFooter>
          ) : null}
        </Table>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="text-muted-foreground text-sm">
          {filteredCount !== totalCount
            ? `${filteredCount} / ${totalCount}`
            : `${totalCount}`}{" "}
          {isEn ? "rows" : "filas"}
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
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
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
