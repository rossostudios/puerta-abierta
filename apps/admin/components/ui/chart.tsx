"use client";

import {
  type ComponentProps,
  type ComponentType,
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useId,
} from "react";
import {
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
} from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

import { cn } from "@/lib/utils";

const THEMES = { light: "", dark: ".dark" } as const;
const CHART_VAR_SAFE_RE = /[^a-zA-Z0-9_-]/g;

export type ChartConfig = Record<
  string,
  {
    label?: ReactNode;
    icon?: ComponentType<{ className?: string }>;
    color?: string;
    theme?: Partial<Record<keyof typeof THEMES, string>>;
  }
>;

type ChartContextValue = {
  config: ChartConfig;
};

const ChartContext = createContext<ChartContextValue | null>(null);

function useChart() {
  const value = useContext(ChartContext);
  if (!value) {
    throw new Error("Chart components must be used within <ChartContainer />");
  }
  return value;
}

function chartVarName(key: string): string {
  const safe = key.replaceAll(CHART_VAR_SAFE_RE, "-");
  return `--color-${safe}`;
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config).filter(
    ([, item]) => item.color || item.theme
  );
  if (!entries.length) return null;

  const css = Object.entries(THEMES)
    .map(([theme, selectorPrefix]) => {
      const variables = entries
        .map(([key, item]) => {
          const value =
            item.theme?.[theme as keyof typeof THEMES] ?? item.color;
          if (!value) return null;
          return `  ${chartVarName(key)}: ${value};`;
        })
        .filter(Boolean)
        .join("\n");

      return `${selectorPrefix} [data-chart="${id}"] {\n${variables}\n}`;
    })
    .join("\n\n");

  return <style>{css}</style>;
}

type ChartContainerProps = HTMLAttributes<HTMLDivElement> & {
  config: ChartConfig;
  children: ComponentProps<typeof ResponsiveContainer>["children"];
};

export function ChartContainer({
  id,
  className,
  config,
  children,
  ...props
}: ChartContainerProps) {
  const reactId = useId();
  const chartId = id ?? `chart-${reactId.replaceAll(":", "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <ChartStyle config={config} id={chartId} />
      <div
        className={cn(
          "min-w-0 text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/70 [&_.recharts-dot]:stroke-background [&_.recharts-layer]:outline-none",
          className
        )}
        data-chart={chartId}
        {...props}
      >
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = Tooltip;

type ChartTooltipContentProps = TooltipContentProps<ValueType, NameType> & {
  headerFormatter?: (label: unknown) => ReactNode;
  valueFormatter?: (value: unknown) => ReactNode;
};

export function ChartTooltipContent({
  active,
  payload,
  label,
  headerFormatter,
  valueFormatter,
}: ChartTooltipContentProps) {
  const { config } = useChart();

  if (!(active && payload?.length)) return null;

  const header = headerFormatter
    ? headerFormatter(label)
    : (label as ReactNode);

  return (
    <div className="grid min-w-[200px] gap-2 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      {header ? (
        <div className="font-medium text-muted-foreground text-xs">
          {header}
        </div>
      ) : null}
      <div className="grid gap-1">
        {payload.map((item) => {
          const namedKey = typeof item.name === "string" ? item.name : null;
          const key =
            namedKey && config[namedKey]
              ? namedKey
              : String(item.dataKey ?? item.name ?? "value");
          const itemConfig = config[key] ?? {};
          const Icon = itemConfig.icon;
          const labelNode = itemConfig.label ?? (item.name as ReactNode) ?? key;

          const color = `var(${chartVarName(key)})`;
          const rawValue = item.value;
          const valueNode = valueFormatter
            ? valueFormatter(rawValue)
            : rawValue;

          return (
            <div className="flex items-center justify-between gap-3" key={key}>
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: color }}
                />
                {Icon ? (
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                ) : null}
                <span className="truncate text-xs">{labelNode}</span>
              </div>
              <span className="font-mono text-xs tabular-nums">
                {valueNode as ReactNode}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
