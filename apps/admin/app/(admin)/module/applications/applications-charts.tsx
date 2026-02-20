"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

export function ApplicationsCharts({
  isEn,
  funnelChartData,
  funnelChartConfig,
  responseTrendData,
  responseTrendConfig,
}: {
  isEn: boolean;
  funnelChartData: { key: string; label: string; count: number }[];
  funnelChartConfig: ChartConfig;
  responseTrendData: { day: string; median_minutes: number }[];
  responseTrendConfig: ChartConfig;
}) {
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {isEn ? "Funnel stage distribution" : "Distribución del funnel"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer className="h-48 w-full" config={funnelChartConfig}>
            <BarChart data={funnelChartData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                tickLine={false}
                tickMargin={8}
              />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <ChartTooltip
                content={(props) => (
                  <ChartTooltipContent
                    {...props}
                    headerFormatter={() =>
                      isEn ? "Pipeline funnel" : "Funnel del pipeline"
                    }
                  />
                )}
              />
              <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                {funnelChartData.map((entry) => (
                  <Cell fill={`var(--color-${entry.key})`} key={entry.key} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {isEn
              ? "First response median trend"
              : "Tendencia mediana de primera respuesta"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer className="h-48 w-full" config={responseTrendConfig}>
            <LineChart data={responseTrendData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="day"
                tickLine={false}
                tickMargin={8}
              />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <ChartTooltip
                content={(props) => (
                  <ChartTooltipContent
                    {...props}
                    headerFormatter={() =>
                      isEn
                        ? "Median first response"
                        : "Mediana primera respuesta"
                    }
                  />
                )}
              />
              <Line
                dataKey="median_minutes"
                dot={{ r: 3 }}
                stroke="var(--color-median_minutes)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </section>
  );
}
