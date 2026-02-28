"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import { CasaoraLogo } from "@/components/ui/casaora-logo";
import { LOCALE_STORAGE_KEY, type Locale } from "@/lib/i18n";
import { dispatchLocaleChange, useActiveLocale } from "@/lib/i18n/client";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

/* ---------- Guest context ---------- */

type GuestContextValue = {
  token: string;
  reservationId: string;
  guestId: string;
  guestName: string;
  headers: Record<string, string>;
  apiBase: string;
};

const GuestContext = createContext<GuestContextValue | null>(null);

export function useGuest(): GuestContextValue {
  const ctx = useContext(GuestContext);
  if (!ctx) throw new Error("useGuest must be used within GuestTokenLayout");
  return ctx;
}

/* ---------- Language toggle (simplified for guest portal) ---------- */

function GuestLangToggle() {
  const locale = useActiveLocale();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const toggle = async () => {
    if (switching) return;
    const next: Locale = locale === "en-US" ? "es-PY" : "en-US";
    setSwitching(true);

    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }

    try {
      document.documentElement.lang = next;
    } catch {
      /* ignore */
    }

    dispatchLocaleChange(next);

    try {
      await fetch("/api/locale", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ locale: next }),
      });
    } catch {
      /* best-effort */
    }

    router.refresh();
    setSwitching(false);
  };

  return (
    <button
      className="inline-flex h-8 items-center gap-1 rounded-full border border-border/60 bg-card px-3 font-medium text-muted-foreground text-xs transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
      disabled={switching}
      onClick={toggle}
      type="button"
    >
      <svg
        fill="none"
        height="14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="14"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" x2="22" y1="12" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span>{locale === "en-US" ? "ES" : "EN"}</span>
    </button>
  );
}

/* ---------- Nav tabs ---------- */

function GuestNav({ token }: { token: string }) {
  const pathname = usePathname();
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const base = `/guest/${encodeURIComponent(token)}`;

  const tabs = [
    { href: base, label: isEn ? "Home" : "Inicio", exact: true },
    {
      href: `${base}/itinerary`,
      label: isEn ? "Itinerary" : "Itinerario",
      exact: false,
    },
    {
      href: `${base}/checkin`,
      label: isEn ? "Check-in" : "Entrada",
      exact: false,
    },
    {
      href: `${base}/messages`,
      label: isEn ? "Messages" : "Mensajes",
      exact: false,
    },
  ];

  return (
    <nav className="scrollbar-none flex gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);

        return (
          <Link
            className={`shrink-0 rounded-full px-3.5 py-1.5 font-medium text-xs transition-colors ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            href={tab.href}
            key={tab.href}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ---------- Layout shell ---------- */

export default function GuestTokenLayout({
  children,
}: {
  children: ReactNode;
}) {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const {
    data: ctx,
    isError,
    isLoading,
  } = useQuery({
    queryKey: ["guest-verify", token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/guest/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.authenticated) {
        localStorage.setItem("guest_token", token);
        return {
          token,
          reservationId: data.reservation_id ?? "",
          guestId: data.guest_id ?? "",
          guestName: data.guest_name ?? "",
          headers: {
            "x-guest-token": token,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          apiBase: API_BASE,
        } satisfies GuestContextValue;
      }
      throw new Error("Invalid or expired token.");
    },
    retry: false,
  });

  useEffect(() => {
    if (isError) router.push("/guest/login");
  }, [isError, router]);

  if (isError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-600">Unable to verify access.</p>
      </div>
    );
  }

  if (isLoading || !ctx) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="animate-pulse text-muted-foreground text-sm">
          Verifying access...
        </p>
      </div>
    );
  }

  return (
    <GuestContext.Provider value={ctx}>
      <div className="flex min-h-dvh flex-col bg-gradient-to-b from-background to-muted/20">
        {/* -- Branded header -- */}
        <header className="sticky top-0 z-40 border-border/40 border-b bg-background/95 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
            <Link
              className="inline-flex items-center gap-2 transition-opacity hover:opacity-80"
              href={`/guest/${encodeURIComponent(token)}`}
            >
              <CasaoraLogo className="text-foreground" size={28} />
            </Link>

            <div className="flex items-center gap-3">
              {ctx.guestName && (
                <span className="hidden text-muted-foreground text-sm sm:block">
                  {ctx.guestName}
                </span>
              )}
              <GuestLangToggle />
            </div>
          </div>

          {/* -- Tab navigation -- */}
          <GuestNav token={token} />
        </header>

        {/* -- Content area -- */}
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>

        {/* -- Minimal footer -- */}
        <footer className="border-border/30 border-t py-6 text-center">
          <p className="text-muted-foreground text-xs">
            &copy; {new Date().getFullYear()} Casaora
          </p>
        </footer>
      </div>
    </GuestContext.Provider>
  );
}
