"use client";

import { useContext, useEffect, useState } from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  type Locale,
  normalizeLocale,
} from "@/lib/i18n";

import { LOCALE_CHANGE_EVENT, LocaleContext } from "@/lib/i18n/locale-context";
import { getDictionary } from "./dictionaries";

function readActiveLocale(): Locale {
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

  return DEFAULT_LOCALE;
}

export function dispatchLocaleChange(locale: Locale) {
  try {
    window.dispatchEvent(
      new CustomEvent(LOCALE_CHANGE_EVENT, { detail: locale })
    );
  } catch {
    // Ignore event failures.
  }
}

export function useActiveLocale(): Locale {
  const fromContext = useContext(LocaleContext);
  const [locale, setLocale] = useState<Locale>(
    () => fromContext ?? readActiveLocale()
  );

  useEffect(() => {
    // Short-circuit: context handles updates via its own provider
    if (fromContext) return;

    const onLocaleChange = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setLocale(normalizeLocale(detail) ?? readActiveLocale());
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY) return;
      setLocale(normalizeLocale(event.newValue) ?? readActiveLocale());
    };

    window.addEventListener(LOCALE_CHANGE_EVENT, onLocaleChange);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, onLocaleChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [fromContext]);

  return fromContext ?? locale;
}

export function useDictionary() {
  const locale = useActiveLocale();
  return getDictionary(locale);
}
