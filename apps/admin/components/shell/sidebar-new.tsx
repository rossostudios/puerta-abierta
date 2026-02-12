"use client";

import {
  AuditIcon,
  Building01Icon,
  Calendar02Icon,
  CalendarCheckIn01Icon,
  ChartIcon,
  Door01Icon,
  File01Icon,
  GridViewIcon,
  Home01Icon,
  Invoice01Icon,
  Link01Icon,
  Message01Icon,
  Share06Icon,
  SparklesIcon,
  Task01Icon,
  UserGroupIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { OrgSwitcher } from "@/components/shell/org-switcher";
import { SidebarAccount } from "@/components/shell/sidebar-account";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import { getModuleLabel, MODULE_BY_SLUG, MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

const MODULE_ICONS: Record<string, IconSvgElement> = {
  organizations: Building01Icon,
  properties: Home01Icon,
  units: Door01Icon,
  channels: Share06Icon,
  listings: Link01Icon,
  guests: UserGroupIcon,
  reservations: CalendarCheckIn01Icon,
  calendar: Calendar02Icon,
  tasks: Task01Icon,
  expenses: Invoice01Icon,
  "owner-statements": File01Icon,
  pricing: SparklesIcon,
  "marketplace-listings": Home01Icon,
  applications: UserGroupIcon,
  leases: File01Icon,
  collections: Invoice01Icon,
  "transparency-summary": ChartIcon,
  messaging: Message01Icon,
  "integration-events": WebhookIcon,
  "audit-logs": AuditIcon,
  reports: ChartIcon,
};

type ViewportMode = "desktop" | "tablet" | "mobile";

type SectionKey =
  | "workspace"
  | "leasing"
  | "operations"
  | "portfolio"
  | "finance"
  | "platform"
  | "other";

type RouteLinkDef = {
  href: string;
  icon: IconSvgElement;
  label: {
    "es-PY": string;
    "en-US": string;
  };
};

type SectionDef = {
  key: SectionKey;
  icon: IconSvgElement;
  label: {
    "es-PY": string;
    "en-US": string;
  };
  routeLinks?: RouteLinkDef[];
  moduleSlugs: string[];
};

type ResolvedLink = {
  href: string;
  icon: IconSvgElement;
  label: string;
  iconElement: IconSvgElement;
};

type ResolvedSection = {
  key: SectionKey;
  label: string;
  links: ResolvedLink[];
};

const SECTIONS: SectionDef[] = [
  {
    key: "workspace",
    icon: GridViewIcon,
    label: {
      "es-PY": "Inicio",
      "en-US": "Home",
    },
    routeLinks: [
      {
        href: "/app",
        icon: GridViewIcon,
        label: {
          "es-PY": "Panel",
          "en-US": "Dashboard",
        },
      },
      {
        href: "/setup",
        icon: SparklesIcon,
        label: {
          "es-PY": "Configuración",
          "en-US": "Setup",
        },
      },
    ],
    moduleSlugs: [],
  },
  {
    key: "leasing",
    icon: Home01Icon,
    label: {
      "es-PY": "Leasing",
      "en-US": "Leasing",
    },
    moduleSlugs: [
      "marketplace-listings",
      "applications",
      "leases",
      "collections",
    ],
  },
  {
    key: "operations",
    icon: Task01Icon,
    label: {
      "es-PY": "Operaciones",
      "en-US": "Operations",
    },
    moduleSlugs: ["tasks", "reservations", "calendar", "guests", "messaging"],
  },
  {
    key: "portfolio",
    icon: Building01Icon,
    label: {
      "es-PY": "Portafolio",
      "en-US": "Portfolio",
    },
    moduleSlugs: ["properties", "units", "channels", "listings"],
  },
  {
    key: "finance",
    icon: Invoice01Icon,
    label: {
      "es-PY": "Finanzas",
      "en-US": "Finance",
    },
    moduleSlugs: [
      "expenses",
      "owner-statements",
      "pricing",
      "reports",
      "transparency-summary",
    ],
  },
  {
    key: "platform",
    icon: WebhookIcon,
    label: {
      "es-PY": "Plataforma",
      "en-US": "Platform",
    },
    moduleSlugs: ["organizations", "integration-events", "audit-logs"],
  },
];

const COLLAPSED_SECTIONS_KEY = "pa-sidebar-collapsed-sections";

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function resolveModuleLink(slug: string, locale: Locale): ResolvedLink | null {
  const module = MODULE_BY_SLUG.get(slug);
  if (!module) return null;

  return {
    href: `/module/${module.slug}`,
    icon: MODULE_ICONS[module.slug] ?? GridViewIcon,
    iconElement: MODULE_ICONS[module.slug] ?? GridViewIcon,
    label: getModuleLabel(module, locale),
  };
}

function resolveSections(locale: Locale): ResolvedSection[] {
  const resolved = SECTIONS.map((section) => {
    const routeLinks = (section.routeLinks ?? []).map((link) => ({
      href: link.href,
      icon: link.icon,
      iconElement: link.icon,
      label: link.label[locale],
    }));

    const moduleLinks = section.moduleSlugs
      .map((slug) => resolveModuleLink(slug, locale))
      .filter((item): item is ResolvedLink => Boolean(item));

    return {
      key: section.key,
      label: section.label[locale],
      links: [...routeLinks, ...moduleLinks],
    } satisfies ResolvedSection;
  }).filter((section) => section.links.length > 0);

  const knownSlugs = new Set(
    SECTIONS.flatMap((section) => section.moduleSlugs)
  );
  const extras = MODULES.filter((module) => !knownSlugs.has(module.slug));

  if (extras.length) {
    resolved.push({
      key: "other",
      label: locale === "en-US" ? "Other" : "Otros",
      links: extras.map((module) => ({
        href: `/module/${module.slug}`,
        icon: MODULE_ICONS[module.slug] ?? SparklesIcon,
        iconElement: MODULE_ICONS[module.slug] ?? SparklesIcon,
        label: getModuleLabel(module, locale),
      })),
    });
  }

  return resolved;
}

function useCollapsedSections(): [Set<SectionKey>, (key: SectionKey) => void] {
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SectionKey[];
        if (Array.isArray(parsed)) {
          setCollapsed(new Set(parsed));
        }
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const toggle = useCallback((key: SectionKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...next]));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
}

function SidebarContent({
  locale,
  orgId,
}: {
  locale: Locale;
  orgId: string | null;
}) {
  const pathname = usePathname();
  const sections = useMemo(() => resolveSections(locale), [locale]);
  const [collapsedSections, toggleSection] = useCollapsedSections();

  return (
    <div className="flex h-full flex-col">
      {/* Brand / Logo Area */}
      <div className="flex h-14 shrink-0 items-center px-4">
        <OrgSwitcher activeOrgId={orgId} locale={locale} />
      </div>

      {/* Navigation */}
      <div className="sidebar-scroll-mask flex-1 overflow-y-auto px-3 py-1.5">
        <nav className="space-y-3">
          {sections.map((section) => {
            const isHome = section.key === "workspace";
            const isCollapsed = !isHome && collapsedSections.has(section.key);

            if (isHome) {
              return (
                <div className="space-y-0.5" key={section.key}>
                  {section.links.map((link) => {
                    const active = isRouteActive(pathname, link.href);
                    return (
                      <Link
                        className={cn(
                          "group flex items-center gap-2 rounded-lg px-2 py-[5px] transition-all duration-200 ease-in-out",
                          active
                            ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-border/40"
                            : "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
                        )}
                        href={link.href}
                        key={link.href}
                      >
                        <Icon
                          className={cn(
                            "shrink-0 transition-colors",
                            active
                              ? "text-primary"
                              : "text-muted-foreground/60 group-hover:text-foreground/80"
                          )}
                          icon={link.iconElement}
                          size={16}
                        />
                        <span className="truncate font-medium text-[13px] leading-5">
                          {link.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            }

            return (
              <Collapsible
                key={section.key}
                onOpenChange={() => toggleSection(section.key)}
                open={!isCollapsed}
              >
                <CollapsibleTrigger className="group flex w-full items-center gap-1 px-2 pt-1 pb-1">
                  <svg
                    aria-hidden="true"
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-150",
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
                  <span className="font-medium text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
                    {section.label}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-0.5 space-y-0.5">
                    {section.links.map((link) => {
                      const active = isRouteActive(pathname, link.href);
                      return (
                        <Link
                          className={cn(
                            "group flex items-center gap-2 rounded-lg px-2 py-[5px] transition-all duration-200 ease-in-out",
                            active
                              ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-border/40"
                              : "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
                          )}
                          href={link.href}
                          key={link.href}
                        >
                          <Icon
                            className={cn(
                              "shrink-0 transition-colors",
                              active
                                ? "text-primary"
                                : "text-muted-foreground/60 group-hover:text-foreground/80"
                            )}
                            icon={link.iconElement}
                            size={16}
                          />
                          <span className="truncate font-medium text-[13px] leading-5">
                            {link.label}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className="shrink-0 p-3 pt-0">
        <SidebarAccount collapsed={false} locale={locale} />
      </div>
    </div>
  );
}

import { Drawer } from "@/components/ui/drawer";

export function SidebarNew({
  locale,
  orgId,
  viewportMode,
  isMobileDrawerOpen,
  onMobileDrawerOpenChange,
}: {
  locale: Locale;
  orgId: string | null;
  viewportMode: ViewportMode;
  isMobileDrawerOpen: boolean;
  onMobileDrawerOpenChange: (next: boolean) => void;
}) {
  const isDesktop = viewportMode === "desktop";

  if (isDesktop) {
    return (
      <aside className="w-[240px] shrink-0 border-border/60 border-r bg-muted/15">
        <SidebarContent locale={locale} orgId={orgId} />
      </aside>
    );
  }

  return (
    <Drawer
      className="w-[280px] p-0"
      closeLabel={locale === "en-US" ? "Close navigation" : "Cerrar navegación"}
      contentClassName="p-0"
      onOpenChange={onMobileDrawerOpenChange}
      open={isMobileDrawerOpen}
      side="left"
    >
      <div className="h-full bg-muted/15">
        <div className="h-full bg-muted/15">
          <SidebarContent locale={locale} orgId={orgId} />
        </div>
      </div>
    </Drawer>
  );
}
