export type Tab = {
  id: string;
  pathname: string;
  search: string;
  label: string;
  moduleSlug?: string;
};

export type TabState = {
  tabs: Tab[];
  activeTabId: string;
};

const STORAGE_KEY = "pa-admin-tabs";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadTabState(): TabState | null {
  if (typeof window === "undefined") return null;
  return safeParse<TabState>(localStorage.getItem(STORAGE_KEY));
}

export function saveTabState(state: TabState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createTab(
  pathname: string,
  search: string,
  label: string,
  moduleSlug?: string,
): Tab {
  return {
    id: crypto.randomUUID(),
    pathname,
    search,
    label,
    moduleSlug,
  };
}

export function defaultTabState(
  pathname: string,
  search: string,
  label: string,
  moduleSlug?: string,
): TabState {
  const tab = createTab(pathname, search, label, moduleSlug);
  return { tabs: [tab], activeTabId: tab.id };
}

export function addTab(state: TabState, tab: Tab): TabState {
  return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

export function closeTab(state: TabState, tabId: string): TabState {
  if (state.tabs.length <= 1) return state;

  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return state;

  const next = state.tabs.filter((t) => t.id !== tabId);
  let activeTabId = state.activeTabId;

  if (state.activeTabId === tabId) {
    // Switch to adjacent tab (prefer right, then left)
    const newIdx = Math.min(idx, next.length - 1);
    activeTabId = next[newIdx].id;
  }

  return { tabs: next, activeTabId };
}

export function switchTab(state: TabState, tabId: string): TabState {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return state;
  return { ...state, activeTabId: tabId };
}

export function updateActiveTab(
  state: TabState,
  pathname: string,
  search: string,
  label: string,
  moduleSlug?: string,
): TabState {
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === state.activeTabId
        ? { ...t, pathname, search, label, moduleSlug }
        : t,
    ),
  };
}

export function getActiveTab(state: TabState): Tab | undefined {
  return state.tabs.find((t) => t.id === state.activeTabId);
}
