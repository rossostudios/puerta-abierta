"use client";

import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

interface GuestContextValue {
  token: string;
  reservationId: string;
  guestId: string;
  headers: Record<string, string>;
  apiBase: string;
}

const GuestContext = createContext<GuestContextValue | null>(null);

export function useGuest(): GuestContextValue {
  const ctx = useContext(GuestContext);
  if (!ctx) throw new Error("useGuest must be used within GuestTokenLayout");
  return ctx;
}

export default function GuestTokenLayout({
  children,
}: {
  children: ReactNode;
}) {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [ctx, setCtx] = useState<GuestContextValue | null>(null);
  const [error, setError] = useState("");

  const verify = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/public/guest/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.authenticated) {
        localStorage.setItem("guest_token", token);
        setCtx({
          token,
          reservationId: data.reservation_id ?? "",
          guestId: data.guest_id ?? "",
          headers: {
            "x-guest-token": token,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          apiBase: API_BASE,
        });
      } else {
        setError("Invalid or expired token.");
        router.push("/guest/login");
      }
    } catch {
      setError("Unable to verify access.");
      router.push("/guest/login");
    }
  }, [token, router]);

  useEffect(() => {
    verify();
  }, [verify]);

  if (error) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          Verifying access...
        </p>
      </div>
    );
  }

  return <GuestContext.Provider value={ctx}>{children}</GuestContext.Provider>;
}
