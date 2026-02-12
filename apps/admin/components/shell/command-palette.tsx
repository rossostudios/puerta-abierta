"use client";

import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { useActiveLocale } from "@/lib/i18n/client";
import { MODULES } from "@/lib/modules";
import {
  getPins,
  getRecents,
  type ShortcutItem,
  subscribeShortcuts,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

type ActionItem = {
  key: string;
  label: string;
  meta?: string;
  href: string;
  kind: "module" | "pin" | "recent";
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function toActions(
  items: ShortcutItem[],
  kind: ActionItem["kind"]
): ActionItem[] {
  return items.map((it) => ({
    key: `${kind}:${it.href}`,
    label: it.label,
    meta: it.meta,
    href: it.href,
    kind,
  }));
}

export function CommandPalette() {
  const router = useRouter();
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pins, setPins] = useState<ShortcutItem[]>([]);
  const [recents, setRecents] = useState<ShortcutItem[]>([]);

  useEffect(() => {
    const sync = () => {
      setPins(getPins());
      setRecents(getRecents());
    };
    sync();
    return subscribeShortcuts(sync);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.key) return;
      const isK = event.key.toLowerCase() === "k";
      if ((event.metaKey || event.ctrlKey) && isK) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const actions = useMemo(() => {
    const moduleActions: ActionItem[] = MODULES.map((m) => ({
      key: `module:${m.slug}`,
      label: m.label,
      meta: "Módulo",
      href: `/module/${m.slug}`,
      kind: "module",
    }));

    const pinActions = toActions(pins, "pin");
    const recentActions = toActions(recents, "recent");

    const all = [...pinActions, ...recentActions, ...moduleActions];
    const q = normalize(query);
    if (!q) return all;
    return all.filter((a) =>
      normalize(`${a.label} ${a.meta ?? ""} ${a.href}`).includes(q)
    );
  }, [pins, query, recents]);

  useEffect(() => {
    if (cursor >= actions.length) setCursor(0);
  }, [actions.length, cursor]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDownList = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) =>
        Math.min(current + 1, Math.max(actions.length - 1, 0))
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = actions[cursor];
      if (selected) go(selected.href);
    }
  };

  return (
    <>
      <Button
        aria-label={
          isEn ? "Search or jump to... (Cmd+K)" : "Buscar o ir a... (Cmd+K)"
        }
        className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border-border/85 bg-background/90 px-3.5 font-normal text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-background"
        onClick={() => setOpen(true)}
        type="button"
        variant="outline"
      >
        <span className="flex items-center gap-2">
          <Icon icon={Search01Icon} size={16} />
          <span className="truncate">
            {isEn ? "Search or jump to..." : "Buscar o ir a..."}
          </span>
        </span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-medium font-mono text-[10px] text-muted-foreground opacity-100 md:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/24 backdrop-blur-[3px] transition-opacity dark:bg-black/65"
            onClick={() => setOpen(false)}
          />

          <div className="absolute top-[9vh] left-1/2 w-[min(760px,calc(100vw-32px))] -translate-x-1/2">
            <div className="overflow-hidden rounded-3xl border border-border/80 bg-popover/98 shadow-[0_24px_54px_rgba(15,23,42,0.22)]">
              <div className="flex items-center gap-2 border-border/75 border-b px-4 py-3">
                <Icon
                  className="text-muted-foreground"
                  icon={Search01Icon}
                  size={18}
                />
                <Input
                  className="border-0 bg-transparent px-0 focus-visible:ring-0"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onKeyDownList}
                  placeholder="Buscar módulos, registros recientes o accesos fijados..."
                  ref={inputRef}
                  value={query}
                />
                <button
                  aria-label="Cerrar"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon" }),
                    "h-9 w-9 rounded-xl"
                  )}
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  <Icon icon={Cancel01Icon} size={18} />
                </button>
              </div>

              <div className="max-h-[52vh] overflow-auto p-2">
                {actions.length ? (
                  actions.map((action, index) => {
                    const active = index === cursor;
                    return (
                      <button
                        className={cn(
                          "flex w-full items-center justify-between gap-4 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors",
                          active
                            ? "bg-muted/56 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.04)]"
                            : "hover:bg-muted/34"
                        )}
                        key={action.key}
                        onClick={() => go(action.href)}
                        onMouseEnter={() => setCursor(index)}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {action.label}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {action.meta ? `${action.meta} · ` : ""}
                            {action.href}
                          </span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {action.kind === "pin"
                            ? "Fijado"
                            : action.kind === "recent"
                              ? "Reciente"
                              : ""}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-8 text-center text-muted-foreground text-sm">
                    Sin resultados.
                  </div>
                )}
              </div>

              <div className="border-border/75 border-t px-4 py-2.5 text-muted-foreground text-xs">
                Tip: <span className="font-medium text-foreground">Cmd+K</span>{" "}
                para abrir. Usa{" "}
                <span className="font-medium text-foreground">↑</span>/
                <span className="font-medium text-foreground">↓</span> y luego{" "}
                <span className="font-medium text-foreground">Enter</span>.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
