"use client";

import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import type { QuickAction } from "./dashboard-utils";

type DashboardHeaderProps = {
  greetingTitle: string;
  subtitle: string;
  quickActions: (QuickAction & { count?: number | null })[];
  isEn: boolean;
};

export function DashboardHeader({
  greetingTitle,
  subtitle,
  quickActions,
  isEn,
}: DashboardHeaderProps) {
  return (
    <header className="px-1 py-2">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <h1 className="font-semibold text-3xl tracking-tight md:text-[2.6rem]">
            {greetingTitle}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm md:text-base">
            {subtitle}
          </p>
        </div>

        <nav
          aria-label={isEn ? "Quick actions" : "Acciones rápidas"}
          className="flex flex-wrap gap-3 xl:max-w-[48rem] xl:justify-end"
        >
          {quickActions.map((action, index) => {
            const label = isEn ? action.labelEn : action.labelEs;
            const accentClass = getActionAccentClass(index);

            return (
              <Link
                className={cn(
                  "group inline-flex min-h-14 items-center gap-2.5 rounded-2xl border border-border/60 bg-background/60 px-4 py-2.5",
                  "shadow-black/5 shadow-sm transition-colors hover:border-[var(--sidebar-primary)]/20 hover:bg-background/80"
                )}
                href={action.href}
                key={action.href}
                title={isEn ? action.detailEn : action.detailEs}
              >
                <span
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-inset",
                    accentClass
                  )}
                >
                  <Icon icon={action.icon} size={14} />
                </span>
                <span className="whitespace-nowrap font-medium text-[14px] text-foreground/95">
                  {typeof action.count === "number" ? (
                    <span className="mr-1.5 font-semibold text-foreground">
                      {action.count}
                    </span>
                  ) : null}
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function getActionAccentClass(index: number): string {
  if (index === 0) {
    return "bg-orange-500/10 text-orange-500 ring-orange-500/20";
  }
  if (index === 1) {
    return "bg-blue-500/10 text-blue-500 ring-blue-500/20";
  }
  return "bg-violet-500/10 text-violet-500 ring-violet-500/20";
}
