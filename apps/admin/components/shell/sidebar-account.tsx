"use client";

import {
  ArrowDown01Icon,
  CreditCardIcon,
  File01Icon,
  KeyboardIcon,
  Logout01Icon,
  Settings03Icon,
  UserCircle02Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

type PlanSummary = {
  hasSubscription: boolean;
  planName: string;
  status: string;
  unavailable?: boolean;
};
const WHITESPACE_REGEX = /\s+/;

function metadataString(source: unknown, key: string): string {
  if (!source || typeof source !== "object") return "";
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function initials(value: string | null): string {
  if (!value) return "?";
  const normalized = value.includes("@") ? value.split("@")[0] : value;
  const words = normalized.trim().split(WHITESPACE_REGEX).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  return normalized.slice(0, 2).toUpperCase() || "?";
}

function statusLabel(status: string, isEn: boolean): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return "";
  if (isEn) {
    return normalized
      .split("_")
      .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
      .join(" ");
  }
  if (normalized === "trialing") return "Prueba";
  if (normalized === "active") return "Activa";
  if (normalized === "past_due") return "Vencida";
  if (normalized === "cancelled") return "Cancelada";
  return normalized;
}

export function SidebarAccount({
  collapsed,
  locale,
  orgId,
}: {
  collapsed: boolean;
  locale: Locale;
  orgId: string | null;
}) {
  const router = useRouter();
  const [account, setAccount] = useState<{
    avatarUrl: string | null;
    email: string | null;
    fullName: string | null;
  }>({
    avatarUrl: null,
    email: null,
    fullName: null,
  });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planSummary, setPlanSummary] = useState<PlanSummary | null>(null);
  const planCacheRef = useRef<Map<string, PlanSummary>>(new Map());
  const isEn = locale === "en-US";

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let mounted = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!mounted) return;
        const metadata = data.user?.user_metadata;
        const fullName =
          metadataString(metadata, "full_name") ||
          metadataString(metadata, "name");
        setAccount({
          avatarUrl: metadataString(metadata, "avatar_url") || null,
          email: data.user?.email ?? null,
          fullName: fullName || null,
        });
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setAccount({ avatarUrl: null, email: null, fullName: null });
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const metadata = session?.user?.user_metadata;
      const fullName =
        metadataString(metadata, "full_name") ||
        metadataString(metadata, "name");
      setAccount({
        avatarUrl: metadataString(metadata, "avatar_url") || null,
        email: session?.user?.email ?? null,
        fullName: fullName || null,
      });
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!(open && orgId)) {
      if (!orgId) {
        setPlanSummary(null);
        setPlanLoading(false);
      }
      return;
    }

    const cached = planCacheRef.current.get(orgId);
    if (cached) {
      setPlanSummary(cached);
      return;
    }

    let cancelled = false;

    setPlanSummary(null);
    setPlanLoading(true);

    const loadPlan = async () => {
      try {
        const response = await fetch(
          `/api/billing/current?org_id=${encodeURIComponent(orgId)}`,
          {
            cache: "no-store",
          }
        );
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const subscription = asObject(payload.subscription);
        const plan = asObject(payload.plan);

        const hasSubscription = Boolean(asString(subscription.id));
        const status = hasSubscription ? asString(subscription.status) : "";
        const planName = hasSubscription
          ? asString(plan.name) || (isEn ? "Current plan" : "Plan actual")
          : isEn
            ? "Free"
            : "Gratis";

        const summary: PlanSummary = {
          hasSubscription,
          planName,
          status,
        };

        planCacheRef.current.set(orgId, summary);
        if (!cancelled) setPlanSummary(summary);
      } catch {
        const summary: PlanSummary = {
          hasSubscription: false,
          planName: isEn ? "Plan unavailable" : "Plan no disponible",
          status: "",
          unavailable: true,
        };
        planCacheRef.current.set(orgId, summary);
        if (!cancelled) setPlanSummary(summary);
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    };

    loadPlan();

    return () => {
      cancelled = true;
    };
  }, [isEn, open, orgId]);

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

  const displayName = loading
    ? isEn
      ? "Loading..."
      : "Cargando..."
    : account.fullName || account.email || (isEn ? "No session" : "Sin sesión");

  const subtitle =
    account.fullName && account.email
      ? account.email
      : isEn
        ? "Account"
        : "Cuenta";

  const badge = initials(account.fullName || account.email);

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
          title={displayName}
        >
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-sidebar-border bg-secondary font-semibold text-foreground text-sm">
            {account.avatarUrl ? (
              // biome-ignore lint/performance/noImgElement: Avatar URL supports arbitrary hosts from user input fallback.
              <img
                alt={isEn ? "Avatar" : "Avatar"}
                className="h-full w-full object-cover"
                height={40}
                src={account.avatarUrl}
                width={40}
              />
            ) : (
              badge
            )}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 text-left",
              collapsed ? "sr-only" : ""
            )}
          >
            <span className="block truncate font-medium text-[13px] leading-5">
              {displayName}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {subtitle}
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
              {displayName}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {account.email || (isEn ? "Signed in" : "Sesión iniciada")}
            </p>
          </div>

          {orgId ? (
            <>
              <div className="my-1.5 h-px bg-border/80" />
              <div className="rounded-xl border border-border/70 bg-background/70 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                    {isEn ? "Current plan" : "Plan actual"}
                  </p>
                  {planSummary?.status ? (
                    <span className="rounded border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {statusLabel(planSummary.status, isEn)}
                    </span>
                  ) : null}
                </div>

                <p className="mt-1 truncate font-medium text-[13px] text-foreground">
                  {planLoading
                    ? isEn
                      ? "Loading plan..."
                      : "Cargando plan..."
                    : (planSummary?.planName ??
                      (isEn ? "Plan unavailable" : "Plan no disponible"))}
                </p>

                {planSummary?.unavailable ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {isEn
                      ? "Could not load plan details."
                      : "No se pudieron cargar los detalles del plan."}
                  </p>
                ) : !planLoading &&
                  planSummary &&
                  !planSummary.hasSubscription ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {isEn ? "No active subscription" : "Sin suscripción activa"}
                  </p>
                ) : null}

                <Link
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "mt-2 h-8 w-full justify-start gap-2 rounded-lg px-2 text-xs"
                  )}
                  href="/module/billing"
                  onClick={() => setOpen(false)}
                >
                  <Icon
                    className="text-muted-foreground"
                    icon={CreditCardIcon}
                    size={14}
                  />
                  {isEn ? "Open billing" : "Abrir facturación"}
                </Link>
              </div>
            </>
          ) : null}

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
                window.dispatchEvent(new CustomEvent("pa:show-shortcuts-help"));
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
