"use client";

import {
  ArrowDown01Icon,
  File01Icon,
  KeyboardIcon,
  Logout01Icon,
  Settings03Icon,
  UserCircle02Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LanguageSelector } from "@/components/preferences/language-selector";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Locale } from "@/lib/i18n";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

function initials(value: string | null): string {
  if (!value) return "?";
  const [left] = value.trim().split("@");
  if (!left) return "?";
  return left.slice(0, 1).toUpperCase();
}

export function SidebarAccount({
  collapsed,
  locale,
}: {
  collapsed: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const isEn = locale === "en-US";

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let mounted = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!mounted) return;
        setEmail(data.user?.email ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setEmail(null);
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const onSignOut = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(isEn ? "Could not sign out" : "No se pudo cerrar sesión", {
          description: error.message,
        });
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error(isEn ? "Could not sign out" : "No se pudo cerrar sesión", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const label = loading
    ? isEn
      ? "Loading..."
      : "Cargando..."
    : (email ?? (isEn ? "No session" : "Sin sesión"));
  const badge = initials(email);

  return (
    <div className="mt-3 border-sidebar-border/70 border-t pt-3">
      <PopoverRoot onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          aria-label={isEn ? "Open account menu" : "Abrir menú de cuenta"}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "group w-full justify-start gap-2.5 rounded-2xl border border-transparent px-2.5 py-2.5 text-foreground/72 outline-none",
            "transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-sidebar-border hover:bg-sidebar-accent hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring/30",
            open && "border-sidebar-border bg-sidebar-accent text-foreground",
            collapsed ? "justify-center px-0" : ""
          )}
          title={label}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sidebar-border bg-secondary font-semibold text-foreground text-sm">
            {badge}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 text-left",
              collapsed ? "sr-only" : ""
            )}
          >
            <span className="block truncate font-medium text-[13px] leading-5">
              {label}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {isEn ? "Account" : "Cuenta"}
            </span>
          </span>
          <Icon
            className={cn(
              "text-muted-foreground transition-transform",
              open ? "rotate-180" : "rotate-0",
              collapsed ? "sr-only" : ""
            )}
            icon={ArrowDown01Icon}
            size={16}
          />
        </PopoverTrigger>

        <PopoverContent
          align={collapsed ? "start" : "end"}
          className="w-[260px] p-1.5"
          side="top"
          sideOffset={10}
        >
          <div className="rounded-xl border border-border/70 bg-background/70 p-2">
            <p className="truncate font-medium text-[13px] text-foreground">
              {label}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {isEn ? "Signed in" : "Sesión iniciada"}
            </p>
          </div>

          <nav
            aria-label={isEn ? "Account links" : "Enlaces de cuenta"}
            className="mt-1.5 space-y-0.5"
          >
            <Link
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "h-9 w-full justify-start gap-2.5 rounded-xl px-2.5 font-normal text-foreground/88 hover:bg-muted/70 hover:text-foreground"
              )}
              href="/account"
              onClick={() => setOpen(false)}
            >
              <Icon
                className="text-muted-foreground"
                icon={UserCircle02Icon}
                size={16}
              />
              {isEn ? "Profile" : "Perfil"}
            </Link>
            <Link
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "h-9 w-full justify-start gap-2.5 rounded-xl px-2.5 font-normal text-foreground/88 hover:bg-muted/70 hover:text-foreground"
              )}
              href="/documentation"
              onClick={() => setOpen(false)}
            >
              <Icon
                className="text-muted-foreground"
                icon={File01Icon}
                size={16}
              />
              {isEn ? "Documentation" : "Documentación"}
            </Link>
            <Link
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "h-9 w-full justify-start gap-2.5 rounded-xl px-2.5 font-normal text-foreground/88 hover:bg-muted/70 hover:text-foreground"
              )}
              href="/settings"
              onClick={() => setOpen(false)}
            >
              <Icon
                className="text-muted-foreground"
                icon={Settings03Icon}
                size={16}
              />
              {isEn ? "Settings" : "Configuración"}
            </Link>
            <button
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "h-9 w-full justify-start gap-2.5 rounded-xl px-2.5 font-normal text-foreground/88 hover:bg-muted/70 hover:text-foreground"
              )}
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(
                  new CustomEvent("pa:show-shortcuts-help")
                );
              }}
              type="button"
            >
              <Icon
                className="text-muted-foreground"
                icon={KeyboardIcon}
                size={16}
              />
              {isEn ? "Keyboard shortcuts" : "Atajos de teclado"}
              <kbd className="ml-auto rounded border border-border/80 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ?
              </kbd>
            </button>
          </nav>

          <div className="my-1.5 h-px bg-border/80" />

          <div className="px-2.5 py-1.5">
            <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {isEn ? "Language" : "Idioma"}
            </p>
            <LanguageSelector className="mt-2 h-8 text-xs" />
          </div>

          <div className="my-1.5 h-px bg-border/80" />

          <button
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-9 w-full justify-start gap-2.5 rounded-xl px-2.5 font-normal text-foreground/88 hover:bg-muted/70 hover:text-foreground"
            )}
            onClick={onSignOut}
            type="button"
          >
            <Icon
              className="text-muted-foreground"
              icon={Logout01Icon}
              size={16}
            />
            {isEn ? "Log out" : "Cerrar sesión"}
          </button>
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}
