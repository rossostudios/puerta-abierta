"use client";

import type { IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SHORTCUT_BY_HREF } from "@/lib/hotkeys/config";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { RouteLinkDef } from "./sidebar-types";
import { isRouteActive } from "./sidebar-utils";

export function ShortcutKbd({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, i) => (
        <span className="inline-flex items-center gap-0.5" key={key}>
          {i > 0 && (
            <span className="text-[10px] text-muted-foreground/60">then</span>
          )}
          <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border/80 bg-muted/70 px-1 font-medium font-mono text-[10px] text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  );
}

export function NavLinkRow({
  active,
  badge,
  count,
  href,
  icon,
  label,
}: {
  active: boolean;
  badge?: string | null;
  count?: number | null;
  href: string;
  icon: IconSvgElement;
  label: string;
}) {
  const shortcutKeys = SHORTCUT_BY_HREF[href];

  const link = (
    <Link
      className={cn(
        "group/nav flex items-center gap-2 rounded-lg px-2 py-[5px] transition-all duration-200 ease-in-out",
        active
          ? "bg-[var(--shell-active)] text-sidebar-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
      )}
      href={href}
    >
      <Icon
        className={cn(
          "shrink-0 transition-colors",
          active
            ? "text-sidebar-primary"
            : "text-sidebar-foreground/50 group-hover/nav:text-sidebar-foreground/80"
        )}
        icon={icon}
        size={16}
      />
      <span className="truncate font-medium text-[14px] leading-5">
        {label}
      </span>
      {badge && (
        <span className="ml-1 rounded-full bg-sidebar-primary/10 px-1.5 py-px font-medium text-[9px] text-sidebar-primary uppercase tracking-wider">
          {badge}
        </span>
      )}
      {count != null && count > 0 && (
        <span
          className={cn(
            "ml-auto shrink-0 rounded-full px-1.5 py-px text-[10px] tabular-nums",
            active
              ? "bg-sidebar-primary/15 font-medium text-sidebar-primary"
              : "bg-sidebar-accent/80 text-sidebar-foreground/50"
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );

  if (!shortcutKeys) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent
        className="flex items-center gap-2.5 px-2.5 py-1.5"
        side="right"
        sideOffset={12}
      >
        <span className="font-medium text-[11px] text-popover-foreground">
          {label}
        </span>
        <ShortcutKbd keys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

export function ShortcutBlock({
  label,
  links,
  locale,
  pathname,
  search,
}: {
  label: { "es-PY": string; "en-US": string };
  links: RouteLinkDef[];
  locale: Locale;
  pathname: string;
  search: string;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="px-2 font-medium text-[10px] text-sidebar-foreground/40 uppercase tracking-[0.08em]">
        {label[locale]}
      </h3>
      <div className="space-y-0.5">
        {links.map((link) => (
          <NavLinkRow
            active={isRouteActive(pathname, search, link.href)}
            href={link.href}
            icon={link.icon}
            key={link.href}
            label={link.label[locale]}
          />
        ))}
      </div>
    </section>
  );
}
