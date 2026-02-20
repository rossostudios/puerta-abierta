"use client";

import { AiVoiceGeneratorIcon, Search01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback } from "react";
import { NotificationBell } from "@/components/shell/notification-bell";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { SidebarAccount } from "@/components/shell/sidebar-account";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SHORTCUT_BY_HREF } from "@/lib/hotkeys/config";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SidebarChatTab } from "./sidebar-chat-tab";
import { APPLE_DEVICE_REGEX, PRIMARY_TABS } from "./sidebar-constants";
import { SidebarHomeTab } from "./sidebar-home-tab";
import { SidebarInboxTab } from "./sidebar-inbox-tab";
import { ShortcutKbd } from "./sidebar-nav-link";
import type {
  MemberRole,
  OnboardingProgress,
  SidebarContentProps,
  ViewportMode,
} from "./sidebar-types";
import { resolvePrimaryTab } from "./sidebar-utils";

export type { MemberRole, ViewportMode } from "./sidebar-types";

function SidebarContent({
  locale,
  orgId,
  onboardingProgress,
  role,
}: SidebarContentProps) {
  const pathname = usePathname();
  const activeTab = resolvePrimaryTab(pathname);
  const isEn = locale === "en-US";

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <OrgSwitcher activeOrgId={orgId} locale={locale} />
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-1 rounded-xl bg-sidebar-accent/20 p-1">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {PRIMARY_TABS.map((tab) => {
              const active = tab.key === activeTab;
              const shortcutKeys = SHORTCUT_BY_HREF[tab.href];
              const tabLink = (
                <Link
                  className={cn(
                    "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-[12px] transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  )}
                  href={tab.href}
                  key={tab.key}
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
                    <span className="font-medium text-[11px] text-popover-foreground">
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
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
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
                <span className="font-medium text-[11px] text-popover-foreground">
                  {isEn ? "Search" : "Buscar"}
                </span>
                <ShortcutKbd keys={["⌘", "K"]} />
              </TooltipContent>
            </Tooltip>
            <NotificationBell locale={locale} orgId={orgId} />
          </div>
        </div>
      </div>

      <div className="sidebar-scroll-mask flex-1 space-y-3 overflow-y-auto px-3 py-1.5">
        {activeTab === "chat" ? (
          <SidebarChatTab locale={locale} orgId={orgId} />
        ) : null}

        {activeTab === "inbox" ? <SidebarInboxTab locale={locale} /> : null}

        {activeTab === "home" ? (
          <SidebarHomeTab
            locale={locale}
            onboardingProgress={onboardingProgress}
            orgId={orgId}
            role={role}
          />
        ) : null}
      </div>

      <div className="shrink-0 space-y-2 p-3 pt-0">
        <Link
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-sidebar-primary px-3 font-medium text-[13px] text-sidebar-primary-foreground shadow-[0_1px_3px_rgba(255,93,70,0.25)] transition-all hover:shadow-[0_2px_8px_rgba(255,93,70,0.3)] hover:brightness-110"
          href="/app/agents?new=1"
        >
          <Icon icon={AiVoiceGeneratorIcon} size={14} />
          {isEn ? "New chat" : "Nuevo chat"}
        </Link>
        <SidebarAccount collapsed={false} locale={locale} orgId={orgId} />
      </div>
    </div>
  );
}

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
      <aside className="h-full w-full min-w-0 shrink-0 bg-sidebar text-sidebar-foreground">
        <Suspense fallback={null}>
          <SidebarContent
            locale={locale}
            onboardingProgress={onboardingProgress}
            orgId={orgId}
            role={role}
          />
        </Suspense>
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
        <Suspense fallback={null}>
          <SidebarContent
            locale={locale}
            onboardingProgress={onboardingProgress}
            orgId={orgId}
            role={role}
          />
        </Suspense>
      </div>
    </Drawer>
  );
}
