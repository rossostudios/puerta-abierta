"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useTabContextStrict } from "@/lib/tabs/tab-context";
import { getTabIcon } from "@/lib/tabs/tab-label";
import type { Tab } from "@/lib/tabs/tab-store";
import { cn } from "@/lib/utils";

function TabItem({
  tab,
  isActive,
  canClose,
  onSwitch,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  canClose: boolean;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const tabIcon = getTabIcon(tab.pathname);

  const handleAuxClick = useCallback(
    (e: React.MouseEvent) => {
      // Middle-click to close
      if (e.button === 1 && canClose) {
        e.preventDefault();
        onClose(tab.id);
      }
    },
    [tab.id, canClose, onClose],
  );

  return (
    <button
      aria-selected={isActive}
      className={cn(
        "group/tab relative flex h-8 max-w-[200px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] leading-tight transition-colors",
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
      onAuxClick={handleAuxClick}
      onClick={() => onSwitch(tab.id)}
      role="tab"
      title={tab.label}
      type="button"
    >
      <Icon
        className={cn(
          "shrink-0",
          isActive ? "text-foreground/70" : "text-muted-foreground/60",
        )}
        icon={tabIcon}
        size={13}
      />
      <span className="truncate">{tab.label}</span>
      {canClose && (
        <span
          className={cn(
            "ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-muted-foreground/20",
            isActive ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              onClose(tab.id);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <Icon icon={Cancel01Icon} size={10} />
        </span>
      )}
    </button>
  );
}

function OverflowMenu({
  tabs,
  activeTabId,
  onSwitch,
}: {
  tabs: Tab[];
  activeTabId: string;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (ref.current && !ref.current.contains(e.relatedTarget)) {
      setOpen(false);
    }
  }, []);

  return (
    <div className="relative" onBlur={handleBlur} ref={ref}>
      <button
        aria-label="All tabs"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <Icon icon={ArrowDown01Icon} size={14} />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-md">
          {tabs.map((tab) => {
            const tabIcon = getTabIcon(tab.pathname);
            return (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-muted",
                  tab.id === activeTabId
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
                key={tab.id}
                onClick={() => {
                  onSwitch(tab.id);
                  setOpen(false);
                }}
                type="button"
              >
                <Icon className="shrink-0" icon={tabIcon} size={13} />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TabBar() {
  const { state, addTab, closeTab, switchTab } = useTabContextStrict();
  const { tabs, activeTabId } = state;

  // Only show when 2+ tabs exist
  if (tabs.length < 2) return null;

  const canClose = tabs.length > 1;

  return (
    <div
      className="flex shrink-0 items-center gap-0.5 border-border/60 border-b bg-muted/30 px-2 py-1"
      role="tablist"
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <TabItem
            canClose={canClose}
            isActive={tab.id === activeTabId}
            key={tab.id}
            onClose={closeTab}
            onSwitch={switchTab}
            tab={tab}
          />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pl-1">
        <button
          aria-label="New tab"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          onClick={() => addTab()}
          type="button"
        >
          <Icon icon={Add01Icon} size={14} />
        </button>
        <OverflowMenu
          activeTabId={activeTabId}
          onSwitch={switchTab}
          tabs={tabs}
        />
      </div>
    </div>
  );
}
