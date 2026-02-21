"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { useActiveLocale } from "@/lib/i18n/client";

type TableCardProps = {
  title: string;
  subtitle: string;
  rows: DataTableRow[];
  rowHrefBase?: string;
};

export function TableCard({
  title,
  subtitle,
  rows,
  rowHrefBase,
}: TableCardProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  return (
    <Card className="glass-surface">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-border/50 border-b pb-4">
        <div>
          <CardDescription className="text-[11px] uppercase tracking-[0.13em]">
            {subtitle}
          </CardDescription>
          <CardTitle className="mt-1 text-xl">{title}</CardTitle>
        </div>
        <CardDescription className="rounded-full border border-border/75 bg-muted/44 px-2.5 py-1 font-medium text-[11px] tracking-wide">
          {rows.length} {isEn ? "records" : "registros"}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        <DataTable
          data={rows}
          rowHrefBase={rowHrefBase}
          searchPlaceholder={isEn ? "Filter rows..." : "Filtrar filas..."}
        />
      </CardContent>
    </Card>
  );
}
