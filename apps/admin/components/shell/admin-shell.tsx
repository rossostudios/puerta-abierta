"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ViewportMode } from "@/components/shell/sidebar-new";
import { SidebarNew } from "@/components/shell/sidebar-new";
import { SidebarV1 } from "@/components/shell/sidebar-v1";
import { Topbar } from "@/components/shell/topbar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminShellProps = {
  orgId: string | null;
  locale: Locale;
  onboardingProgress: {
    completedSteps: number;
    totalSteps: number;
    percent: number;
  };
  children: ReactNode;
};

const SHELL_V2_ENABLED = process.env.NEXT_PUBLIC_SHELL_V2 !== "0";
const BRAND_V1_ENABLED = process.env.NEXT_PUBLIC_BRAND_V1 !== "0";

const STORAGE_KEY = "pa-sidebar-collapsed";
const DESKTOP_QUERY = "(min-width: 1280px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1279px)";
const LEGACY_AUTO_COLLAPSE_BREAKPOINT = 1360;

function getViewportMode(): ViewportMode {
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "mobile";
}

function LegacyAdminShell({ locale, children }: AdminShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const query = `(max-width: ${LEGACY_AUTO_COLLAPSE_BREAKPOINT}px)`;
    const media = window.matchMedia(query);

    const readStored = (): string | null => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    };

    const syncFromEnvironment = () => {
      if (media.matches) {
        setCollapsed(true);
        return;
      }

      const stored = readStored();
      if (stored === "true") setCollapsed(true);
      if (stored === "false") setCollapsed(false);
    };

    try {
      syncFromEnvironment();
    } catch {
      // Ignore storage failures (private mode / blocked).
    }

    const onChange = () => syncFromEnvironment();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setAndPersist = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures.
    }
  }, []);

  return (
    <div
      className={cn(
        "flex h-full",
        BRAND_V1_ENABLED ? "bg-[var(--shell-surface)]" : "bg-background"
      )}
    >
      <SidebarV1
        collapsed={collapsed}
        locale={locale}
        onCollapsedChange={setAndPersist}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar locale={locale} />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-4 lg:p-5 xl:p-6">
          <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function AdminShellV2({
  orgId,
  locale,
  onboardingProgress,
  children,
}: AdminShellProps) {
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  useEffect(() => {
    const desktopMedia = window.matchMedia(DESKTOP_QUERY);
    const tabletMedia = window.matchMedia(TABLET_QUERY);

    const sync = () => setViewportMode(getViewportMode());

    sync();

    desktopMedia.addEventListener("change", sync);
    tabletMedia.addEventListener("change", sync);

    return () => {
      desktopMedia.removeEventListener("change", sync);
      tabletMedia.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (viewportMode === "desktop") {
      setIsMobileDrawerOpen(false);
      return;
    }
  }, [viewportMode]);

  const showNavToggle = viewportMode !== "desktop";
  const isNavOpen = isMobileDrawerOpen;
  const isDesktop = viewportMode === "desktop";

  const onNavToggle = () => {
    setIsMobileDrawerOpen((open) => !open);
  };

  const shellSurfaceClass = BRAND_V1_ENABLED
    ? "bg-[var(--shell-surface)]"
    : "bg-background";

  const contentColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Topbar
        isNavOpen={isNavOpen}
        locale={locale}
        onNavToggle={onNavToggle}
        showNavToggle={showNavToggle}
      />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-5 xl:p-7">
        <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
      </main>
    </div>
  );

  if (isDesktop) {
    return (
      <div
        className={cn(
          "h-full min-h-0 w-full overflow-hidden",
          shellSurfaceClass
        )}
        data-nav-open={false}
        data-shell-mode={viewportMode}
      >
        <ResizablePanelGroup
          className="h-full min-h-0 w-full"
          orientation="horizontal"
        >
          <ResizablePanel defaultSize="20%" maxSize="40%" minSize="14%">
            <SidebarNew
              isMobileDrawerOpen={false}
              locale={locale}
              onboardingProgress={onboardingProgress}
              onMobileDrawerOpenChange={setIsMobileDrawerOpen}
              orgId={orgId}
              viewportMode={viewportMode}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize="50%">{contentColumn}</ResizablePanel>
        </ResizablePanelGroup>
      </div>
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
        isMobileDrawerOpen={isMobileDrawerOpen}
        locale={locale}
        onboardingProgress={onboardingProgress}
        onMobileDrawerOpenChange={setIsMobileDrawerOpen}
        orgId={orgId}
        viewportMode={viewportMode}
      />
      {contentColumn}
    </div>
  );
}

export function AdminShell({
  orgId,
  locale,
  onboardingProgress,
  children,
}: AdminShellProps) {
  if (!SHELL_V2_ENABLED) {
    return (
      <LegacyAdminShell
        locale={locale}
        onboardingProgress={onboardingProgress}
        orgId={orgId}
      >
        {children}
      </LegacyAdminShell>
    );
  }

  return (
    <AdminShellV2
      locale={locale}
      onboardingProgress={onboardingProgress}
      orgId={orgId}
    >
      {children}
    </AdminShellV2>
  );
}
