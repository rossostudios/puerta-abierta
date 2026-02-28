"use client";

import { AiVoiceGeneratorIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
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
import { SidebarQuickCreate } from "./sidebar-quick-create";
import type {
  MemberRole,
  OnboardingProgress,
  SidebarContentProps,
  ViewportMode,
} from "./sidebar-types";
import { resolvePrimaryTab } from "./sidebar-utils";

export type { MemberRole, ViewportMode } from "./sidebar-types";

const EASING = [0.22, 1, 0.36, 1] as const;

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
    // Relying on setCmdPaletteOpen directly via the parent or context could be cleaner,
    // but the global keydown event from useGlobalHotkeys already handles this.
    // If we want to open it via mouse click here, we simulate it via the global event
    // or trigger a custom event.
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
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center px-4">
          <OrgSwitcher activeOrgId={orgId} locale={locale} />
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center gap-1 rounded-xl bg-white/35 p-1 ring-1 ring-white/40 ring-inset dark:bg-mauve-400/8 dark:ring-mauve-400/8">
            <div className="flex min-w-0 flex-1 items-center gap-0.5">
              {PRIMARY_TABS.map((tab) => {
                const active = tab.key === activeTab;
                const shortcutKeys = SHORTCUT_BY_HREF[tab.href];
                const tabLink = (
                  <Link
                    className={cn(
                      "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-[12px] transition-all duration-200",
                      active
                        ? "bg-white/60 text-sidebar-primary shadow-sm ring-1 ring-white/50 ring-inset dark:bg-mauve-400/12 dark:ring-mauve-300/10"
                        : "text-sidebar-foreground/75 hover:bg-white/30 hover:text-sidebar-foreground dark:hover:bg-mauve-400/8"
                    )}
                    href={tab.href}
                    key={tab.key}
                  >
                    <Icon icon={tab.icon} size={14} />
                    <AnimatePresence initial={false}>
                      {active && (
                        <motion.span
                          animate={{ opacity: 1, width: "auto" }}
                          className="overflow-hidden truncate"
                          exit={{ opacity: 0, width: 0 }}
                          initial={{ opacity: 0, width: 0 }}
                          key={tab.key}
                          transition={{ duration: 0.15, ease: EASING }}
                        >
                          {tab.label[locale]}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Link>
                );
                return (
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
                      {shortcutKeys && <ShortcutKbd keys={shortcutKeys} />}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>

            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={isEn ? "Search" : "Buscar"}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-white/30 hover:text-sidebar-foreground dark:hover:bg-mauve-400/8"
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

        <div className="sidebar-scroll-mask flex-1 overflow-y-auto px-3 py-1.5">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: 4 }}
              key={activeTab}
              transition={{ duration: 0.15, ease: EASING }}
            >
              {activeTab === "chat" ? (
                <SidebarChatTab locale={locale} orgId={orgId} role={role} />
              ) : null}

              {activeTab === "inbox" ? (
                <SidebarInboxTab locale={locale} />
              ) : null}

              {activeTab === "home" ? (
                <SidebarHomeTab
                  locale={locale}
                  onboardingProgress={onboardingProgress}
                  orgId={orgId}
                  role={role}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="shrink-0 space-y-2 p-3 pt-0">
          <div className="flex items-center gap-1.5">
            <Link
              className="glass-inner group inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 font-medium text-[13px] text-sidebar-foreground/80 transition-all duration-300 hover:bg-white/70 hover:text-sidebar-foreground hover:shadow-sm dark:hover:bg-white/10"
              href="/app/agents?new=1"
            >
              <Icon
                className="text-sidebar-primary transition-transform duration-300 group-hover:scale-110"
                icon={AiVoiceGeneratorIcon}
                size={14}
              />
              {isEn ? "Ask Casaora AI" : "Pregunta a Casaora AI"}
            </Link>
            <SidebarQuickCreate locale={locale} />
          </div>
          <SidebarAccount collapsed={false} locale={locale} orgId={orgId} />
        </div>
      </div>
    </MotionConfig>
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
      <aside className="glass-sidebar h-full w-full min-w-0 shrink-0 text-sidebar-foreground">
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
      <div className="h-full text-sidebar-foreground">
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
