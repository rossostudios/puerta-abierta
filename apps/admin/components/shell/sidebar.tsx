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

import { SidebarAccount } from "@/components/shell/sidebar-account";
import { SidebarShortcuts } from "@/components/shell/sidebar-shortcuts";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Locale } from "@/lib/i18n";
import { getModuleLabel, MODULE_BY_SLUG, MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

const STORAGE_LAST_SECTION_KEY = "pa-sidebar-last-section";

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

export type ViewportMode = "desktop" | "tablet" | "mobile";

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
  description: {
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
};

type ResolvedSection = {
  key: SectionKey;
  icon: IconSvgElement;
  label: string;
  description: string;
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
    description: {
      "es-PY": "Visión general y configuración de la cuenta.",
      "en-US": "Overview and workspace configuration.",
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
    description: {
      "es-PY": "Publicación, aplicaciones y conversión a contrato.",
      "en-US": "Listing publication, applications, and lease conversion.",
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
    description: {
      "es-PY": "Ejecución diaria de servicio, comunicación y agenda.",
      "en-US": "Daily service execution, messaging, and scheduling.",
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
    description: {
      "es-PY": "Inventario de propiedades, unidades y canales.",
      "en-US": "Properties, units, and channel inventory.",
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
    description: {
      "es-PY": "Costos, reportes y transparencia para propietarios.",
      "en-US": "Costs, reporting, and owner transparency.",
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
    description: {
      "es-PY": "Organización, integraciones y auditoría.",
      "en-US": "Organization settings, integrations, and audit.",
    },
    moduleSlugs: ["organizations", "integration-events", "audit-logs"],
  },
];

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
    label: getModuleLabel(module, locale),
  };
}

function resolveSections(locale: Locale): ResolvedSection[] {
  const resolved = SECTIONS.map((section) => {
    const routeLinks = (section.routeLinks ?? []).map((link) => ({
      href: link.href,
      icon: link.icon,
      label: link.label[locale],
    }));

    const moduleLinks = section.moduleSlugs
      .map((slug) => resolveModuleLink(slug, locale))
      .filter((item): item is ResolvedLink => Boolean(item));

    return {
      key: section.key,
      icon: section.icon,
      label: section.label[locale],
      description: section.description[locale],
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
      icon: SparklesIcon,
      label: locale === "en-US" ? "Other" : "Otros",
      description:
        locale === "en-US"
          ? "Additional modules outside core navigation groups."
          : "Módulos adicionales fuera de los grupos principales.",
      links: extras.map((module) => ({
        href: `/module/${module.slug}`,
        icon: MODULE_ICONS[module.slug] ?? SparklesIcon,
        label: getModuleLabel(module, locale),
      })),
    });
  }

  return resolved;
}

function sectionButtonClass(active: boolean): string {
  return cn(
    "group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
    active
      ? "bg-[color-mix(in_oklch,var(--sidebar-primary)_16%,var(--background))] text-[var(--sidebar-primary)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--sidebar-primary)_28%,transparent)]"
      : "text-foreground/58 hover:bg-[color-mix(in_oklch,var(--sidebar-primary)_7%,transparent)] hover:text-foreground/90"
  );
}

function moduleLinkClass(active: boolean): string {
  return cn(
    "group flex min-h-11 items-center gap-3 rounded-2xl px-3.5 py-2.5 transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
    active
      ? "bg-[color-mix(in_oklch,var(--sidebar-primary)_12%,var(--background))] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--sidebar-primary)_24%,transparent)]"
      : "text-foreground/62 hover:bg-[color-mix(in_oklch,var(--sidebar-primary)_7%,transparent)] hover:text-foreground/92"
  );
}

function persistLastSection(sectionKey: SectionKey): void {
  try {
    localStorage.setItem(STORAGE_LAST_SECTION_KEY, sectionKey);
  } catch {
    // Ignore storage failures.
  }
}

type ContextPanelProps = {
  section: ResolvedSection;
  locale: Locale;
  pathname: string;
  onLinkNavigate?: () => void;
  showHeader?: boolean;
  showAccount?: boolean;
};

function ContextPanel({
  section,
  locale,
  pathname,
  onLinkNavigate,
  showHeader = true,
  showAccount = true,
}: ContextPanelProps) {
  const isEn = locale === "en-US";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeader ? (
        <header className="space-y-1.5 px-1.5">
          <p className="font-semibold text-[11px] text-foreground/55 uppercase tracking-[0.16em]">
            {isEn ? "Navigation" : "Navegación"}
          </p>
          <h2 className="font-semibold text-[19px] text-foreground leading-tight">
            {section.label}
          </h2>
          <p className="text-[12px] text-foreground/58 leading-snug">
            {section.description}
          </p>
        </header>
      ) : null}

      <nav
        className={cn(
          "min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1",
          showHeader ? "mt-3" : "mt-0"
        )}
      >
        {section.links.map((link) => {
          const active = isRouteActive(pathname, link.href);
          return (
            <Link
              className={moduleLinkClass(active)}
              href={link.href}
              key={link.href}
              onClick={onLinkNavigate}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-[120ms]",
                  active
                    ? "bg-[color-mix(in_oklch,var(--sidebar-primary)_14%,var(--background))] text-[var(--sidebar-primary)]"
                    : "bg-foreground/4 text-foreground/60 group-hover:bg-[color-mix(in_oklch,var(--sidebar-primary)_10%,transparent)] group-hover:text-foreground/85"
                )}
              >
                <Icon icon={link.icon} size={18} />
              </span>
              <span className="truncate font-medium text-[15px] leading-5">
                {link.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {section.key === "workspace" ? (
        <div className="mt-3 border-sidebar-border/70 border-t pt-3">
          <SidebarShortcuts collapsed={false} locale={locale} />
        </div>
      ) : null}

      {showAccount ? (
        <SidebarAccount collapsed={false} locale={locale} />
      ) : null}
    </div>
  );
}

export function Sidebar({
  locale,
  viewportMode,
  desktopPanelCollapsed,
  onDesktopPanelCollapsedChange,
  isContextPanelOpen,
  onContextPanelOpenChange,
  isMobileDrawerOpen,
  onMobileDrawerOpenChange,
}: {
  locale: Locale;
  viewportMode: ViewportMode;
  desktopPanelCollapsed: boolean;
  onDesktopPanelCollapsedChange: (next: boolean) => void;
  isContextPanelOpen: boolean;
  onContextPanelOpenChange: (next: boolean) => void;
  isMobileDrawerOpen: boolean;
  onMobileDrawerOpenChange: (next: boolean) => void;
}) {
  const pathname = usePathname();
  const isEn = locale === "en-US";

  const sections = useMemo(() => resolveSections(locale), [locale]);

  const routeSectionKey = useMemo(() => {
    return sections.find((section) =>
      section.links.some((link) => isRouteActive(pathname, link.href))
    )?.key;
  }, [pathname, sections]);

  const [selectedSectionKey, setSelectedSectionKey] =
    useState<SectionKey | null>(null);

  useEffect(() => {
    if (selectedSectionKey) return;

    let stored: SectionKey | null = null;
    try {
      const fromStorage = localStorage.getItem(STORAGE_LAST_SECTION_KEY);
      if (
        fromStorage &&
        sections.some((section) => section.key === fromStorage)
      ) {
        stored = fromStorage as SectionKey;
      }
    } catch {
      stored = null;
    }

    setSelectedSectionKey(
      stored ?? routeSectionKey ?? sections[0]?.key ?? null
    );
  }, [routeSectionKey, sections, selectedSectionKey]);

  useEffect(() => {
    if (!routeSectionKey) return;
    setSelectedSectionKey(routeSectionKey);
    persistLastSection(routeSectionKey);
  }, [routeSectionKey]);

  const activeSection = useMemo(() => {
    if (!sections.length) return null;
    return (
      sections.find((section) => section.key === selectedSectionKey) ??
      sections.find((section) => section.key === routeSectionKey) ??
      sections[0]
    );
  }, [routeSectionKey, sections, selectedSectionKey]);

  const railActiveKey = routeSectionKey ?? activeSection?.key;

  const setSection = useCallback((nextSectionKey: SectionKey) => {
    setSelectedSectionKey(nextSectionKey);
    persistLastSection(nextSectionKey);
  }, []);

  const handleContextLinkNavigate = useCallback(() => {
    if (viewportMode === "tablet") {
      onContextPanelOpenChange(false);
      return;
    }
    if (viewportMode === "mobile") {
      onMobileDrawerOpenChange(false);
    }
  }, [onContextPanelOpenChange, onMobileDrawerOpenChange, viewportMode]);

  const handleRailSelect = useCallback(
    (sectionKey: SectionKey) => {
      setSection(sectionKey);

      if (viewportMode === "desktop" && desktopPanelCollapsed) {
        onDesktopPanelCollapsedChange(false);
        return;
      }

      if (viewportMode === "tablet") {
        onContextPanelOpenChange(true);
      }
    },
    [
      desktopPanelCollapsed,
      onContextPanelOpenChange,
      onDesktopPanelCollapsedChange,
      setSection,
      viewportMode,
    ]
  );

  const rail =
    viewportMode === "mobile" ? null : (
      <aside
        className={cn(
          "flex h-full min-h-0 shrink-0 flex-col border-sidebar-border/70 border-r bg-sidebar",
          viewportMode === "desktop" ? "w-[88px]" : "w-20"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col items-center px-2 py-3">
          <div className="flex flex-col items-center pb-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--sidebar-primary)_18%,var(--background))] text-[var(--sidebar-primary)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--sidebar-primary)_28%,transparent)]">
              <Icon icon={Building01Icon} size={19} />
            </div>
          </div>

          <TooltipProvider delay={350}>
            <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-visible py-1">
              {sections.map((section) => {
                const href = section.links[0]?.href;
                if (!href) return null;

                const sectionActive = section.key === railActiveKey;

                return (
                  <Tooltip key={section.key}>
                    <TooltipTrigger asChild>
                      <Link
                        aria-label={section.label}
                        className={sectionButtonClass(sectionActive)}
                        href={href}
                        onClick={() => handleRailSelect(section.key)}
                      >
                        <Icon
                          className={cn(
                            "shrink-0",
                            sectionActive ? "text-foreground" : "text-current"
                          )}
                          icon={section.icon}
                          size={19}
                        />
                        <span className="sr-only">{section.label}</span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {section.label}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </nav>
          </TooltipProvider>

          <div className="mt-auto w-full pt-3">
            <SidebarAccount collapsed locale={locale} />
          </div>
        </div>
      </aside>
    );

  const desktopContextPanel =
    viewportMode === "desktop" && !desktopPanelCollapsed && activeSection ? (
      <aside className="flex h-full min-h-0 w-[304px] shrink-0 border-sidebar-border/70 border-r bg-sidebar p-3">
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-sidebar-border/80 bg-background/90 p-3">
          <ContextPanel
            locale={locale}
            onLinkNavigate={handleContextLinkNavigate}
            pathname={pathname}
            section={activeSection}
          />
        </section>
      </aside>
    ) : null;

  const tabletContextDrawer =
    viewportMode === "tablet" && activeSection ? (
      <Drawer
        className="w-[300px]"
        closeLabel={isEn ? "Close navigation" : "Cerrar navegación"}
        description={activeSection.description}
        onOpenChange={onContextPanelOpenChange}
        open={isContextPanelOpen}
        side="left"
        title={activeSection.label}
      >
        <div className="h-full p-3">
          <section className="flex h-full min-h-0 flex-col rounded-2xl border border-sidebar-border/80 bg-background/90 p-3">
            <ContextPanel
              locale={locale}
              onLinkNavigate={handleContextLinkNavigate}
              pathname={pathname}
              section={activeSection}
              showAccount={false}
              showHeader={false}
            />
          </section>
        </div>
      </Drawer>
    ) : null;

  const mobileDrawer =
    viewportMode === "mobile" && activeSection ? (
      <Drawer
        closeLabel={isEn ? "Close navigation" : "Cerrar navegación"}
        contentClassName="p-3"
        onOpenChange={onMobileDrawerOpenChange}
        open={isMobileDrawerOpen}
        side="left"
        title={isEn ? "Navigation" : "Navegación"}
      >
        <section className="flex h-full min-h-0 flex-col rounded-2xl border border-sidebar-border/80 bg-background/90 p-3">
          <div className="border-sidebar-border/70 border-b pb-3">
            <p className="font-semibold text-[11px] text-foreground/55 uppercase tracking-[0.16em]">
              {isEn ? "Sections" : "Secciones"}
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {sections.map((section) => {
                const isActive = section.key === activeSection.key;
                return (
                  <Tooltip key={section.key}>
                    <TooltipTrigger asChild>
                      <button
                        aria-label={section.label}
                        className={sectionButtonClass(isActive)}
                        onClick={() => setSection(section.key)}
                        type="button"
                      >
                        <Icon icon={section.icon} size={18} />
                        <span className="sr-only">{section.label}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {section.label}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          <div className="mt-3 min-h-0 flex-1">
            <ContextPanel
              locale={locale}
              onLinkNavigate={handleContextLinkNavigate}
              pathname={pathname}
              section={activeSection}
              showHeader={false}
            />
          </div>
        </section>
      </Drawer>
    ) : null;

  return (
    <>
      {rail}
      {desktopContextPanel}
      {tabletContextDrawer}
      {mobileDrawer}
    </>
  );
}
