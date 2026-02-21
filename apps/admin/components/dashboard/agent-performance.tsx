"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
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

type AgentPerformanceData = {
  total_conversations: number;
  total_messages: number;
  avg_tool_calls_per_response: number;
  model_usage: { model: string; count: number }[];
  per_agent: { agent_name: string; message_count: number }[];
};

type AgentPerformanceProps = {
  data: AgentPerformanceData | null;
  locale: Locale;
};

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const BAR_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function AgentPerformance({
  data,
  locale: localeProp,
}: AgentPerformanceProps) {
  const activeLocale = useActiveLocale();
  const mounted = useMounted();

  const locale = mounted ? activeLocale : localeProp;
  const isEn = locale === "en-US";

  const modelConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    for (const [i, item] of (data?.model_usage ?? []).entries()) {
      config[item.model] = {
        label: item.model,
        color: PIE_COLORS[i % PIE_COLORS.length],
      };
    }
    return config;
  }, [data?.model_usage]);

  const agentConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    for (const [i, item] of (data?.per_agent ?? []).entries()) {
      config[item.agent_name] = {
        label: item.agent_name,
        color: BAR_COLORS[i % BAR_COLORS.length],
      };
    }
    return config;
  }, [data?.per_agent]);

  if (!data || data.total_messages === 0) return null;

  const modelData = data.model_usage.map((item, i) => ({
    ...item,
    fill: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const agentData = data.per_agent.map((item, i) => ({
    ...item,
    fill: BAR_COLORS[i % BAR_COLORS.length],
  }));

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-3 border-border/70 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {isEn ? "Agent performance" : "Rendimiento de agentes"}
            </CardTitle>
            <CardDescription>
              {isEn ? "Last 30 days" : "Últimos 30 días"}
            </CardDescription>
          </div>
          <Badge className="font-mono text-[11px]" variant="outline">
            {data.total_conversations} {isEn ? "chats" : "chats"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Summary numbers */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border bg-muted/30 p-3 text-center">
            <p className="font-semibold text-lg">{data.total_messages}</p>
            <p className="text-[11px] text-muted-foreground">
              {isEn ? "Messages" : "Mensajes"}
            </p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-center">
            <p className="font-semibold text-lg">
              {data.avg_tool_calls_per_response.toFixed(1)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {isEn ? "Avg tools/reply" : "Herr/resp"}
            </p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-center">
            <p className="font-semibold text-lg">{data.per_agent.length}</p>
            <p className="text-[11px] text-muted-foreground">
              {isEn ? "Agents used" : "Agentes usados"}
            </p>
          </div>
        </div>

        {/* Model usage pie */}
        {modelData.length > 0 ? (
          <div>
            <p className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {isEn ? "Model usage" : "Uso de modelos"}
            </p>
            <ChartContainer className="h-40 w-full" config={modelConfig}>
              <PieChart>
                <ChartTooltip
                  content={(props) => <ChartTooltipContent {...props} />}
                />
                <Pie
                  data={modelData}
                  dataKey="count"
                  innerRadius={40}
                  nameKey="model"
                  outerRadius={64}
                  paddingAngle={3}
                  stroke="var(--background)"
                  strokeWidth={2}
                >
                  {modelData.map((entry) => (
                    <Cell fill={entry.fill} key={entry.model} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          </div>
        ) : null}

        {/* Per-agent bar chart */}
        {agentData.length > 0 ? (
          <div>
            <p className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {isEn ? "Messages by agent" : "Mensajes por agente"}
            </p>
            <ChartContainer className="h-40 w-full" config={agentConfig}>
              <BarChart
                data={agentData}
                layout="vertical"
                margin={{ left: 8, right: 8 }}
              >
                <CartesianGrid horizontal={false} />
                <XAxis allowDecimals={false} type="number" />
                <YAxis
                  dataKey="agent_name"
                  tickLine={false}
                  type="category"
                  width={90}
                />
                <ChartTooltip
                  content={(props) => <ChartTooltipContent {...props} />}
                />
                <Bar dataKey="message_count" radius={[0, 6, 6, 0]}>
                  {agentData.map((entry) => (
                    <Cell fill={entry.fill} key={entry.agent_name} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
