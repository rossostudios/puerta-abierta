"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useMounted } from "@/lib/hooks/use-mounted";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";

type ForecastMonth = {
  month: string;
  occupancy_pct: number;
  is_forecast: boolean;
};

type OccupancyForecastProps = {
  data: ForecastMonth[];
  avgPct: number;
  locale: Locale;
};

const chartConfig: ChartConfig = {
  occupancy_pct: {
    label: "Occupancy %",
    color: "var(--chart-1)",
  },
};

export function OccupancyForecast({
  data,
  avgPct,
  locale: localeProp,
}: OccupancyForecastProps) {
  const activeLocale = useActiveLocale();
  const mounted = useMounted();

  const locale = mounted ? activeLocale : localeProp;
  const isEn = locale === "en-US";

  if (!data.length) return null;

  return (
    <Card className="overflow-hidden border-border/80 bg-card/98">
      <CardHeader className="space-y-3 border-border/70 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {isEn ? "Occupancy forecast" : "Pronóstico de ocupación"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Historical + predicted occupancy"
                : "Ocupación histórica + predicción"}
            </CardDescription>
          </div>
          <Badge className="font-mono text-[11px]" variant="outline">
            {isEn ? "Avg" : "Prom"}: {avgPct.toFixed(1)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <ChartContainer className="h-56 w-full" config={chartConfig}>
          <AreaChart data={data} margin={{ left: 12, right: 12 }}>
            <defs>
              <linearGradient id="occupancyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="month"
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              axisLine={false}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tickLine={false}
              tickMargin={8}
              width={44}
            />
            <ChartTooltip
              content={(props) => (
                <ChartTooltipContent
                  {...props}
                  valueFormatter={(v) => `${Number(v).toFixed(1)}%`}
                />
              )}
            />
            <Area
              dataKey="occupancy_pct"
              fill="url(#occupancyGrad)"
              fillOpacity={1}
              stroke="var(--chart-1)"
              strokeWidth={2}
              type="monotone"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
