"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type GuestContextValue = {
  token: string;
  reservationId: string;
  guestId: string;
  headers: Record<string, string>;
  apiBase: string;
};

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
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-red-600">Unable to verify access.</p>
      </div>
    );
  }

  if (isLoading || !ctx) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="animate-pulse text-muted-foreground">
          Verifying access...
        </p>
      </div>
    );
  }

  return <GuestContext.Provider value={ctx}>{children}</GuestContext.Provider>;
}
