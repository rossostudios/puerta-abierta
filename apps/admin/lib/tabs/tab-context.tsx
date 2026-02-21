"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Locale } from "@/lib/i18n";
import { buildTabLabel, extractModuleSlug } from "./tab-label";
import {
  addTab as addTabPure,
  closeTab as closeTabPure,
  createTab,
  defaultTabState,
  getActiveTab,
  loadTabState,
  saveTabState,
  switchTab as switchTabPure,
  type TabState,
  updateActiveTab,
} from "./tab-store";

type TabContextValue = {
  state: TabState;
  addTab: (pathname?: string, search?: string) => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
};

const TabContext = createContext<TabContextValue | null>(null);

export function useTabContext(): TabContextValue | null {
  return useContext(TabContext);
}

export function useTabContextStrict(): TabContextValue {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error("useTabContextStrict must be used within TabProvider");
  return ctx;
}

export function TabProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const search = searchParams.toString() ? `?${searchParams.toString()}` : "";

  // Track whether a tab switch triggered the navigation, to avoid re-syncing
  const switchingRef = useRef(false);

  const [state, setState] = useState<TabState>(() => {
    const saved = loadTabState();
    if (saved && saved.tabs.length > 0) {
      // Update the active tab's URL to match current browser URL
      const label = buildTabLabel(pathname, locale);
      const moduleSlug = extractModuleSlug(pathname);
      return updateActiveTab(saved, pathname, search, label, moduleSlug);
    }
    const label = buildTabLabel(pathname, locale);
    const moduleSlug = extractModuleSlug(pathname);
    return defaultTabState(pathname, search, label, moduleSlug);
  });

  // Sync URL changes to the active tab (when user navigates normally)
  useEffect(() => {
    if (switchingRef.current) {
      switchingRef.current = false;
      return;
    }

    setState((prev) => {
      const active = getActiveTab(prev);
      if (active && active.pathname === pathname && active.search === search) {
        return prev;
      }
      const label = buildTabLabel(pathname, locale);
      const moduleSlug = extractModuleSlug(pathname);
      return updateActiveTab(prev, pathname, search, label, moduleSlug);
    });
  }, [pathname, search, locale]);

  // Persist to localStorage whenever state changes
  useEffect(() => {
    saveTabState(state);
  }, [state]);

  const addTab = useCallback(
    (tabPathname?: string, tabSearch?: string) => {
      const p = tabPathname ?? "/app";
      const s = tabSearch ?? "";
      const label = buildTabLabel(p, locale);
      const moduleSlug = extractModuleSlug(p);
      const tab = createTab(p, s, label, moduleSlug);

      setState((prev) => addTabPure(prev, tab));
      switchingRef.current = true;
      router.push(p + s);
    },
    [locale, router],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setState((prev) => {
        const next = closeTabPure(prev, tabId);
        // If closing the active tab, navigate to the new active tab
        if (prev.activeTabId === tabId && next.activeTabId !== tabId) {
          const newActive = next.tabs.find((t) => t.id === next.activeTabId);
          if (newActive) {
            switchingRef.current = true;
            router.push(newActive.pathname + newActive.search);
          }
        }
        return next;
      });
    },
    [router],
  );

  const switchTabFn = useCallback(
    (tabId: string) => {
      setState((prev) => {
        const next = switchTabPure(prev, tabId);
        const tab = next.tabs.find((t) => t.id === tabId);
        if (tab && tab.id !== prev.activeTabId) {
          switchingRef.current = true;
          router.push(tab.pathname + tab.search);
        }
        return next;
      });
    },
    [router],
  );

  return (
    <TabContext.Provider
      value={{ state, addTab, closeTab, switchTab: switchTabFn }}
    >
      {children}
    </TabContext.Provider>
  );
}
