import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  asDateLabel,
  isUuid,
  shortId,
  toLabel,
} from "@/lib/features/module-record/utils";
import { humanizeKey } from "@/lib/format";
import { FOREIGN_KEY_HREF_BASE_BY_KEY } from "@/lib/links";
import { cn } from "@/lib/utils";

export function RecordDetailsCard({
  record,
  keys,
  isEn,
  locale,
}: {
  record: Record<string, unknown>;
  keys: string[];
  isEn: boolean;
  locale: "en-US" | "es-PY";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Details" : "Detalles"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Click related IDs to navigate."
            : "Haz clic en IDs relacionadas para navegar."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y rounded-md border">
          {keys.map((key) => {
            const value = record[key];

            const text = typeof value === "string" ? value : null;
            const dateLabel = text ? asDateLabel(text, locale) : null;
            const isStatus =
              key === "status" &&
              typeof value === "string" &&
              value.trim().length > 0;

            const fkHref = (() => {
              const directBase = FOREIGN_KEY_HREF_BASE_BY_KEY[key];
              if (directBase && typeof value === "string" && isUuid(value)) {
                return `${directBase}/${value}`;
              }

              if (key.endsWith("_name")) {
                const idKey = `${key.slice(0, -5)}_id`;
                const rawId = record[idKey];
                const base = FOREIGN_KEY_HREF_BASE_BY_KEY[idKey];
                if (base && typeof rawId === "string" && isUuid(rawId)) {
                  return `${base}/${rawId}`;
                }
              }

              return null;
            })();

            const showMonospace =
              typeof value === "string" &&
              (isUuid(value) || key === "id" || key.endsWith("_id"));

            return (
              <div className="grid gap-2 p-4 md:grid-cols-12" key={key}>
                <div className="md:col-span-4">
                  <p className="font-medium text-muted-foreground text-xs">
                    {humanizeKey(key)}
                  </p>
                </div>
                <div className="md:col-span-8">
                  {value === null || value === undefined ? (
                    <p className="text-muted-foreground text-sm">-</p>
                  ) : isStatus ? (
                    <StatusBadge value={String(value)} />
                  ) : dateLabel ? (
                    <p
                      className="text-foreground text-sm"
                      title={String(value)}
                    >
                      {dateLabel}
                    </p>
                  ) : fkHref ? (
                    <Link
                      className={cn(
                        "inline-flex items-center text-primary underline-offset-4 hover:underline",
                        key.endsWith("_name") ? "text-sm" : "font-mono text-xs",
                        showMonospace && !key.endsWith("_name")
                          ? "break-all"
                          : ""
                      )}
                      href={fkHref}
                      prefetch={false}
                      title={isEn ? `Open ${key}` : `Abrir ${key}`}
                    >
                      {key.endsWith("_name")
                        ? String(value)
                        : shortId(String(value))}
                    </Link>
                  ) : typeof value === "boolean" ? (
                    key === "is_active" ? (
                      <StatusBadge value={value ? "active" : "inactive"} />
                    ) : (
                      <p className="text-foreground text-sm">
                        {value ? (isEn ? "Yes" : "Sí") : isEn ? "No" : "No"}
                      </p>
                    )
                  ) : typeof value === "number" ? (
                    <p className="text-foreground text-sm tabular-nums">
                      {new Intl.NumberFormat(locale, {
                        maximumFractionDigits: 2,
                      }).format(value)}
                    </p>
                  ) : typeof value === "object" ? (
                    <pre className="max-h-60 overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  ) : (
                    <p
                      className={cn(
                        "text-foreground text-sm",
                        showMonospace
                          ? "break-all font-mono text-xs"
                          : "break-words"
                      )}
                    >
                      {toLabel(value)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
