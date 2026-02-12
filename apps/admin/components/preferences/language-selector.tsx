"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Select } from "@/components/ui/select";
import { LOCALE_STORAGE_KEY, type Locale, localeLabel } from "@/lib/i18n";
import { dispatchLocaleChange, useActiveLocale } from "@/lib/i18n/client";

function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }

  try {
    document.documentElement.lang = locale;
  } catch {
    // ignore
  }
  dispatchLocaleChange(locale);
}

type LanguageSelectorProps = {
  className?: string;
};

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const router = useRouter();
  const locale = useActiveLocale();
  const [submitting, setSubmitting] = useState(false);

  const setAndPersist = async (next: Locale) => {
    if (submitting) return;
    if (next === locale) return;

    const previous = locale;
    setSubmitting(true);
    persistLocale(next);

    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ locale: next }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || "Request failed");
      }

      const isEn = next === "en-US";
      toast.success(isEn ? "Language updated" : "Idioma actualizado", {
        description: localeLabel(next),
      });
      // A full reload ensures the root layout + all server components re-render
      // with the updated `pa-locale` cookie, preventing partial language updates.
      router.refresh();
      try {
        window.location.reload();
      } catch {
        // ignore
      }
    } catch (err) {
      const isEn = previous === "en-US";
      persistLocale(previous);
      toast.error(
        isEn ? "Could not update language" : "No se pudo actualizar el idioma",
        {
          description: err instanceof Error ? err.message : String(err),
        }
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Select
      aria-label={locale === "en-US" ? "Select language" : "Seleccionar idioma"}
      className={className}
      disabled={submitting}
      onChange={(event) => setAndPersist(event.target.value as Locale)}
      value={locale}
    >
      <option value="es-PY">ES</option>
      <option value="en-US">EN</option>
    </Select>
  );
}
