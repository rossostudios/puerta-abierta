"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function ReservationsTrendChart({
  isEn,
  trendConfig,
  trendData,
}: {
  isEn: boolean;
  trendConfig: ChartConfig;
  trendData: { day: string; checkIns: number; checkOuts: number }[];
}) {
  return (
    <Collapsible defaultOpen={false}>
      <section className="rounded-3xl border border-border/80 bg-card/85 p-3.5">
        <CollapsibleTrigger className="flex w-full items-center justify-between">
          <div>
            <p className="font-semibold text-sm">
              {isEn
                ? "Check-in / check-out trend"
                : "Tendencia check-in/check-out"}
            </p>
            <p className="text-muted-foreground text-xs">
              {isEn
                ? "Next 7 days from current filters"
                : "Pr\u00f3ximos 7 d\u00edas con filtros actuales"}
            </p>
          </div>
          <span className="text-muted-foreground text-xs">
            {isEn ? "Toggle" : "Mostrar"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2">
            <ChartContainer className="h-52 w-full" config={trendConfig}>
              <LineChart data={trendData} margin={{ left: 2, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="day"
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <ChartTooltip
                  content={(props) => (
                    <ChartTooltipContent
                      {...props}
                      headerFormatter={() =>
                        isEn ? "Reservations trend" : "Tendencia de reservas"
                      }
                    />
                  )}
                />
                <Line
                  dataKey="checkIns"
                  dot={{ r: 3 }}
                  stroke="var(--color-checkIns)"
                  strokeWidth={2}
                  type="monotone"
                />
                <Line
                  dataKey="checkOuts"
                  dot={{ r: 3 }}
                  stroke="var(--color-checkOuts)"
                  strokeWidth={2}
                  type="monotone"
                />
              </LineChart>
            </ChartContainer>
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
