"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import { Moon01Icon, Sun01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "pa-theme";
const THEME_V2_ENABLED = process.env.NEXT_PUBLIC_THEME_V2 !== "0";

function getStoredThemePreference(): ThemePreference | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return null;
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return getSystemTheme();
  }
  return preference;
}

function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

type ThemeToggleProps = {
  locale?: Locale;
};

export function ThemeToggle({ locale: localeProp }: ThemeToggleProps) {
  const activeLocale = useActiveLocale();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const initial = getStoredThemePreference() ?? "system";
    setPreference(initial);
    const initialResolved = resolveTheme(initial);
    setResolvedTheme(initialResolved);
    applyTheme(initial);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const nextResolved = resolveTheme(preference);
    setResolvedTheme(nextResolved);
    applyTheme(preference);
    localStorage.setItem(STORAGE_KEY, preference);

    if (preference !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const updated = getSystemTheme();
      setResolvedTheme(updated);
      applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mounted, preference]);

  const locale = mounted ? activeLocale : (localeProp ?? activeLocale);
  const isEn = locale === "en-US";

  const options = useMemo(
    () =>
      [
        {
          value: "system" as const,
          label: isEn ? "System" : "Sistema",
          description: isEn
            ? "Follow your device appearance."
            : "Usa la apariencia de tu dispositivo.",
        },
        {
          value: "light" as const,
          label: isEn ? "Light" : "Claro",
          description: isEn ? "Use the light palette." : "Usa la paleta clara.",
        },
        {
          value: "dark" as const,
          label: isEn ? "Dark" : "Oscuro",
          description: isEn ? "Use the dark palette." : "Usa la paleta oscura.",
        },
      ] satisfies Array<{
        value: ThemePreference;
        label: string;
        description: string;
      }>,
    [isEn]
  );

  const icon = resolvedTheme === "dark" ? Moon01Icon : Sun01Icon;
  const title = isEn ? "Theme" : "Tema";

  if (!THEME_V2_ENABLED) {
    return (
      <Button
        aria-label={isEn ? "Toggle theme" : "Cambiar tema"}
        onClick={() => {
          const next: ThemePreference =
            resolvedTheme === "dark" ? "light" : "dark";
          setPreference(next);
        }}
        size="icon"
        title={title}
        variant="outline"
      >
        <Icon icon={icon} size={18} />
      </Button>
    );
  }

  return (
    <BasePopover.Root onOpenChange={setOpen} open={open}>
      <BasePopover.Trigger
        aria-label={isEn ? "Select theme" : "Seleccionar tema"}
        className={cn(
          buttonVariants({ size: "icon", variant: "outline" }),
          "h-9 w-9 rounded-xl"
        )}
        title={title}
        type="button"
      >
        <Icon icon={icon} size={18} />
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner align="end" side="bottom" sideOffset={8}>
          <BasePopover.Popup
            className={(state) =>
              cn(
                "z-50 w-[min(90vw,16rem)] rounded-2xl border border-border/85 bg-popover/98 p-2 shadow-[var(--shadow-soft)]",
                "transition-[opacity,transform] duration-150 ease-[var(--shell-ease)] motion-reduce:transition-none",
                state.open
                  ? "translate-y-0 opacity-100"
                  : "translate-y-1 opacity-0"
              )
            }
          >
            <div className="space-y-1">
              {options.map((option) => {
                const selected = option.value === preference;
                return (
                  <Button
                    className={cn(
                      "h-auto w-full items-start justify-between rounded-xl px-3 py-2 text-left",
                      selected
                        ? "bg-muted text-foreground"
                        : "text-foreground/80 hover:bg-muted/80"
                    )}
                    key={option.value}
                    onClick={() => {
                      setPreference(option.value);
                      setOpen(false);
                    }}
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
