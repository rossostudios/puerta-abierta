"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
import { formatCurrency } from "@/lib/format";
import { useMounted } from "@/lib/hooks/use-mounted";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";

type RevenueMonth = {
  month: string;
  revenue: number;
};

type RevenueTrendProps = {
  data: RevenueMonth[];
  locale: Locale;
};

const chartConfig: ChartConfig = {
  revenue: {
    label: "Revenue",
    color: "var(--chart-2)",
  },
};

export function RevenueTrend({ data, locale: localeProp }: RevenueTrendProps) {
  const activeLocale = useActiveLocale();
  const mounted = useMounted();

  const locale = mounted ? activeLocale : localeProp;
  const isEn = locale === "en-US";

  if (!data.length || data.every((m) => m.revenue === 0)) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-3 border-border/70 border-b pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {isEn ? "Revenue trend" : "Tendencia de ingresos"}
          </CardTitle>
          <CardDescription>
            {isEn ? "Last 6 months" : "Últimos 6 meses"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <ChartContainer className="h-56 w-full" config={chartConfig}>
          <AreaChart data={data} margin={{ left: 12, right: 12 }}>
            <defs>
              <linearGradient id="revenueGrad" x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--chart-2)"
                  stopOpacity={0.3}
                />
                <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
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
              tickFormatter={(v) => formatCurrency(v, "PYG", locale)}
              tickLine={false}
              tickMargin={10}
              width={56}
            />
            <ChartTooltip
              content={(props) => (
                <ChartTooltipContent
                  {...props}
                  valueFormatter={(v) => formatCurrency(v, "PYG", locale)}
                />
              )}
            />
            <Area
              dataKey="revenue"
              fill="url(#revenueGrad)"
              fillOpacity={1}
              stroke="var(--chart-2)"
              strokeWidth={2}
              type="monotone"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
