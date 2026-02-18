"use client";

import type { ReactNode, RefObject } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { MemberRole, ViewportMode } from "@/components/shell/sidebar-new";
import { SidebarNew } from "@/components/shell/sidebar-new";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type DesktopResizableShellProps = {
  shellSurfaceClass: string;
  sidebarCollapsed: boolean;
  viewportMode: ViewportMode;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  sidebarPanelRef: RefObject<PanelImperativeHandle | null>;
  locale: Locale;
  onboardingProgress: {
    completedSteps: number;
    totalSteps: number;
    percent: number;
  };
  onMobileDrawerOpenChange: (open: boolean) => void;
  orgId: string | null;
  role?: MemberRole | null;
  contentColumn: ReactNode;
  overlays: ReactNode;
};

export function DesktopResizableShell({
  shellSurfaceClass,
  sidebarCollapsed,
  viewportMode,
  onSidebarCollapsedChange,
  sidebarPanelRef,
  locale,
  onboardingProgress,
  onMobileDrawerOpenChange,
  orgId,
  role,
  contentColumn,
  overlays,
}: DesktopResizableShellProps) {
  return (
    <div
      className={cn(
        "h-full min-h-0 w-full overflow-hidden",
        shellSurfaceClass
      )}
      data-nav-open={!sidebarCollapsed}
      data-shell-mode={viewportMode}
    >
      <ResizablePanelGroup
        className="h-full min-h-0 w-full overflow-hidden"
        orientation="horizontal"
      >
        <ResizablePanel
          className="min-h-0 overflow-hidden"
          collapsedSize={0}
          collapsible
          defaultSize="20%"
          maxSize="40%"
          minSize="14%"
          onResize={(size) =>
            onSidebarCollapsedChange(size.asPercentage === 0)
          }
          panelRef={sidebarPanelRef}
        >
          <SidebarNew
            isMobileDrawerOpen={false}
            locale={locale}
            onboardingProgress={onboardingProgress}
            onMobileDrawerOpenChange={onMobileDrawerOpenChange}
            orgId={orgId}
            role={role}
            viewportMode={viewportMode}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          className="min-h-0 min-w-0 overflow-hidden"
          minSize="50%"
        >
          {contentColumn}
        </ResizablePanel>
      </ResizablePanelGroup>
      {overlays}
    </div>
  );
}
