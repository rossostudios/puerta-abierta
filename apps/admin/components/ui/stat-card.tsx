import type { IconSvgElement } from "@hugeicons/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

type StatCardProps = {
  label: string;
  value: string;
  helper?: string;
  icon?: IconSvgElement;
};

export function StatCard({ label, value, helper, icon }: StatCardProps) {
  return (
    <Card
      aria-label={`${label}: ${value}`}
      className="overflow-hidden border-border/60 bg-card/98 transition-all duration-300 hover:border-border/80 hover:shadow-[var(--shadow-floating)] hover:-translate-y-[2px]"
    >
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 font-medium text-[11px] uppercase tracking-[0.15em]">
          {icon ? (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-border/60 bg-muted/50">
              <Icon className="text-muted-foreground" icon={icon} size={14} />
            </span>
          ) : null}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      {helper ? (
        <CardContent className="pt-0 text-muted-foreground/90 text-xs">
          {helper}
        </CardContent>
      ) : null}
    </Card>
  );
}
