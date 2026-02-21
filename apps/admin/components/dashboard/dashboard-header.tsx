"use client";

import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import type { QuickAction } from "./dashboard-utils";

type DashboardHeaderProps = {
  greetingTitle: string;
  subtitle: string;
  quickActions: QuickAction[];
  isEn: boolean;
};

export function DashboardHeader({
  greetingTitle,
  subtitle,
  quickActions,
  isEn,
}: DashboardHeaderProps) {
  return (
    <header className="glass-surface flex flex-col gap-4 rounded-3xl p-5 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="font-semibold text-2xl">{greetingTitle}</h1>
        <p className="text-muted-foreground/90 text-sm">{subtitle}</p>
      </div>

      <div className="grid w-full gap-2 sm:grid-cols-3 md:w-auto md:min-w-[40rem]">
        {quickActions.map((action) => (
          <Link
            className={cn(
              "rounded-2xl border border-border/75 bg-muted/55 px-3 py-2.5 text-left transition-colors hover:bg-muted/80 hover:text-foreground"
            )}
            href={action.href}
            key={action.href}
          >
            <div className="flex items-center gap-2 font-medium text-[13px]">
              <Icon icon={action.icon} size={14} />
              {isEn ? action.labelEn : action.labelEs}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {isEn ? action.detailEn : action.detailEs}
            </p>
          </Link>
        ))}
      </div>
    </header>
  );
}
