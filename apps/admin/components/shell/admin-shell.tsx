"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { AppFooter } from "@/components/shell/app-footer";
import { CommandPalette } from "@/components/shell/command-palette";
import { ShortcutsHelp } from "@/components/shell/shortcuts-help";
import type { MemberRole, ViewportMode } from "@/components/shell/sidebar-new";
import { SidebarNew } from "@/components/shell/sidebar-new";
import { Topbar } from "@/components/shell/topbar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGlobalHotkeys } from "@/lib/hotkeys/use-global-hotkeys";
import { useNavigationHotkeys } from "@/lib/hotkeys/use-navigation-hotkeys";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const DesktopResizableShell = dynamic(
  () =>
    import("@/components/shell/desktop-resizable-shell").then(
      (m) => m.DesktopResizableShell
    ),
  { ssr: false }
);

type AdminShellProps = {
  orgId: string | null;
  locale: Locale;
  role?: MemberRole | null;
  onboardingProgress: {
    completedSteps: number;
    totalSteps: number;
    percent: number;
  };
  children: ReactNode;
};

const BRAND_V1_ENABLED = process.env.NEXT_PUBLIC_BRAND_V1 !== "0";

const DESKTOP_QUERY = "(min-width: 1280px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1279px)";
const SHEET_LOCK_COUNT_ATTR = "data-pa-scroll-lock-count";
const SHEET_LOCK_PREV_OVERFLOW_ATTR = "data-pa-scroll-lock-prev-overflow";

function hasOpenModalDialog(): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>(
    "[role='dialog'][aria-modal='true']"
  );

  for (const dialog of dialogs) {
    if (dialog.hasAttribute("data-closed")) continue;
    if (dialog.getAttribute("aria-hidden") === "true") continue;

    const style = window.getComputedStyle(dialog);
    if (style.display === "none" || style.visibility === "hidden") continue;

    return true;
  }

  return false;
}

function clearStalePageScrollLock(): void {
  const body = document.body;
  const html = document.documentElement;
  const lockCount = Number.parseInt(
    body.getAttribute(SHEET_LOCK_COUNT_ATTR) ?? "0",
    10
  );
  if (lockCount > 0 || hasOpenModalDialog()) {
    return;
  }

  if (body.style.overflow === "hidden") {
    body.style.removeProperty("overflow");
  }
  if (html.style.overflow === "hidden") {
    html.style.removeProperty("overflow");
  }
  body.removeAttribute(SHEET_LOCK_COUNT_ATTR);
  body.removeAttribute(SHEET_LOCK_PREV_OVERFLOW_ATTR);
}

function getViewportMode(): ViewportMode {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "mobile";
}

function useShellHotkeys(locale: Locale) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const { gPressed } = useNavigationHotkeys();

  useGlobalHotkeys({
    onCommandPalette: useCallback(() => setCmdPaletteOpen((prev) => !prev), []),
    onShowHelp: useCallback(() => setHelpOpen((prev) => !prev), []),
    onEscape: useCallback(() => undefined, []),
  });

  // Listen for topbar button event
  useEffect(() => {
    const handler = () => setHelpOpen((prev) => !prev);
    window.addEventListener("pa:show-shortcuts-help", handler);
    return () => window.removeEventListener("pa:show-shortcuts-help", handler);
  }, []);

  const overlays = (
    <>
      <ShortcutsHelp
        locale={locale}
        onOpenChange={setHelpOpen}
        open={helpOpen}
      />
      <CommandPalette
        onOpenChange={setCmdPaletteOpen}
        open={cmdPaletteOpen}
        showTrigger={false}
      />
      {gPressed && (
        <div className="fade-in pointer-events-none fixed bottom-4 left-4 z-50 animate-in rounded-lg border border-border/80 bg-popover/95 px-3 py-1.5 font-mono text-foreground text-sm shadow-lg backdrop-blur">
          G…
        </div>
      )}
    </>
  );

  return { overlays };
}

function AdminShellV2({
  orgId,
  locale,
  role,
  onboardingProgress,
  children,
}: AdminShellProps) {
  const pathname = usePathname();
  const [viewportMode, setViewportMode] = useState<ViewportMode>(() =>
    getViewportMode()
  );
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const { overlays } = useShellHotkeys(locale);

  useEffect(() => {
    const desktopMedia = window.matchMedia(DESKTOP_QUERY);
    const tabletMedia = window.matchMedia(TABLET_QUERY);

    const sync = () => setViewportMode(getViewportMode());

    desktopMedia.addEventListener("change", sync);
    tabletMedia.addEventListener("change", sync);

    return () => {
      desktopMedia.removeEventListener("change", sync);
      tabletMedia.removeEventListener("change", sync);
    };
  }, []);

  // Close the mobile drawer whenever we enter desktop viewport.
  // Derived inline: if viewport is desktop, the drawer is never open.
  const effectiveIsMobileDrawerOpen =
    viewportMode === "desktop" ? false : isMobileDrawerOpen;

  useEffect(() => {
    if (!pathname) return;
    const lockResetDelayMs =
      viewportMode === "desktop" && !effectiveIsMobileDrawerOpen ? 120 : 220;

    clearStalePageScrollLock();
    const handle = window.setTimeout(
      clearStalePageScrollLock,
      lockResetDelayMs
    );
    return () => window.clearTimeout(handle);
  }, [effectiveIsMobileDrawerOpen, pathname, viewportMode]);

  const isDesktop = viewportMode === "desktop";
  const showNavToggle = true;
  const isNavOpen = isDesktop ? !sidebarCollapsed : effectiveIsMobileDrawerOpen;

  const onNavToggle = () => {
    if (isDesktop) {
      const panel = sidebarPanelRef.current;
      if (panel) {
        if (sidebarCollapsed) {
          panel.expand();
        } else {
          panel.collapse();
        }
      }
    } else {
      setIsMobileDrawerOpen((open) => !open);
    }
  };

  const searchParams = useSearchParams();
  const isPreviewMode = searchParams.get("preview") === "1";

  const shellSurfaceClass = BRAND_V1_ENABLED
    ? "bg-[var(--shell-surface)]"
    : "bg-background";

  if (isPreviewMode) {
    return (
      <div className={cn("h-full w-full overflow-auto", shellSurfaceClass)}>
        <div className="mx-auto w-full max-w-screen-2xl p-3 sm:p-4 lg:p-5 xl:p-7">
          {children}
        </div>
      </div>
    );
  }

  const contentColumn = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <Topbar
        isNavOpen={isNavOpen}
        locale={locale}
        onNavToggle={onNavToggle}
        showNavToggle={showNavToggle}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScrollArea className="flex-1">
          <div className="mx-auto w-full max-w-screen-2xl p-3 sm:p-4 lg:p-5 xl:p-7">
            {children}
          </div>
        </ScrollArea>
      </main>
      <AppFooter locale={locale} />
    </div>
  );

  if (isDesktop) {
    return (
      <DesktopResizableShell
        contentColumn={contentColumn}
        locale={locale}
        onboardingProgress={onboardingProgress}
        onMobileDrawerOpenChange={setIsMobileDrawerOpen}
        onSidebarCollapsedChange={setSidebarCollapsed}
        orgId={orgId}
        overlays={overlays}
        role={role}
        sidebarCollapsed={sidebarCollapsed}
        sidebarPanelRef={sidebarPanelRef}
        viewportMode={viewportMode}
      />
    );
  }

  return (
    <div
      className={cn(
        "grid h-full min-h-0 w-full grid-cols-[minmax(0,1fr)] overflow-hidden transition-all duration-300 ease-in-out",
        shellSurfaceClass
      )}
      data-nav-open={isNavOpen}
      data-shell-mode={viewportMode}
    >
      <SidebarNew
        isMobileDrawerOpen={effectiveIsMobileDrawerOpen}
        locale={locale}
        onboardingProgress={onboardingProgress}
        onMobileDrawerOpenChange={setIsMobileDrawerOpen}
        orgId={orgId}
        role={role}
        viewportMode={viewportMode}
      />
      {contentColumn}
      {overlays}
    </div>
  );
}

export function AdminShell({
  orgId,
  locale,
  role,
  onboardingProgress,
  children,
}: AdminShellProps) {
  return (
    <Suspense fallback={null}>
      <AdminShellV2
        locale={locale}
        onboardingProgress={onboardingProgress}
        orgId={orgId}
        role={role}
      >
        {children}
      </AdminShellV2>
    </Suspense>
  );
}
