"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import type { NeedsAttentionItem } from "./dashboard-utils";

type DashboardNeedsAttentionProps = {
  items: NeedsAttentionItem[];
  isEn: boolean;
};

export function DashboardNeedsAttention({
  items,
  isEn,
}: DashboardNeedsAttentionProps) {
  if (items.length === 0) return null;

  return (
    <section className="glass-surface rounded-3xl p-4 sm:p-5">
      <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
        {isEn ? "Needs attention" : "Requiere atención"}
      </h2>
      <div className="divide-y divide-border/60">
        {items.map((item) => (
          <div
            className="flex items-center justify-between gap-3 py-2.5"
            key={item.key}
          >
            <p className="text-sm">{isEn ? item.labelEn : item.labelEs}</p>
            <Link
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "shrink-0"
              )}
              href={item.href}
            >
              {isEn ? item.ctaEn : item.ctaEs}
              <Icon icon={ArrowRight01Icon} size={13} />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
