"use client";

import {
  AiVoiceGeneratorIcon,
  AuditIcon,
  Building01Icon,
  Calendar02Icon,
  CalendarCheckIn01Icon,
  Cancel01Icon,
  ChartIcon,
  CreditCardIcon,
  Door01Icon,
  File01Icon,
  FolderAttachmentIcon,
  GridViewIcon,
  Home01Icon,
  InboxIcon,
  Invoice01Icon,
  Link01Icon,
  Message01Icon,
  Search01Icon,
  Settings03Icon,
  SparklesIcon,
  Task01Icon,
  UserGroupIcon,
  WebhookIcon,
  WorkflowSquare03Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Separator } from "@base-ui/react/separator";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  calendar: Calendar02Icon,
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
  | "leasing"
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

const INBOX_LINKS: RouteLinkDef[] = [
  {
    href: "/module/applications",
    icon: UserGroupIcon,
    label: { "es-PY": "Aplicaciones", "en-US": "Applications" },
  },
  {
    href: "/module/collections",
    icon: Invoice01Icon,
    label: { "es-PY": "Cobranzas", "en-US": "Collections" },
  },
  {
    href: "/module/tasks?mine=1",
    icon: Task01Icon,
    label: { "es-PY": "Cola personal", "en-US": "My queue" },
  },
];

const SECTIONS: SectionDef[] = [
  {
    key: "leasing",
    label: {
      "es-PY": "Leasing",
      "en-US": "Leasing",
    },
    moduleSlugs: ["listings", "leases"],
    roles: ["owner_admin", "operator"],
  },
  {
    key: "operations",
    label: {
      "es-PY": "Operaciones",
      "en-US": "Operations",
    },
    moduleSlugs: ["tasks", "reservations", "guests"],
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

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
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
  href,
  icon,
  label,
}: {
  active: boolean;
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
          ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-border/40"
          : "text-sidebar-foreground hover:bg-muted/60 hover:text-foreground"
      )}
      href={href}
    >
      <Icon
        className={cn(
          "shrink-0 transition-colors",
          active
            ? "text-primary"
            : "text-sidebar-foreground/60 group-hover/nav:text-foreground/80"
        )}
        icon={icon}
        size={16}
      />
      <span className="truncate font-medium text-[14px] leading-5">
        {label}
      </span>
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
}: {
  label: { "es-PY": string; "en-US": string };
  links: RouteLinkDef[];
  locale: Locale;
  pathname: string;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="px-2 font-medium text-[10px] text-muted-foreground/55 uppercase tracking-[0.08em]">
        {label[locale]}
      </h3>
      <div className="space-y-0.5">
        {links.map((link) => (
          <NavLinkRow
            active={isRouteActive(pathname, link.href)}
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
        <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-background/70 p-1">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {PRIMARY_TABS.map((tab) => {
              const active = tab.key === activeTab;
              const shortcutKeys = SHORTCUT_BY_HREF[tab.href];
              const tabLink = (
                <Link
                  className={cn(
                    "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-[12px] transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground/75 hover:text-foreground"
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
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
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
            />

            <section className="space-y-1.5">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-medium text-[10px] text-muted-foreground/55 uppercase tracking-[0.08em]">
                  {isEn ? "Agent catalog" : "Catálogo de agentes"}
                </h3>
                <Link
                  className="text-[11px] text-muted-foreground/80 hover:text-foreground"
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
                  <p className="px-2 py-1.5 text-[12px] text-muted-foreground/70">
                    {isEn
                      ? "No agents available."
                      : "No hay agentes disponibles."}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="space-y-1.5">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-medium text-[10px] text-muted-foreground/55 uppercase tracking-[0.08em]">
                  {isEn ? "Recent chats" : "Chats recientes"}
                </h3>
                <button
                  className="text-[11px] text-muted-foreground/80 hover:text-foreground"
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
                <p className="px-2 py-1 text-[11px] text-destructive">
                  {chatError}
                </p>
              ) : null}

              <div className="space-y-0.5">
                {recentChats.map((chat) => (
                  <div
                    className={cn(
                      "group flex items-center gap-1 rounded-lg px-2 py-[5px] transition-all duration-200 ease-in-out",
                      isRouteActive(pathname, `/app/chats/${chat.id}`)
                        ? "bg-background ring-1 ring-border/40"
                        : "hover:bg-muted/60"
                    )}
                    key={chat.id}
                  >
                    <Link
                      className="min-w-0 flex-1 text-[12px] text-foreground/90"
                      href={`/app/chats/${encodeURIComponent(chat.id)}`}
                    >
                      <div className="truncate font-medium">{chat.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground/75">
                        {chat.latest_message_preview ||
                          (isEn
                            ? "No messages yet."
                            : "Todavía no hay mensajes.")}
                      </div>
                    </Link>

                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
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
                        className="rounded px-1.5 py-1 text-[10px] text-destructive/85 hover:bg-destructive/10 hover:text-destructive"
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
                  <p className="px-2 py-1.5 text-[12px] text-muted-foreground/70">
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
                className="inline-flex w-full items-center justify-center rounded-lg border border-border/60 px-2 py-1.5 text-[12px] text-muted-foreground/85 hover:text-foreground"
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
          <ShortcutBlock
            label={{ "es-PY": "Bandejas", "en-US": "Inbox" }}
            links={INBOX_LINKS}
            locale={locale}
            pathname={pathname}
          />
        ) : null}

        {activeTab === "home" ? (
          <nav className="space-y-3">
            {showOnboardingHub && !onboardingCompleted ? (
              <Link
                className="group block rounded-xl border border-border/70 bg-background/80 p-3 transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
                href="/setup"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon
                      className="text-primary/70"
                      icon={Settings03Icon}
                      size={15}
                    />
                    <span className="truncate font-semibold text-[13px] text-foreground">
                      {isEn ? "Setup" : "Configuración"}
                    </span>
                  </div>
                  <button
                    aria-label={
                      isEn
                        ? "Dismiss setup widget"
                        : "Cerrar widget de configuración"
                    }
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
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
                  className="mt-2.5 h-2 bg-muted/90"
                  value={completionPercent}
                />
                <p className="mt-1.5 font-medium text-[12px] text-muted-foreground">
                  {isEn
                    ? `${completionPercent}% complete`
                    : `${completionPercent}% completado`}
                </p>
              </Link>
            ) : null}

            {sections.map((section, index) => {
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
                        {section.links.map((link) => (
                          <NavLinkRow
                            active={isRouteActive(pathname, link.href)}
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
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 font-medium text-[13px] text-foreground transition-colors hover:bg-muted"
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
