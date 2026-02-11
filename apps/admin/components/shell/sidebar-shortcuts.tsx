"use client";

import { Clock01Icon, PinIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import {
  getPins,
  getRecents,
  type ShortcutItem,
  subscribeShortcuts,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

function ItemLink({ item }: { item: ShortcutItem }) {
  return (
    <Link
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "w-full justify-start gap-2.5 rounded-2xl px-2.5 py-2.5 font-normal text-foreground/72 transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground"
      )}
      href={item.href}
      prefetch={false}
      title={item.href}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.meta ? (
          <span className="block truncate text-[11px] text-foreground/48">
            {item.meta}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function SidebarShortcuts({
  collapsed,
  locale,
}: {
  collapsed: boolean;
  locale: Locale;
}) {
  const [pins, setPins] = useState<ShortcutItem[]>([]);
  const [recents, setRecents] = useState<ShortcutItem[]>([]);
  const isEn = locale === "en-US";

  useEffect(() => {
    if (collapsed) return;
    const sync = () => {
      setPins(getPins());
      setRecents(getRecents());
    };
    sync();
    return subscribeShortcuts(sync);
  }, [collapsed]);

  if (collapsed) return null;

  if (!(pins.length || recents.length)) return null;

  return (
    <div className="space-y-3">
      {pins.length ? (
        <div className="space-y-1">
          <p className="px-2 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
            <span className="inline-flex items-center gap-1.5">
              <Icon icon={PinIcon} size={14} />
              {isEn ? "Pinned" : "Fijados"}
            </span>
          </p>
          <div className="space-y-1">
            {pins.map((item) => (
              <ItemLink item={item} key={item.href} />
            ))}
          </div>
        </div>
      ) : null}

      {recents.length ? (
        <div className="space-y-1">
          <p className="px-2 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
            <span className="inline-flex items-center gap-1.5">
              <Icon icon={Clock01Icon} size={14} />
              {isEn ? "Recent" : "Recientes"}
            </span>
          </p>
          <div className="space-y-1">
            {recents.slice(0, 6).map((item) => (
              <ItemLink item={item} key={item.href} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
