"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import Image from "next/image";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { useActiveLocale } from "@/lib/i18n/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type TotpFactor = {
  id: string;
  friendly_name: string;
  status: string;
  created_at: string;
};

export function SecuritySettings({
  totpFactors: initialFactors,
  userEmail,
}: {
  totpFactors: TotpFactor[];
  userEmail: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const [factors, setFactors] = useState(initialFactors);
  const [enrolling, setEnrolling] = useState(false);
  const [qrUri, setQrUri] = useState("");
  const [factorId, setFactorId] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [busy, setBusy] = useState(false);

  const hasVerifiedTotp = factors.some((f) => f.status === "verified");

  const handleEnroll = useCallback(async () => {
    setEnrolling(true);
    setBusy(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });

      if (error) {
        toast.error(
          isEn ? "Could not start enrollment" : "No se pudo iniciar la inscripción",
          { description: error.message }
        );
        setEnrolling(false);
        setBusy(false);
        return;
      }

      setQrUri(data.totp.qr_code);
      setFactorId(data.id);
    } catch {
      toast.error(isEn ? "Enrollment failed" : "Falló la inscripción");
    } finally {
      setBusy(false);
    }
  }, [isEn]);

  const handleVerify = useCallback(async () => {
    if (!factorId || !verifyCode.trim()) return;

    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) {
        toast.error(
          isEn ? "Challenge failed" : "Falló el desafío",
          { description: challenge.error.message }
        );
        setBusy(false);
        return;
      }

      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: verifyCode.trim(),
      });

      if (verify.error) {
        toast.error(
          isEn ? "Verification failed" : "Falló la verificación",
          { description: verify.error.message }
        );
        setBusy(false);
        return;
      }

      toast.success(
        isEn
          ? "Two-factor authentication enabled"
          : "Autenticación de dos factores activada"
      );

      // Refresh factors list
      const refreshed = await supabase.auth.mfa.listFactors();
      setFactors(
        (refreshed.data?.totp ?? []).map((f) => ({
          id: f.id,
          friendly_name: f.friendly_name ?? "",
          status: f.status,
          created_at: f.created_at,
        }))
      );

      setEnrolling(false);
      setQrUri("");
      setFactorId("");
      setVerifyCode("");
    } catch {
      toast.error(isEn ? "Verification failed" : "Falló la verificación");
    } finally {
      setBusy(false);
    }
  }, [factorId, verifyCode, isEn]);

  const handleUnenroll = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
        if (error) {
          toast.error(
            isEn ? "Could not remove factor" : "No se pudo eliminar el factor",
            { description: error.message }
          );
          setBusy(false);
          return;
        }

        toast.success(
          isEn
            ? "Two-factor authentication removed"
            : "Autenticación de dos factores eliminada"
        );
        setFactors((prev) => prev.filter((f) => f.id !== id));
      } catch {
        toast.error(isEn ? "Remove failed" : "Error al eliminar");
      } finally {
        setBusy(false);
      }
    },
    [isEn]
  );

  return (
    <div className="space-y-6">
      {/* Account info */}
      <div className="text-sm text-muted-foreground">
        {isEn ? "Signed in as" : "Sesión iniciada como"}{" "}
        <span className="font-medium text-foreground">{userEmail}</span>
      </div>

      {/* 2FA section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {isEn
              ? "Two-Factor Authentication (2FA)"
              : "Autenticación de Dos Factores (2FA)"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Add an extra layer of security using an authenticator app."
              : "Agrega una capa adicional de seguridad con una app autenticadora."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing factors */}
          {factors.length > 0 ? (
            <div className="space-y-2">
              {factors.map((f) => (
                <div
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                  key={f.id}
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {f.friendly_name || "Authenticator"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isEn ? "Added" : "Agregado"}{" "}
                      {new Date(f.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      label={f.status}
                      tone={f.status === "verified" ? "success" : "warning"}
                      value={f.status}
                    />
                    <Button
                      disabled={busy}
                      onClick={() => handleUnenroll(f.id)}
                      size="sm"
                      variant="destructive"
                    >
                      {isEn ? "Remove" : "Eliminar"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Enrollment flow */}
          {!hasVerifiedTotp && !enrolling ? (
            <Button disabled={busy} onClick={handleEnroll}>
              {isEn ? "Enable 2FA" : "Activar 2FA"}
            </Button>
          ) : null}

          {enrolling && qrUri ? (
            <div className="space-y-4">
              <p className="text-sm">
                {isEn
                  ? "Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):"
                  : "Escanea este código QR con tu app autenticadora (Google Authenticator, Authy, etc.):"}
              </p>

              <div className="flex justify-center rounded-lg border bg-white p-4">
                <Image
                  alt="TOTP QR Code"
                  className="h-48 w-48"
                  height={192}
                  src={qrUri}
                  unoptimized
                  width={192}
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {isEn
                    ? "Enter the 6-digit code from your app:"
                    : "Ingresa el código de 6 dígitos de tu app:"}
                </p>
                <div className="flex gap-2">
                  <Input
                    className="max-w-40 font-mono tracking-widest"
                    maxLength={6}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    placeholder="000000"
                    value={verifyCode}
                  />
                  <Button
                    disabled={busy || verifyCode.trim().length < 6}
                    onClick={handleVerify}
                  >
                    {isEn ? "Verify" : "Verificar"}
                  </Button>
                </div>
              </div>

              <Button
                onClick={() => {
                  setEnrolling(false);
                  setQrUri("");
                  setFactorId("");
                  setVerifyCode("");
                }}
                variant="ghost"
              >
                {isEn ? "Cancel" : "Cancelar"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Sessions section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {isEn ? "Active Sessions" : "Sesiones Activas"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "These are the devices currently logged into your account."
              : "Estos son los dispositivos actualmente conectados a tu cuenta."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {isEn ? "Current session" : "Sesión actual"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isEn ? "This browser" : "Este navegador"}
                </p>
              </div>
              <StatusBadge label="active" tone="success" value="active" />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {isEn
              ? "Sign out from all other devices by signing out and signing back in."
              : "Cierra sesión en otros dispositivos cerrando sesión y volviendo a iniciar."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
