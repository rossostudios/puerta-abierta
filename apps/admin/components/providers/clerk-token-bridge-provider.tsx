"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";

import { registerClerkClientTokenGetter } from "@/lib/auth/client-access-token";

export function ClerkTokenBridgeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { getToken } = useAuth();

  useEffect(() => {
    registerClerkClientTokenGetter(async () => (await getToken()) ?? null);
    return () => registerClerkClientTokenGetter(null);
  }, [getToken]);

  return <>{children}</>;
}

