"use client";

import {
  AiVoiceGeneratorIcon,
  AuditIcon,
  Building01Icon,
  CalendarCheckIn01Icon,
  Cancel01Icon,
  ChartIcon,
  CheckmarkCircle02Icon,
  CreditCardIcon,
  Door01Icon,
  File01Icon,
  FolderAttachmentIcon,
  GridViewIcon,
  Home01Icon,
  InboxIcon,
  Invoice01Icon,
  Link01Icon,
  MailOpen01Icon,
  MailReply01Icon,
  Message01Icon,
  Search01Icon,
  Settings03Icon,
  SparklesIcon,
  StarIcon,
  Task01Icon,
  UserGroupIcon,
  WebhookIcon,
  WorkflowSquare03Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Separator } from "@base-ui/react/separator";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NotificationBell } from "@/components/shell/notification-bell";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { SidebarAccount } from "@/components/shell/sidebar-account";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SHORTCUT_BY_HREF } from "@/lib/hotkeys/config";
import type { Locale } from "@/lib/i18n";
import { getModuleLabel, MODULE_BY_SLUG, MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

const MODULE_ICONS: Record<string, IconSvgElement> = {
  organizations: Building01Icon,
  properties: Home01Icon,
  units: Door01Icon,
  integrations: Link01Icon,
  guests: UserGroupIcon,
  reservations: CalendarCheckIn01Icon,
  tasks: Task01Icon,
  expenses: Invoice01Icon,
  "owner-statements": File01Icon,
  pricing: SparklesIcon,
  listings: Home01Icon,
  applications: UserGroupIcon,
  leases: File01Icon,
  collections: Invoice01Icon,
  "transparency-summary": ChartIcon,
  messaging: Message01Icon,
  "integration-events": WebhookIcon,
  "audit-logs": AuditIcon,
  reports: ChartIcon,
  documents: FolderAttachmentIcon,
  "workflow-rules": WorkflowSquare03Icon,
  billing: CreditCardIcon,
};

export type ViewportMode = "desktop" | "tablet" | "mobile";

type SectionKey =
  | "workspace"
  | "rentals"
  | "operations"
  | "portfolio"
  | "finance"
  | "other";

type PrimaryTabKey = "home" | "chat" | "inbox";

type RouteLinkDef = {
  href: string;
  icon: IconSvgElement;
  label: {
    "es-PY": string;
    "en-US": string;
  };
};

export type MemberRole =
  | "owner_admin"
  | "operator"
  | "cleaner"
  | "accountant"
  | "viewer";

type SectionDef = {
  key: SectionKey;
  label: {
    "es-PY": string;
    "en-US": string;
  };
  routeLinks?: RouteLinkDef[];
  moduleSlugs: string[];
  /** When set, only users with one of these roles see this section. */
  roles?: MemberRole[];
};

type ResolvedLink = {
  href: string;
  label: string;
  iconElement: IconSvgElement;
  count?: number | null;
};

type ResolvedSection = {
  key: SectionKey;
  label: string;
  links: ResolvedLink[];
};

type OnboardingProgress = {
  completedSteps: number;
  totalSteps: number;
  percent: number;
};

type ChatAgentItem = {
  id: string;
  slug: string;
  name: string;
};

type ChatSummaryItem = {
  id: string;
  title: string;
  is_archived: boolean;
  latest_message_preview?: string | null;
};

const PRIMARY_TABS: Array<{
  key: PrimaryTabKey;
  href: string;
  icon: IconSvgElement;
  label: { "es-PY": string; "en-US": string };
}> = [
    {
      key: "home",
      href: "/app",
      icon: Home01Icon,
      label: { "es-PY": "Inicio", "en-US": "Home" },
    },
    {
      key: "chat",
      href: "/app/agents",
      icon: Message01Icon,
      label: { "es-PY": "Chat", "en-US": "Chat" },
    },
    {
      key: "inbox",
      href: "/module/messaging",
      icon: InboxIcon,
      label: { "es-PY": "Inbox", "en-US": "Inbox" },
    },
  ];

const CHAT_LINKS: RouteLinkDef[] = [
  {
    href: "/app/agents",
    icon: SparklesIcon,
    label: { "es-PY": "Agentes", "en-US": "Agents" },
  },
  {
    href: "/app/chats",
    icon: InboxIcon,
    label: { "es-PY": "Historial de chats", "en-US": "Chat history" },
  },
];

const INBOX_STATUS_LINKS: RouteLinkDef[] = [
  {
    href: "/module/messaging",
    icon: InboxIcon,
    label: { "es-PY": "Todos los mensajes", "en-US": "All Messages" },
  },
  {
    href: "/module/messaging?status=unread",
    icon: MailOpen01Icon,
    label: { "es-PY": "No leídos", "en-US": "Unread Messages" },
  },
  {
    href: "/module/messaging?status=awaiting",
    icon: MailReply01Icon,
    label: { "es-PY": "Esperando respuesta", "en-US": "Awaiting Reply" },
  },
  {
    href: "/module/messaging?status=resolved",
    icon: CheckmarkCircle02Icon,
    label: { "es-PY": "Resueltos", "en-US": "Resolved" },
  },
  {
    href: "/module/messaging?status=starred",
    icon: StarIcon,
    label: { "es-PY": "Destacados", "en-US": "Starred" },
  },
];

const INBOX_SEGMENT_LINKS: RouteLinkDef[] = [
  {
    href: "/module/messaging?segment=needs-engagement",
    icon: Message01Icon,
    label: { "es-PY": "Necesita atención", "en-US": "Needs engagement" },
  },
  {
    href: "/module/messaging?segment=lovable",
    icon: StarIcon,
    label: { "es-PY": "Encantadores", "en-US": "Lovable" },
  },
];

const SECTIONS: SectionDef[] = [
  {
    key: "rentals",
    label: {
      "es-PY": "Alquileres",
      "en-US": "Rentals",
    },
    moduleSlugs: ["listings", "leases", "reservations"],
    roles: ["owner_admin", "operator"],
  },
  {
    key: "operations",
    label: {
      "es-PY": "Operaciones",
      "en-US": "Operations",
    },
    moduleSlugs: ["tasks", "guests"],
    roles: ["owner_admin", "operator", "cleaner"],
  },
  {
    key: "portfolio",
    label: {
      "es-PY": "Portafolio",
      "en-US": "Portfolio",
    },
    moduleSlugs: ["properties", "units", "integrations"],
    roles: ["owner_admin", "operator"],
  },
  {
    key: "finance",
    label: {
      "es-PY": "Finanzas",
      "en-US": "Finance",
    },
    moduleSlugs: ["expenses", "pricing", "reports"],
    roles: ["owner_admin", "accountant"],
  },
  {
    key: "workspace",
    label: {
      "es-PY": "Espacio de trabajo",
      "en-US": "Workspace",
    },
    moduleSlugs: ["documents", "workflow-rules", "billing"],
    roles: ["owner_admin"],
  },
];

const COLLAPSED_SECTIONS_KEY = "pa-sidebar-collapsed-sections";
const APPLE_DEVICE_REGEX = /Mac|iPhone|iPad/i;
const HOME_TAB_HIDDEN_MODULE_SLUGS = new Set([
  "applications",
  "collections",
  "messaging",
  "owner-statements",
  "transparency-summary",
  "organizations",
  "integration-events",
  "audit-logs",
]);

function isRouteActive(
  pathname: string,
  search: string,
  href: string
): boolean {
  if (href === "/app") return pathname === "/app";

  const qIndex = href.indexOf("?");
  if (qIndex !== -1) {
    const hrefPath = href.slice(0, qIndex);
    const hrefParams = new URLSearchParams(href.slice(qIndex + 1));
    if (pathname !== hrefPath && !pathname.startsWith(`${hrefPath}/`))
      return false;
    const currentParams = new URLSearchParams(search);
    for (const [key, value] of hrefParams) {
      if (currentParams.get(key) !== value) return false;
    }
    return true;
  }

  // No query string in href — match only when current URL also has no status/segment param
  if (pathname === href || pathname.startsWith(`${href}/`)) {
    const currentParams = new URLSearchParams(search);
    return !currentParams.has("status") && !currentParams.has("segment");
  }
  return false;
}

function resolvePrimaryTab(pathname: string): PrimaryTabKey {
  if (
    pathname.startsWith("/app/agent") ||
    pathname.startsWith("/app/agents") ||
    pathname.startsWith("/app/chats")
  ) {
    return "chat";
  }
  if (pathname.startsWith("/module/messaging")) return "inbox";
  return "home";
}

function resolveModuleLink(slug: string, locale: Locale): ResolvedLink | null {
  const module = MODULE_BY_SLUG.get(slug);
  if (!module) return null;

  return {
    href: `/module/${module.slug}`,
    iconElement: MODULE_ICONS[module.slug] ?? GridViewIcon,
    label: getModuleLabel(module, locale),
  };
}

function resolveSections(
  locale: Locale,
  role?: MemberRole | null
): ResolvedSection[] {
  const visibleSections = role
    ? SECTIONS.filter((s) => !s.roles || s.roles.includes(role))
    : SECTIONS;

  const resolved = visibleSections.map((section) => {
    const routeLinks = (section.routeLinks ?? []).map((link) => ({
      href: link.href,
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
  for (const hiddenSlug of HOME_TAB_HIDDEN_MODULE_SLUGS) {
    knownSlugs.add(hiddenSlug);
  }
  const extras = MODULES.filter((module) => !knownSlugs.has(module.slug));

  if (extras.length && (!role || role === "owner_admin")) {
    resolved.push({
      key: "other",
      label: locale === "en-US" ? "Other" : "Otros",
      links: extras.map((module) => ({
        href: `/module/${module.slug}`,
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

function ShortcutKbd({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, i) => (
        <span className="inline-flex items-center gap-0.5" key={i}>
          {i > 0 && (
            <span className="text-muted-foreground/60 text-[10px]">then</span>
          )}
          <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border/80 bg-muted/70 px-1 font-mono text-[10px] font-medium text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  );
}

function NavLinkRow({
  active,
  count,
  href,
  icon,
  label,
}: {
  active: boolean;
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
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
      href={href}
    >
      <Icon
        className={cn(
          "shrink-0 transition-colors",
          active
            ? "text-sidebar-primary"
            : "text-sidebar-foreground/50 group-hover/nav:text-sidebar-foreground/75"
        )}
        icon={icon}
        size={16}
      />
      <span className="truncate font-medium text-[14px] leading-5">
        {label}
      </span>
      {count != null && count > 0 && (
        <span className="ml-auto shrink-0 rounded-full bg-sidebar-accent/60 px-1.5 py-px text-[10px] tabular-nums text-sidebar-foreground/50">
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
        <span className="text-[11px] font-medium text-popover-foreground">{label}</span>
        <ShortcutKbd keys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function ShortcutBlock({
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

function normalizeAgentItems(payload: unknown): ChatAgentItem[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object")
    )
    .map((row) => ({
      id: String(row.id ?? ""),
      slug: String(row.slug ?? ""),
      name: String(row.name ?? ""),
    }))
    .filter((row) => row.id && row.slug && row.name);
}

function normalizeChatItems(payload: unknown): ChatSummaryItem[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object")
    )
    .map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? ""),
      is_archived: Boolean(row.is_archived),
      latest_message_preview:
        typeof row.latest_message_preview === "string"
          ? row.latest_message_preview
          : null,
    }))
    .filter((row) => row.id && row.title);
}

function SidebarContent({
  locale,
  orgId,
  onboardingProgress,
  role,
}: SidebarContentProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const activeTab = resolvePrimaryTab(pathname);
  const sections = useMemo(() => resolveSections(locale, role), [locale, role]);
  const [collapsedSections, toggleSection] = useCollapsedSections();
  const [onboardingHubClosed, setOnboardingHubClosed] = useState(false);
  const isEn = locale === "en-US";
  const showOnboardingHub = activeTab === "home" && !onboardingHubClosed;
  const completionPercent = Math.round(
    Math.max(0, Math.min(100, onboardingProgress?.percent ?? 0))
  );
  const onboardingCompleted = completionPercent >= 100;

  const [listingCount, setListingCount] = useState<number | null>(null);
  const [propertiesCount, setPropertiesCount] = useState<number | null>(null);
  const [unitsCount, setUnitsCount] = useState<number | null>(null);

  const [chatAgents, setChatAgents] = useState<ChatAgentItem[]>([]);
  const [recentChats, setRecentChats] = useState<ChatSummaryItem[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatBusyId, setChatBusyId] = useState<string | null>(null);
  const [chatDeleteArmedId, setChatDeleteArmedId] = useState<string | null>(
    null
  );

  const openSearch = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMac = APPLE_DEVICE_REGEX.test(window.navigator.platform);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "k",
      metaKey: isMac,
      ctrlKey: !isMac,
    });
    window.dispatchEvent(event);
  }, []);

  const loadChatData = useCallback(async () => {
    if (!orgId) {
      setChatAgents([]);
      setRecentChats([]);
      setChatError(null);
      return;
    }

    setChatLoading(true);
    setChatError(null);

    try {
      const [agentsResponse, chatsResponse] = await Promise.all([
        fetch(`/api/agent/agents?org_id=${encodeURIComponent(orgId)}`, {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        }),
        fetch(
          `/api/agent/chats?org_id=${encodeURIComponent(orgId)}&archived=${showArchivedChats ? "true" : "false"}&limit=8`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          }
        ),
      ]);

      const agentsPayload = (await agentsResponse.json()) as unknown;
      const chatsPayload = (await chatsResponse.json()) as unknown;

      if (!agentsResponse.ok) {
        const message =
          agentsPayload &&
            typeof agentsPayload === "object" &&
            "error" in agentsPayload
            ? String((agentsPayload as { error?: unknown }).error)
            : isEn
              ? "Could not load agents."
              : "No se pudieron cargar los agentes.";
        throw new Error(message);
      }

      if (!chatsResponse.ok) {
        const message =
          chatsPayload &&
            typeof chatsPayload === "object" &&
            "error" in chatsPayload
            ? String((chatsPayload as { error?: unknown }).error)
            : isEn
              ? "Could not load chats."
              : "No se pudieron cargar los chats.";
        throw new Error(message);
      }

      setChatAgents(normalizeAgentItems(agentsPayload));
      setRecentChats(normalizeChatItems(chatsPayload));
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
      setChatAgents([]);
      setRecentChats([]);
    } finally {
      setChatLoading(false);
    }
  }, [orgId, showArchivedChats, isEn]);

  useEffect(() => {
    if (activeTab !== "chat") return;
    loadChatData().catch(() => undefined);
  }, [activeTab, loadChatData]);

  useEffect(() => {
    if (activeTab !== "home" || !orgId) return;
    let cancelled = false;

    const endpoints = [
      { url: `/api/listings/count?org_id=${encodeURIComponent(orgId)}`, setter: setListingCount },
      { url: `/api/properties/count?org_id=${encodeURIComponent(orgId)}`, setter: setPropertiesCount },
      { url: `/api/units/count?org_id=${encodeURIComponent(orgId)}`, setter: setUnitsCount },
    ];

    for (const { url, setter } of endpoints) {
      fetch(url, { cache: "no-store" })
        .then((res) => res.json() as Promise<{ count?: number | null }>)
        .then((body) => {
          if (!cancelled && typeof body.count === "number") {
            setter(body.count);
          }
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [activeTab, orgId]);

  const sectionsWithCounts = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        links: section.links.map((link) => {
          if (link.href === "/module/listings") return { ...link, count: listingCount };
          if (link.href === "/module/properties") return { ...link, count: propertiesCount };
          if (link.href === "/module/units") return { ...link, count: unitsCount };
          return link;
        }),
      })),
    [sections, listingCount, propertiesCount, unitsCount]
  );

  const mutateRecentChat = useCallback(
    async (chatId: string, action: "archive" | "restore" | "delete") => {
      if (!orgId) return;
      setChatBusyId(chatId);
      setChatError(null);

      try {
        let response: Response;
        if (action === "delete") {
          response = await fetch(
            `/api/agent/chats/${encodeURIComponent(chatId)}?org_id=${encodeURIComponent(orgId)}`,
            {
              method: "DELETE",
              headers: {
                Accept: "application/json",
              },
            }
          );
        } else {
          response = await fetch(
            `/api/agent/chats/${encodeURIComponent(chatId)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                org_id: orgId,
                action,
              }),
            }
          );
        }

        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(
            payload.error ||
            (isEn
              ? "Chat update failed."
              : "La actualización del chat falló.")
          );
        }

        await loadChatData();
        setChatDeleteArmedId(null);
      } catch (err) {
        setChatError(err instanceof Error ? err.message : String(err));
      } finally {
        setChatBusyId(null);
      }
    },
    [isEn, loadChatData, orgId]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <OrgSwitcher activeOrgId={orgId} locale={locale} />
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-1 rounded-xl border border-sidebar-border/60 bg-sidebar-accent/40 p-1">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {PRIMARY_TABS.map((tab) => {
              const active = tab.key === activeTab;
              const shortcutKeys = SHORTCUT_BY_HREF[tab.href];
              const tabLink = (
                <Link
                  className={cn(
                    "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-[12px] transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-foreground"
                      : "text-sidebar-foreground/55 hover:text-sidebar-foreground"
                  )}
                  href={tab.href}
                >
                  <Icon icon={tab.icon} size={14} />
                  <span className="truncate">{tab.label[locale]}</span>
                </Link>
              );
              return shortcutKeys ? (
                <Tooltip key={tab.key}>
                  <TooltipTrigger asChild>{tabLink}</TooltipTrigger>
                  <TooltipContent
                    className="flex items-center gap-2.5 px-2.5 py-1.5"
                    side="bottom"
                    sideOffset={8}
                  >
                    <span className="text-[11px] font-medium text-popover-foreground">
                      {tab.label[locale]}
                    </span>
                    <ShortcutKbd keys={shortcutKeys} />
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span key={tab.key}>{tabLink}</span>
              );
            })}
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={isEn ? "Search" : "Buscar"}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  onClick={openSearch}
                  type="button"
                >
                  <Icon icon={Search01Icon} size={15} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                className="flex items-center gap-2.5 px-2.5 py-1.5"
                side="bottom"
                sideOffset={8}
              >
                <span className="text-[11px] font-medium text-popover-foreground">
                  {isEn ? "Search" : "Buscar"}
                </span>
                <ShortcutKbd keys={["⌘", "K"]} />
              </TooltipContent>
            </Tooltip>
            <NotificationBell locale={locale} />
          </div>
        </div>
      </div>

      <div className="sidebar-scroll-mask flex-1 space-y-3 overflow-y-auto px-3 py-1.5">
        {activeTab === "chat" ? (
          <div className="space-y-3">
            <ShortcutBlock
              label={{ "es-PY": "Agentes", "en-US": "Agents" }}
              links={CHAT_LINKS}
              locale={locale}
              pathname={pathname}
              search={search}
            />

            <section className="space-y-1.5">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-medium text-[10px] text-sidebar-foreground/40 uppercase tracking-[0.08em]">
                  {isEn ? "Agent catalog" : "Catálogo de agentes"}
                </h3>
                <Link
                  className="text-[11px] text-sidebar-foreground/55 hover:text-sidebar-foreground"
                  href="/app/agents"
                >
                  {isEn ? "Open" : "Abrir"}
                </Link>
              </div>
              <div className="space-y-0.5">
                {chatAgents.slice(0, 6).map((agent) => (
                  <NavLinkRow
                    active={pathname.startsWith("/app/agents")}
                    href={`/app/agents?agent=${encodeURIComponent(agent.slug)}`}
                    icon={SparklesIcon}
                    key={agent.id}
                    label={agent.name}
                  />
                ))}
                {!chatLoading && chatAgents.length === 0 ? (
                  <p className="px-2 py-1.5 text-[12px] text-sidebar-foreground/50">
                    {isEn
                      ? "No agents available."
                      : "No hay agentes disponibles."}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="space-y-1.5">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-medium text-[10px] text-sidebar-foreground/40 uppercase tracking-[0.08em]">
                  {isEn ? "Recent chats" : "Chats recientes"}
                </h3>
                <button
                  className="text-[11px] text-sidebar-foreground/55 hover:text-sidebar-foreground"
                  onClick={() => {
                    setShowArchivedChats((value) => !value);
                    setChatDeleteArmedId(null);
                  }}
                  type="button"
                >
                  {showArchivedChats
                    ? isEn
                      ? "Active"
                      : "Activos"
                    : isEn
                      ? "Archived"
                      : "Archivados"}
                </button>
              </div>

              {chatError ? (
                <p className="px-2 py-1 text-[11px] text-red-400">
                  {chatError}
                </p>
              ) : null}

              <div className="space-y-0.5">
                {recentChats.map((chat) => (
                  <div
                    className={cn(
                      "group flex items-center gap-1 rounded-lg px-2 py-[5px] transition-all duration-200 ease-in-out",
                      isRouteActive(pathname, search, `/app/chats/${chat.id}`)
                        ? "bg-sidebar-accent"
                        : "hover:bg-sidebar-accent/50"
                    )}
                    key={chat.id}
                  >
                    <Link
                      className="min-w-0 flex-1 text-[12px] text-sidebar-foreground/90"
                      href={`/app/chats/${encodeURIComponent(chat.id)}`}
                    >
                      <div className="truncate font-medium">{chat.title}</div>
                      <div className="truncate text-[11px] text-sidebar-foreground/50">
                        {chat.latest_message_preview ||
                          (isEn
                            ? "No messages yet."
                            : "Todavía no hay mensajes.")}
                      </div>
                    </Link>

                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="rounded px-1.5 py-1 text-[10px] text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        disabled={chatBusyId !== null}
                        onClick={() => {
                          const action = chat.is_archived
                            ? "restore"
                            : "archive";
                          mutateRecentChat(chat.id, action).catch(
                            () => undefined
                          );
                        }}
                        type="button"
                      >
                        {chat.is_archived
                          ? isEn
                            ? "Restore"
                            : "Rest."
                          : isEn
                            ? "Archive"
                            : "Arch."}
                      </button>
                      <button
                        className="rounded px-1.5 py-1 text-[10px] text-red-400/85 hover:bg-red-500/10 hover:text-red-400"
                        disabled={chatBusyId !== null}
                        onClick={() => {
                          if (chatDeleteArmedId !== chat.id) {
                            setChatDeleteArmedId(chat.id);
                            return;
                          }
                          mutateRecentChat(chat.id, "delete").catch(
                            () => undefined
                          );
                          setChatDeleteArmedId(null);
                        }}
                        type="button"
                      >
                        {chatDeleteArmedId === chat.id
                          ? isEn
                            ? "Confirm"
                            : "Confirmar"
                          : isEn
                            ? "Delete"
                            : "Eliminar"}
                      </button>
                    </div>
                  </div>
                ))}

                {!chatLoading && recentChats.length === 0 ? (
                  <p className="px-2 py-1.5 text-[12px] text-sidebar-foreground/50">
                    {showArchivedChats
                      ? isEn
                        ? "No archived chats."
                        : "No hay chats archivados."
                      : isEn
                        ? "No recent chats."
                        : "No hay chats recientes."}
                  </p>
                ) : null}
              </div>

              <Link
                className="inline-flex w-full items-center justify-center rounded-lg border border-sidebar-border/50 px-2 py-1.5 text-[12px] text-sidebar-foreground/60 hover:text-sidebar-foreground"
                href={
                  showArchivedChats ? "/app/chats?archived=1" : "/app/chats"
                }
              >
                {isEn ? "Open full history" : "Abrir historial completo"}
              </Link>
            </section>
          </div>
        ) : null}

        {activeTab === "inbox" ? (
          <div className="space-y-4">
            <ShortcutBlock
              label={{ "es-PY": "Estado", "en-US": "Status" }}
              links={INBOX_STATUS_LINKS}
              locale={locale}
              pathname={pathname}
              search={search}
            />
            <ShortcutBlock
              label={{ "es-PY": "Segmentos guardados", "en-US": "Saved Segments" }}
              links={INBOX_SEGMENT_LINKS}
              locale={locale}
              pathname={pathname}
              search={search}
            />
          </div>
        ) : null}

        {activeTab === "home" ? (
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
                  className="mt-2.5 h-2 bg-sidebar-accent"
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
        ) : null}
      </div>

      <div className="shrink-0 space-y-2 p-3 pt-0">
        <Link
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-sidebar-border/60 bg-sidebar-accent/50 px-3 font-medium text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
          href="/app/agents?new=1"
        >
          <Icon icon={AiVoiceGeneratorIcon} size={14} />
          {isEn ? "New chat" : "Nuevo chat"}
        </Link>
        <SidebarAccount collapsed={false} locale={locale} />
      </div>
    </div>
  );
}

type SidebarContentProps = {
  locale: Locale;
  orgId: string | null;
  onboardingProgress?: OnboardingProgress;
  role?: MemberRole | null;
};

// ... existing code ...

export function SidebarNew({
  locale,
  orgId,
  onboardingProgress,
  role,
  viewportMode,
  isMobileDrawerOpen,
  onMobileDrawerOpenChange,
}: {
  locale: Locale;
  orgId: string | null;
  onboardingProgress?: OnboardingProgress;
  role?: MemberRole | null;
  viewportMode: ViewportMode;
  isMobileDrawerOpen: boolean;
  onMobileDrawerOpenChange: (next: boolean) => void;
}) {
  const isDesktop = viewportMode === "desktop";

  if (isDesktop) {
    return (
      <aside className="h-full w-full min-w-0 shrink-0 border-border/60 border-r bg-sidebar text-sidebar-foreground">
        <SidebarContent
          locale={locale}
          orgId={orgId}
          onboardingProgress={onboardingProgress}
          role={role}
        />
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
      <div className="h-full bg-sidebar text-sidebar-foreground">
        <SidebarContent
          locale={locale}
          orgId={orgId}
          onboardingProgress={onboardingProgress}
          role={role}
        />
      </div>
    </Drawer>
  );
}
