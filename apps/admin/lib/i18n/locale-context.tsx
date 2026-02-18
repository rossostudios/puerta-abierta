"use client";

import { createContext, useEffect, useRef, useState } from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  type Locale,
  normalizeLocale,
} from "@/lib/i18n";

export const LOCALE_CHANGE_EVENT = "pa-locale-change";

export const LocaleContext = createContext<Locale | null>(null);

function readLocaleFromBrowser(): Locale | null {
  if (typeof document !== "undefined") {
    const fromHtml = normalizeLocale(document.documentElement.lang);
    if (fromHtml) return fromHtml;
  }

  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    const parsed = normalizeLocale(stored);
    if (parsed) return parsed;
  } catch {
    // Ignore storage failures (private mode / blocked).
  }

  return null;
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
}) {
  // Use the server locale as the initial value so SSR markup matches hydration.
  const [locale, setLocale] = useState<Locale>(initialLocale);

  // Sync locale state when the server-provided initialLocale prop changes,
  // without calling setState synchronously inside an effect.
  const prevInitialLocaleRef = useRef(initialLocale);
  if (prevInitialLocaleRef.current !== initialLocale) {
    prevInitialLocaleRef.current = initialLocale;
    setLocale(initialLocale);
  }

  useEffect(() => {
    try {
      document.documentElement.lang = initialLocale;
      localStorage.setItem(LOCALE_STORAGE_KEY, initialLocale);
    } catch {
      // ignore
    }
  }, [initialLocale]);

  useEffect(() => {
    const onLocaleChange = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setLocale(
        normalizeLocale(detail) ?? readLocaleFromBrowser() ?? DEFAULT_LOCALE
      );
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY) return;
      setLocale(
        normalizeLocale(event.newValue) ??
          readLocaleFromBrowser() ??
          DEFAULT_LOCALE
      );
    };

    window.addEventListener(LOCALE_CHANGE_EVENT, onLocaleChange);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, onLocaleChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}
