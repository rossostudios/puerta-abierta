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
  Menu01Icon,
  MenuCollapseIcon,
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
import { useMemo } from "react";

import { SidebarAccount } from "@/components/shell/sidebar-account";
import { SidebarShortcuts } from "@/components/shell/sidebar-shortcuts";
import { buttonVariants } from "@/components/ui/button";
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
    "group relative flex w-full items-center justify-center rounded-2xl px-2 py-3 transition-all duration-150",
    active
      ? "bg-[color-mix(in_oklch,var(--foreground)_9%,var(--background))] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--foreground)_16%,transparent)]"
      : "text-foreground/58 hover:bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] hover:text-foreground/90"
  );
}

function moduleLinkClass(active: boolean): string {
  return cn(
    "group flex min-h-11 items-center gap-3 rounded-2xl px-3.5 py-2.5 transition-all duration-150",
    active
      ? "bg-[color-mix(in_oklch,var(--foreground)_10%,var(--background))] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--foreground)_18%,transparent)]"
      : "text-foreground/62 hover:bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] hover:text-foreground/92"
  );
}

export function SidebarV1({
  collapsed,
  onCollapsedChange,
  locale,
}: {
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
  locale: Locale;
}) {
  const pathname = usePathname();
  const isEn = locale === "en-US";

  const sections = useMemo(() => resolveSections(locale), [locale]);

  const activeSection = useMemo(() => {
    return (
      sections.find((section) =>
        section.links.some((link) => isRouteActive(pathname, link.href))
      ) ?? sections[0]
    );
  }, [pathname, sections]);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 border-sidebar-border/70 border-r bg-sidebar/95 p-1.5 text-sidebar-foreground transition-[width] duration-200 ease-out sm:p-2",
        collapsed ? "w-[88px]" : "w-[300px] lg:w-[320px] 2xl:w-[352px]"
      )}
    >
      <div className="flex min-h-0 flex-1 gap-1.5 sm:gap-2">
        <section
          className={cn(
            "flex min-h-0 flex-col rounded-2xl border border-sidebar-border/80 bg-background/72 p-1.5 sm:p-2",
            collapsed ? "w-full" : "w-[84px] sm:w-[88px]"
          )}
        >
          <div className="flex flex-col items-center gap-2 pb-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_24%,transparent)]">
              <Icon icon={Building01Icon} size={19} />
            </div>
            <button
              aria-label={
                collapsed
                  ? isEn
                    ? "Expand sidebar"
                    : "Expandir barra lateral"
                  : isEn
                    ? "Collapse sidebar"
                    : "Colapsar barra lateral"
              }
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "h-9 w-9 rounded-xl text-foreground/65 hover:text-foreground"
              )}
              onClick={() => onCollapsedChange(!collapsed)}
              title={
                collapsed
                  ? isEn
                    ? "Expand sidebar"
                    : "Expandir barra lateral"
                  : isEn
                    ? "Collapse sidebar"
                    : "Colapsar barra lateral"
              }
              type="button"
            >
              <Icon
                icon={collapsed ? Menu01Icon : MenuCollapseIcon}
                size={18}
              />
            </button>
          </div>

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-visible pt-1">
            {sections.map((section) => {
              const href = section.links[0]?.href;
              if (!href) return null;

              const sectionActive = section.key === activeSection?.key;
              return (
                <Link
                  className={sectionButtonClass(sectionActive)}
                  href={href}
                  key={section.key}
                  title={section.label}
                >
                  <Icon
                    className={cn(
                      "shrink-0",
                      sectionActive ? "text-foreground" : "text-current"
                    )}
                    icon={section.icon}
                    size={18}
                  />
                  <span className="sr-only">{section.label}</span>
                  <span
                    className={cn(
                      "pointer-events-none absolute top-1/2 left-[calc(100%+0.5rem)] z-40 translate-x-1 -translate-y-1/2 whitespace-nowrap rounded-xl border border-sidebar-border/80 bg-background px-2.5 py-1.5 font-medium text-[11px] text-foreground opacity-0 shadow-lg transition-all duration-150",
                      "group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
                    )}
                  >
                    {section.label}
                  </span>
                </Link>
              );
            })}
          </nav>

          {collapsed ? <SidebarAccount collapsed locale={locale} /> : null}
        </section>

        {collapsed ? null : (
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-sidebar-border/80 bg-background/75 p-2.5 sm:p-3">
            <header className="space-y-1.5 px-1.5">
              <p className="font-semibold text-[11px] text-foreground/55 uppercase tracking-[0.16em]">
                {isEn ? "Navigation" : "Navegación"}
              </p>
              <h2 className="font-semibold text-[19px] text-foreground leading-tight">
                {activeSection?.label}
              </h2>
              <p className="text-[12px] text-foreground/58 leading-snug">
                {activeSection?.description}
              </p>
            </header>

            <nav className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-auto pr-1">
              {(activeSection?.links ?? []).map((link) => {
                const active = isRouteActive(pathname, link.href);
                return (
                  <Link
                    className={moduleLinkClass(active)}
                    href={link.href}
                    key={link.href}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                        active
                          ? "bg-foreground/10 text-foreground"
                          : "bg-foreground/4 text-foreground/60 group-hover:bg-foreground/8 group-hover:text-foreground/85"
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

            {activeSection?.key === "workspace" ? (
              <div className="mt-3 border-sidebar-border/70 border-t pt-3">
                <SidebarShortcuts collapsed={false} locale={locale} />
              </div>
            ) : null}

            <SidebarAccount collapsed={false} locale={locale} />
          </section>
        )}
      </div>
    </aside>
  );
}
