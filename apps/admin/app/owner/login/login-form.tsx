"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

export function OwnerLoginForm({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token");

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  // Auto-verify if token is in URL
  const { isLoading: verifying } = useQuery({
    queryKey: ["owner-verify-token", tokenParam],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/owner/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenParam }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { message?: string }).message ??
          (isEn ? "Invalid or expired link." : "Enlace inválido o expirado.");
        setError(msg);
        return null;
      }
      const data = await res.json();
      localStorage.setItem("owner_token", tokenParam!);
      localStorage.setItem(
        "owner_org_id",
        (data as { organization_id?: string }).organization_id ?? ""
      );
      router.push("/owner/dashboard");
      return data;
    },
    enabled: Boolean(tokenParam),
    retry: false,
  });

  const handleRequestAccess = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) return;

    setBusy(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/public/owner/request-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          (body as { message?: string }).message ??
            (isEn
              ? "Could not send access link."
              : "No se pudo enviar el enlace de acceso.")
        );
        return;
      }

      setSent(true);
    } catch {
      setError(
        isEn ? "Network error. Please try again." : "Error de red. Intenta de nuevo."
      );
    } finally {
      setBusy(false);
    }
  }, [email, isEn]);

  if (tokenParam && verifying) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="animate-pulse text-muted-foreground">
          {isEn ? "Verifying..." : "Verificando..."}
        </p>
      </div>
    );
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>
          {isEn ? "Owner Portal Access" : "Acceso Portal del Propietario"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent ? (
          <div className="space-y-2 text-center">
            <p className="text-sm">
              {isEn
                ? "An access link has been sent to your email. Check your inbox."
                : "Se envió un enlace de acceso a tu correo. Revisa tu bandeja de entrada."}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {isEn
                ? "Enter the email associated with your owner account to receive an access link."
                : "Ingresa el correo asociado a tu cuenta de propietario para recibir un enlace de acceso."}
            </p>
            <Input
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isEn ? "Email address" : "Correo electrónico"}
              type="email"
              value={email}
            />
            {error ? (
              <p className="text-sm text-red-600">{error}</p>
            ) : null}
            <Button
              className="w-full"
              disabled={busy || !email.trim()}
              onClick={handleRequestAccess}
            >
              {busy
                ? isEn
                  ? "Sending..."
                  : "Enviando..."
                : isEn
                  ? "Request Access Link"
                  : "Solicitar Enlace de Acceso"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
