"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

export function GuestLoginForm({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const verifyToken = useCallback(
    async (token: string) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_BASE}/public/guest/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data.authenticated) {
          localStorage.setItem("guest_token", token);
          localStorage.setItem(
            "guest_reservation_id",
            data.reservation_id ?? ""
          );
          localStorage.setItem("guest_id", data.guest_id ?? "");
          router.push(`/guest/${encodeURIComponent(token)}/itinerary`);
        } else {
          setError(
            isEn
              ? "Invalid or expired link. Request a new one."
              : "Enlace inválido o expirado. Solicita uno nuevo."
          );
        }
      } catch {
        setError(
          isEn
            ? "Unable to verify access link."
            : "No se pudo verificar el enlace de acceso."
        );
      } finally {
        setLoading(false);
      }
    },
    [isEn, router]
  );

  useEffect(() => {
    if (tokenFromUrl) {
      verifyToken(tokenFromUrl);
    }
  }, [tokenFromUrl, verifyToken]);

  async function handleRequestAccess(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body: Record<string, string> = {};
      if (email.trim()) body.email = email.trim();
      if (phone.trim()) body.phone_e164 = phone.trim();

      const res = await fetch(`${API_BASE}/public/guest/request-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const data = await res.json();
        setError(
          data.detail ??
            (isEn
              ? "No active reservation found for these credentials."
              : "No se encontró una reserva activa para estas credenciales.")
        );
      }
    } catch {
      setError(
        isEn
          ? "Request failed. Try again."
          : "Error al solicitar. Intenta de nuevo."
      );
    } finally {
      setLoading(false);
    }
  }

  if (tokenFromUrl && loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
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
            {isEn ? "Guest Portal" : "Portal del Huésped"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-3 text-center">
              <p className="text-lg font-medium">
                {isEn ? "Check your WhatsApp!" : "¡Revisa tu WhatsApp!"}
              </p>
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "We sent an access link to your registered phone number."
                  : "Enviamos un enlace de acceso a tu número registrado."}
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleRequestAccess}>
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "Enter your email or phone number to receive an access link for your reservation."
                  : "Ingresa tu correo o número de teléfono para recibir un enlace de acceso a tu reserva."}
              </p>
              <label className="space-y-1 text-sm">
                <span>{isEn ? "Email" : "Correo electrónico"}</span>
                <Input
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  type="email"
                  value={email}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>
                  {isEn ? "Or phone number" : "O número de teléfono"}
                </span>
                <Input
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+595 981 123456"
                  type="tel"
                  value={phone}
                />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button
                className="w-full"
                disabled={loading || (!email.trim() && !phone.trim())}
                type="submit"
              >
                {loading
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
