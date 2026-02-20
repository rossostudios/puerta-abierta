"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type VerifyResult = {
  authenticated: boolean;
  reservation_id?: string | null;
  guest_id?: string | null;
};

type RequestAccessResult = {
  ok: boolean;
  detail?: string;
};

export function GuestLoginForm({ locale }: { locale: string }) {
  return (
    <Suspense fallback={null}>
      <GuestLoginFormInner locale={locale} />
    </Suspense>
  );
}

function GuestLoginFormInner({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const verifyQuery = useQuery<VerifyResult>({
    queryKey: ["guest-verify-token", tokenFromUrl],
    enabled: Boolean(tokenFromUrl),
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/guest/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenFromUrl }),
      });
      const data = (await res.json()) as VerifyResult;
      if (!res.ok) {
        throw new Error(
          isEn
            ? "Unable to verify access link."
            : "No se pudo verificar el enlace de acceso."
        );
      }
      return data;
    },
  });

  // Handle redirect + localStorage when verification succeeds (no setState)
  useEffect(() => {
    if (!verifyQuery.data) return;
    const data = verifyQuery.data;
    if (data.authenticated) {
      const resId = data.reservation_id;
      const gId = data.guest_id;
      let resStr = "";
      if (resId != null) resStr = resId;
      let gIdStr = "";
      if (gId != null) gIdStr = gId;
      localStorage.setItem("guest_token", tokenFromUrl);
      localStorage.setItem("guest_reservation_id", resStr);
      localStorage.setItem("guest_id", gIdStr);
      router.push(`/guest/${encodeURIComponent(tokenFromUrl)}/itinerary`);
    }
  }, [verifyQuery.data, tokenFromUrl, router]);

  const requestAccessMutation = useMutation<
    RequestAccessResult,
    Error,
    { email: string; phone: string }
  >({
    mutationFn: async (variables) => {
      const body: Record<string, string> = {};
      if (variables.email.trim()) body.email = variables.email.trim();
      if (variables.phone.trim()) body.phone_e164 = variables.phone.trim();

      const res = await fetch(`${API_BASE}/public/guest/request-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        return { ok: true };
      }
      const data = (await res.json()) as { detail?: string };
      const detail = data.detail;
      if (detail != null) {
        throw new Error(detail);
      }
      throw new Error(
        isEn
          ? "No active reservation found for these credentials."
          : "No se encontr\u00f3 una reserva activa para estas credenciales."
      );
    },
  });

  function handleRequestAccess(e: React.FormEvent) {
    e.preventDefault();
    requestAccessMutation.mutate({ email, phone });
  }

  const verifyError =
    verifyQuery.error instanceof Error ? verifyQuery.error.message : null;
  const verifyNotAuthenticated =
    verifyQuery.data && !verifyQuery.data.authenticated;
  const invalidMsg = isEn
    ? "Invalid or expired link. Request a new one."
    : "Enlace inv\u00e1lido o expirado. Solicita uno nuevo.";

  const displayError =
    requestAccessMutation.error?.message ??
    verifyError ??
    (verifyNotAuthenticated ? invalidMsg : null);

  const loading = verifyQuery.isLoading || requestAccessMutation.isPending;
  const sent = requestAccessMutation.isSuccess;

  if (tokenFromUrl && verifyQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="animate-pulse text-muted-foreground">
          {isEn ? "Verifying access..." : "Verificando acceso..."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl">
            {isEn ? "Guest Portal" : "Portal del Hu\u00e9sped"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-3 text-center">
              <p className="font-medium text-lg">
                {isEn ? "Check your WhatsApp!" : "\u00a1Revisa tu WhatsApp!"}
              </p>
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "We sent an access link to your registered phone number."
                  : "Enviamos un enlace de acceso a tu n\u00famero registrado."}
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleRequestAccess}>
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "Enter your email or phone number to receive an access link for your reservation."
                  : "Ingresa tu correo o n\u00famero de tel\u00e9fono para recibir un enlace de acceso a tu reserva."}
              </p>
              <label className="space-y-1 text-sm">
                <span>{isEn ? "Email" : "Correo electr\u00f3nico"}</span>
                <Input
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  type="email"
                  value={email}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>
                  {isEn ? "Or phone number" : "O n\u00famero de tel\u00e9fono"}
                </span>
                <Input
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+595 981 123456"
                  type="tel"
                  value={phone}
                />
              </label>
              {displayError && (
                <p className="text-red-600 text-sm">{displayError}</p>
              )}
              <Button
                className="w-full"
                disabled={loading || !(email.trim() || phone.trim())}
                type="submit"
              >
                {requestAccessMutation.isPending
                  ? isEn
                    ? "Sending..."
                    : "Enviando..."
                  : isEn
                    ? "Send access link"
                    : "Enviar enlace de acceso"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
