"use client";

import {
  ArrowDown01Icon,
  Logout01Icon,
  UserCircle02Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LanguageSelector } from "@/components/preferences/language-selector";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
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
      <details className="relative">
        <summary
          aria-haspopup="menu"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "w-full list-none justify-start gap-2.5 rounded-2xl border border-transparent px-2.5 py-2.5 text-foreground/72 [&::-webkit-details-marker]:hidden",
            "transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-border/70 hover:bg-background/72 hover:text-foreground",
            collapsed ? "justify-center px-0" : ""
          )}
          title={label}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sidebar-border/80 bg-background/90 font-semibold text-foreground text-sm">
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
            className={cn("text-muted-foreground", collapsed ? "sr-only" : "")}
            icon={ArrowDown01Icon}
            size={16}
          />
        </summary>

        <div
          className={cn(
            "absolute bottom-12 z-30 rounded-2xl border border-sidebar-border/80 bg-popover/98 p-1.5 shadow-[0_20px_40px_rgba(15,23,42,0.16)]",
            collapsed ? "left-full ml-2 w-56" : "right-0 left-0"
          )}
        >
          <Link
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "w-full justify-start gap-2 px-2 font-normal"
            )}
            href="/account"
          >
            <Icon
              className="text-muted-foreground"
              icon={UserCircle02Icon}
              size={16}
            />
            {isEn ? "Account" : "Cuenta"}
          </Link>

          <div className="my-1 h-px bg-border" />

          <div className="px-2 py-2">
            <p className="px-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {isEn ? "Language" : "Idioma"}
            </p>
            <LanguageSelector className="mt-2 h-8 text-xs" />
          </div>

          <div className="my-1 h-px bg-border" />

          <button
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "w-full justify-start gap-2 px-2 font-normal"
            )}
            onClick={onSignOut}
            type="button"
          >
            <Icon
              className="text-muted-foreground"
              icon={Logout01Icon}
              size={16}
            />
            {isEn ? "Sign out" : "Cerrar sesión"}
          </button>
        </div>
      </details>
    </div>
  );
}
