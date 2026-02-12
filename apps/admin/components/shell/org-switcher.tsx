"use client";

import {
  Add01Icon,
  Building01Icon,
  Tick01Icon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Org = {
  id: string;
  name?: string | null;
};

type MeResponse = {
  organizations?: Org[];
};

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function OrgSwitcher({
  activeOrgId,
  locale,
}: {
  activeOrgId: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  const isEn = locale === "en-US";

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const response = await fetch("/api/me", {
          cache: "no-store",
        });
        if (!response.ok) {
          if (mounted) setLoading(false);
          return;
        }
        const payload = (await response.json()) as MeResponse;
        if (!mounted) return;
        setOrgs(payload.organizations ?? []);
        setLoading(false);
      } catch {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const activeOrg = useMemo(
    () => orgs.find((org) => org.id === activeOrgId) ?? null,
    [activeOrgId, orgs]
  );

  const label =
    activeOrg?.name?.trim() ||
    (activeOrgId
      ? shortId(activeOrgId)
      : isEn
        ? "Select organization"
        : "Seleccionar organización");

  const onSelect = async (orgId: string) => {
    try {
      const response = await fetch("/api/org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        toast.error(
          isEn
            ? "Could not switch organization"
            : "No se pudo cambiar la organización",
          {
            description:
              text || (isEn ? "Request failed" : "Falló la solicitud"),
          }
        );
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(
        isEn
          ? "Could not switch organization"
          : "No se pudo cambiar la organización",
        {
          description: err instanceof Error ? err.message : String(err),
        }
      );
    }
  };

  return (
    <PopoverRoot onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl border border-transparent p-1.5 outline-none transition-all duration-200",
          "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-muted/60"
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background shadow-xs transition-colors group-hover:border-border/60">
          <Icon
            className="text-foreground/80"
            icon={Building01Icon}
            size={18}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate font-medium text-foreground text-sm leading-tight">
            {loading ? (
              <span className="animate-pulse rounded bg-muted text-transparent">
                Loading
              </span>
            ) : (
              label
            )}
          </span>
          <span className="truncate text-[11px] text-muted-foreground/60 leading-tight">
            {isEn ? "Agency" : "Agencia"}
          </span>
        </div>
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
          fill="none"
          focusable="false"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M8 9l4-4 4 4m0 6l-4 4-4-4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
        </svg>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[260px] p-1"
        side="bottom"
        sideOffset={8}
      >
        <div className="px-2 py-1.5">
          <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
            {isEn ? "Switch Organization" : "Cambiar organización"}
          </p>
        </div>

        <div className="max-h-[280px] overflow-y-auto">
          {loading ? (
            <div className="px-2 py-4 text-center text-muted-foreground text-xs">
              {isEn ? "Loading..." : "Cargando..."}
            </div>
          ) : orgs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-8 text-center text-muted-foreground">
              <Icon
                className="text-muted-foreground/40"
                icon={UnavailableIcon}
                size={24}
              />
              <p className="text-xs">
                {isEn
                  ? "No organizations found"
                  : "No se encontraron organizaciones"}
              </p>
            </div>
          ) : (
            orgs.map((org) => {
              const selected = org.id === activeOrgId;
              return (
                <button
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                    selected
                      ? "bg-primary/5 text-primary"
                      : "text-foreground hover:bg-muted/50"
                  )}
                  key={org.id}
                  onClick={() => onSelect(org.id)}
                  type="button"
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                      selected
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-border/40 bg-background text-muted-foreground"
                    )}
                  >
                    <Icon icon={Building01Icon} size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[13px]">
                      {org.name ||
                        (isEn ? "Unnamed Organization" : "Sin nombre")}
                    </span>
                    <span className="block truncate font-mono text-[10px] opacity-60">
                      {shortId(org.id)}
                    </span>
                  </div>
                  {selected && (
                    <Icon
                      className="text-primary"
                      icon={Tick01Icon}
                      size={16}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-1 border-border/40 border-t p-1">
          <Link
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-9 w-full justify-start gap-2 text-xs"
            )}
            href="/setup"
            onClick={() => setOpen(false)}
          >
            <Icon icon={Add01Icon} size={14} />
            {isEn
              ? "Create or join organization"
              : "Crear o unirse a organización"}
          </Link>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
