"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Sidebar, type ViewportMode } from "@/components/shell/sidebar";
import { SidebarV1 } from "@/components/shell/sidebar-v1";
import { Topbar } from "@/components/shell/topbar";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminShellProps = {
  orgId: string | null;
  locale: Locale;
  children: ReactNode;
};

const SHELL_V2_ENABLED = process.env.NEXT_PUBLIC_SHELL_V2 !== "0";

const STORAGE_KEY = "pa-sidebar-collapsed";
const DESKTOP_QUERY = "(min-width: 1280px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1279px)";
const LEGACY_AUTO_COLLAPSE_BREAKPOINT = 1360;

function getViewportMode(): ViewportMode {
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "mobile";
}

function LegacyAdminShell({ orgId, locale, children }: AdminShellProps) {
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
    <div className="flex h-full bg-[color-mix(in_oklch,var(--sidebar)_72%,var(--background))]">
      <SidebarV1
        collapsed={collapsed}
        locale={locale}
        onCollapsedChange={setAndPersist}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar locale={locale} orgId={orgId} />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-4 lg:p-5 xl:p-6">
          <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function AdminShellV2({ orgId, locale, children }: AdminShellProps) {
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [desktopPanelCollapsed, setDesktopPanelCollapsed] = useState(false);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);
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
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setDesktopPanelCollapsed(true);
      if (stored === "false") setDesktopPanelCollapsed(false);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    if (viewportMode === "desktop") {
      setIsContextPanelOpen(false);
      setIsMobileDrawerOpen(false);
      return;
    }

    if (viewportMode === "tablet") {
      setIsMobileDrawerOpen(false);
      return;
    }

    setIsContextPanelOpen(false);
  }, [viewportMode]);

  const setDesktopCollapsedAndPersist = useCallback((next: boolean) => {
    setDesktopPanelCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const shellColumns = useMemo(() => {
    if (viewportMode === "desktop") {
      return desktopPanelCollapsed
        ? "grid-cols-[88px_minmax(0,1fr)]"
        : "grid-cols-[88px_304px_minmax(0,1fr)]";
    }

    if (viewportMode === "tablet") {
      return "grid-cols-[80px_minmax(0,1fr)]";
    }

    return "grid-cols-[minmax(0,1fr)]";
  }, [desktopPanelCollapsed, viewportMode]);

  const showNavToggle = true;
  const isNavOpen =
    viewportMode === "desktop"
      ? !desktopPanelCollapsed
      : viewportMode === "tablet"
        ? isContextPanelOpen
        : isMobileDrawerOpen;

  const onNavToggle = () => {
    if (viewportMode === "desktop") {
      setDesktopCollapsedAndPersist(!desktopPanelCollapsed);
      return;
    }

    if (viewportMode === "tablet") {
      setIsContextPanelOpen((open) => !open);
      return;
    }

    setIsMobileDrawerOpen((open) => !open);
  };

  return (
    <div
      className={cn(
        "grid h-full min-h-0 w-full overflow-hidden bg-[color-mix(in_oklch,var(--sidebar)_72%,var(--background))]",
        shellColumns
      )}
      data-nav-open={isNavOpen}
      data-shell-mode={viewportMode}
    >
      <Sidebar
        desktopPanelCollapsed={desktopPanelCollapsed}
        isContextPanelOpen={isContextPanelOpen}
        isMobileDrawerOpen={isMobileDrawerOpen}
        locale={locale}
        onContextPanelOpenChange={setIsContextPanelOpen}
        onDesktopPanelCollapsedChange={setDesktopCollapsedAndPersist}
        onMobileDrawerOpenChange={setIsMobileDrawerOpen}
        viewportMode={viewportMode}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          isNavOpen={isNavOpen}
          locale={locale}
          onNavToggle={onNavToggle}
          orgId={orgId}
          showNavToggle={showNavToggle}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-5 xl:p-6">
          <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function AdminShell({ orgId, locale, children }: AdminShellProps) {
  if (!SHELL_V2_ENABLED) {
    return (
      <LegacyAdminShell locale={locale} orgId={orgId}>
        {children}
      </LegacyAdminShell>
    );
  }

  return (
    <AdminShellV2 locale={locale} orgId={orgId}>
      {children}
    </AdminShellV2>
  );
}
