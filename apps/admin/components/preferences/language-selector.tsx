"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import { Globe02Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LOCALE_STORAGE_KEY, type Locale, localeLabel } from "@/lib/i18n";
import { dispatchLocaleChange, useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

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

type LocaleOption = {
  value: Locale;
  label: string;
  description: string;
};

type LanguageSelectorProps = {
  className?: string;
};

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const router = useRouter();
  const locale = useActiveLocale();
  const [open, setOpen] = useState(false);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  const submitting = pendingLocale !== null || isRefreshing;
  const isEn = locale === "en-US";

  const options: LocaleOption[] = [
    {
      value: "en-US",
      label: "English (US)",
      description: isEn ? "Use English interface." : "Usar interfaz en inglés.",
    },
    {
      value: "es-PY",
      label: "Español (PY)",
      description: isEn
        ? "Use Spanish interface."
        : "Usar interfaz en español.",
    },
  ];

  const setAndPersist = async (next: Locale) => {
    if (submitting) return;
    if (next === locale) {
      setOpen(false);
      return;
    }

    const previous = locale;
    setPendingLocale(next);
    persistLocale(next);
    setOpen(false);

    const nextIsEn = next === "en-US";
    const successTitle = nextIsEn ? "Language updated" : "Idioma actualizado";
    const prevIsEn = previous === "en-US";
    const errorTitle = prevIsEn
      ? "Could not update language"
      : "No se pudo actualizar el idioma";

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
        let errText = "Request failed";
        if (text) {
          errText = text;
        }
        persistLocale(previous);
        toast.error(errorTitle, { description: errText });
        setPendingLocale(null);
        return;
      }

      toast.success(successTitle, {
        description: localeLabel(next),
      });

      startRefresh(() => {
        router.refresh();
      });
      setPendingLocale(null);
    } catch (err) {
      persistLocale(previous);
      let desc = String(err);
      if (err instanceof Error) {
        desc = err.message;
      }
      toast.error(errorTitle, { description: desc });
      setPendingLocale(null);
    }
  };

  const title = isEn ? "Language" : "Idioma";

  return (
    <BasePopover.Root onOpenChange={setOpen} open={open}>
      <BasePopover.Trigger
        aria-label={isEn ? "Select language" : "Seleccionar idioma"}
        className={cn(
          buttonVariants({ size: "icon", variant: "outline" }),
          "h-9 w-9 rounded-xl",
          className
        )}
        disabled={submitting}
        title={title}
        type="button"
      >
        <Icon icon={Globe02Icon} size={18} />
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner align="end" side="bottom" sideOffset={8}>
          <BasePopover.Popup
            className={(state) =>
              cn(
                "glass-float z-50 w-[min(90vw,16rem)] rounded-2xl p-2",
                "transition-[opacity,transform] duration-150 ease-[var(--shell-ease)] motion-reduce:transition-none",
                state.open
                  ? "translate-y-0 opacity-100"
                  : "translate-y-1 opacity-0"
              )
            }
          >
            <div className="space-y-1">
              {options.map((option) => {
                const selected = option.value === locale;
                return (
                  <Button
                    className={cn(
                      "h-auto w-full items-start justify-between rounded-xl px-3 py-2 text-left",
                      selected
                        ? "bg-muted text-foreground"
                        : "text-foreground/80 hover:bg-muted/80"
                    )}
                    key={option.value}
                    onClick={() => setAndPersist(option.value)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-sm">
                        {option.label}
                      </span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {option.description}
                      </span>
                    </span>
                    {selected ? (
                      <Icon
                        className="mt-0.5 shrink-0 text-foreground/80"
                        icon={Tick01Icon}
                        size={14}
                      />
                    ) : null}
                  </Button>
                );
              })}
            </div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
