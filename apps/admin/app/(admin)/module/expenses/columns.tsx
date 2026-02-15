"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import type { DataTableRow } from "@/components/ui/data-table";
import { asNumber, asString, shortId } from "@/lib/features/expenses/utils";
import { formatCurrency, humanizeKey } from "@/lib/format";

export function useExpenseColumns(
  isEn: boolean,
  locale: "es-PY" | "en-US"
): ColumnDef<DataTableRow>[] {
  return useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "expense_date",
        header: isEn ? "Date" : "Fecha",
      },
      {
        accessorKey: "category",
        header: isEn ? "Category" : "Categoría",
        cell: ({ getValue }) => (
          <Badge variant="secondary">
            {humanizeKey(String(getValue() ?? ""))}
          </Badge>
        ),
      },
      {
        id: "amount_display",
        header: isEn ? "Amount" : "Monto",
        accessorFn: (row) => asNumber(row.amount),
        cell: ({ row }) => {
          const original = row.original;
          const amount = asNumber(original.amount);
          const currency =
            asString(original.currency).trim().toUpperCase() || "PYG";
          return (
            <span className="font-medium tabular-nums">
              {formatCurrency(amount, currency, locale)}
            </span>
          );
        },
      },
      {
        accessorKey: "vendor_name",
        header: isEn ? "Vendor" : "Proveedor",
        cell: ({ getValue }) => {
          const text = asString(getValue()).trim();
          return text ? (
            <span className="break-words">{text}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        accessorKey: "payment_method",
        header: isEn ? "Method" : "Método",
        cell: ({ getValue }) => {
          const text = asString(getValue()).trim();
          return text ? (
            <Badge variant="outline">{humanizeKey(text)}</Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        accessorKey: "property_name",
        header: isEn ? "Property" : "Propiedad",
        cell: ({ getValue, row }) => {
          const name = asString(getValue()).trim();
          const id = asString(row.original.property_id).trim();
          if (!(name || id))
            return <span className="text-muted-foreground">-</span>;
          return (
            <span className="min-w-0">
              <span className="block truncate">{name || shortId(id)}</span>
            </span>
          );
        },
      },
      {
        accessorKey: "unit_name",
        header: isEn ? "Unit" : "Unidad",
        cell: ({ getValue, row }) => {
          const name = asString(getValue()).trim();
          const id = asString(row.original.unit_id).trim();
          if (!(name || id))
            return <span className="text-muted-foreground">-</span>;
          return (
            <span className="min-w-0">
              <span className="block truncate">{name || shortId(id)}</span>
            </span>
          );
        },
      },
      {
        id: "receipt",
        header: isEn ? "Receipt" : "Comprobante",
        enableSorting: false,
        accessorFn: (row) => row.receipt_url,
        cell: ({ getValue }) => {
          const url = asString(getValue()).trim();
          if (!url) return <span className="text-muted-foreground">-</span>;
          return (
            <a
              className="text-primary underline-offset-4 hover:underline"
              href={url}
              rel="noreferrer"
              target="_blank"
            >
              {isEn ? "View" : "Ver"}
            </a>
          );
        },
      },
    ];
  }, [isEn, locale]);
}
