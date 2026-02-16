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
      className="overflow-hidden border-border/75 bg-card/98 transition-all duration-150 hover:border-border/95"
    >
      <CardHeader className="pb-1">
        <CardDescription className="flex items-center gap-2 font-medium text-[11px] uppercase tracking-[0.14em]">
          {icon ? (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-border/75 bg-muted/42">
              <Icon className="text-muted-foreground" icon={icon} size={13} />
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
