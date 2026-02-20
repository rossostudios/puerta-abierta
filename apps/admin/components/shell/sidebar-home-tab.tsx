"use client";

import { Separator } from "@base-ui/react/separator";
import { Cancel01Icon, Settings03Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { NavLinkRow } from "./sidebar-nav-link";
import type { MemberRole, OnboardingProgress, ResolvedSection } from "./sidebar-types";
import { isRouteActive, resolveSections, useCollapsedSections } from "./sidebar-utils";

export function SidebarHomeTab({
  locale,
  orgId,
  onboardingProgress,
  role,
}: {
  locale: Locale;
  orgId: string | null;
  onboardingProgress?: OnboardingProgress;
  role?: MemberRole | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const isEn = locale === "en-US";
  const sections = useMemo(() => resolveSections(locale, role), [locale, role]);
  const [collapsedSections, toggleSection] = useCollapsedSections();
  const [onboardingHubClosed, setOnboardingHubClosed] = useState(false);
  const showOnboardingHub = !onboardingHubClosed;
  const completionPercent = Math.round(
    Math.max(0, Math.min(100, onboardingProgress?.percent ?? 0))
  );
  const onboardingCompleted = completionPercent >= 100;

  const { data: sidebarCounts } = useQuery({
    queryKey: ["sidebar-counts", orgId],
    queryFn: async () => {
      const urls = [
        `/api/listings/count?org_id=${encodeURIComponent(orgId!)}`,
        `/api/properties/count?org_id=${encodeURIComponent(orgId!)}`,
        `/api/units/count?org_id=${encodeURIComponent(orgId!)}`,
      ] as const;

      const results = await Promise.all(
        urls.map((url) =>
          fetch(url, { cache: "no-store" })
            .then((res) => res.json() as Promise<{ count?: number | null }>)
            .then((body) => (typeof body.count === "number" ? body.count : null))
            .catch(() => null)
        )
      );

      return {
        listings: results[0],
        properties: results[1],
        units: results[2],
      };
    },
    enabled: Boolean(orgId),
  });

  const listingCount = sidebarCounts?.listings ?? null;
  const propertiesCount = sidebarCounts?.properties ?? null;
  const unitsCount = sidebarCounts?.units ?? null;

  const sectionsWithCounts = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        links: section.links.map((link) => {
          if (link.href === "/module/listings")
            return { ...link, count: listingCount };
          if (link.href === "/module/properties")
            return { ...link, count: propertiesCount };
          if (link.href === "/module/units")
            return { ...link, count: unitsCount };
          if (link.href === "/module/integrations")
            return { ...link, badge: isEn ? "Soon" : "Pronto" };
          return link;
        }),
      })),
    [sections, listingCount, propertiesCount, unitsCount, isEn]
  );

  return (
    <nav className="space-y-3">
      {showOnboardingHub && !onboardingCompleted ? (
        <Link
          className="group block rounded-xl border border-sidebar-border/60 bg-sidebar-accent/40 p-3 transition-colors hover:border-sidebar-primary/30 hover:bg-sidebar-accent/60"
          href="/setup"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Icon
                className="text-sidebar-primary/80"
                icon={Settings03Icon}
                size={15}
              />
              <span className="truncate font-semibold text-[13px] text-sidebar-foreground">
                {isEn ? "Setup" : "Configuración"}
              </span>
            </div>
            <button
              aria-label={
                isEn
                  ? "Dismiss setup widget"
                  : "Cerrar widget de configuración"
              }
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOnboardingHubClosed(true);
              }}
              type="button"
            >
              <Icon icon={Cancel01Icon} size={13} />
            </button>
          </div>
          <Progress
            aria-valuetext={`${completionPercent}%`}
            className="mt-2.5 h-2 bg-sidebar-accent [&>div]:bg-sidebar-primary"
            value={completionPercent}
          />
          <p className="mt-1.5 font-medium text-[12px] text-sidebar-foreground/55">
            {isEn
              ? `${completionPercent}% complete`
              : `${completionPercent}% completado`}
          </p>
        </Link>
      ) : null}

      {sectionsWithCounts.map((section, index) => {
        const isCollapsed = collapsedSections.has(section.key);

        return (
          <div key={section.key}>
            {index > 0 && (
              <Separator className="mx-2 mb-2 h-px bg-border/40" />
            )}
            <Collapsible
              onOpenChange={() => toggleSection(section.key)}
              open={!isCollapsed}
            >
              <CollapsibleTrigger className="group flex w-full items-center gap-1 px-2 pt-1 pb-1">
                <svg
                  aria-hidden="true"
                  className={cn(
                    "h-3 w-3 shrink-0 text-sidebar-foreground/30 transition-transform duration-150",
                    isCollapsed ? "-rotate-90" : "rotate-0"
                  )}
                  fill="none"
                  focusable="false"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
                <span className="font-medium text-[10px] text-sidebar-foreground/40 uppercase tracking-[0.08em]">
                  {section.label}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-0.5 space-y-0.5">
                  {section.links.map((link) => (
                    <NavLinkRow
                      active={isRouteActive(pathname, search, link.href)}
                      badge={link.badge}
                      count={link.count}
                      href={link.href}
                      icon={link.iconElement}
                      key={link.href}
                      label={link.label}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </nav>
  );
}
