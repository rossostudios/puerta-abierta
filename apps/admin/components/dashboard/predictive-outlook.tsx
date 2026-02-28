"use client";

import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type PredictiveItem = {
  id: string;
  category: string;
  title: string;
  confidence_pct: number;
  cta_label?: string;
  cta_href?: string;
};

type PredictiveOutlookProps = {
  orgId: string;
  isEn: boolean;
};

function confidenceColor(pct: number): string {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground/60";
}

export function PredictiveOutlook({ orgId, isEn }: PredictiveOutlookProps) {
  const { data: items = [], isPending: loading } = useQuery<PredictiveItem[]>({
    queryKey: ["predictive-outlook", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/reports/predictive-outlook?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: PredictiveItem[] };
      return payload.data ?? [];
    },
    staleTime: 300_000,
    retry: false,
  });

  if (loading || items.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-1 border-border/70 border-b pb-4">
        <div className="flex items-center gap-2">
          <Icon
            className="h-4 w-4 text-[var(--sidebar-primary)]"
            icon={Calendar03Icon}
          />
          <CardTitle className="text-base">
            {isEn ? "Predictive outlook" : "Perspectiva predictiva"}
          </CardTitle>
        </div>
        <CardDescription>
          {isEn
            ? "Forecasted events for the next 24-48 hours"
            : "Eventos pronosticados para las próximas 24-48 horas"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {items.slice(0, 5).map((item) => (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-muted/10 px-3 py-2.5"
            key={item.id}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-[13px] text-foreground/90">
                {item.title}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-[10.5px] text-muted-foreground/60 capitalize">
                  {item.category.replace(/_/g, " ")}
                </span>
                <span
                  className={cn(
                    "font-medium text-[10.5px]",
                    confidenceColor(item.confidence_pct)
                  )}
                >
                  {item.confidence_pct}%
                </span>
              </div>
            </div>
            {item.cta_href ? (
              <Button asChild className="shrink-0" size="sm" variant="ghost">
                <Link href={item.cta_href}>
                  {item.cta_label ?? (isEn ? "View" : "Ver")}
                </Link>
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
