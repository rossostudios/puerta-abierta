"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type TenantVerifyResult = {
  authenticated: boolean;
  lease_id?: string | null;
  email?: string | null;
};

type RequestAccessResult = {
  ok: boolean;
  detail?: string;
};

export function TenantLoginForm({ locale }: { locale: string }) {
  return (
    <Suspense fallback={null}>
      <TenantLoginFormInner locale={locale} />
    </Suspense>
  );
}

function TenantLoginFormInner({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const [email, setEmail] = useState("");

  const verifyQuery = useQuery<TenantVerifyResult>({
    queryKey: ["tenant-verify-token", tokenFromUrl],
    enabled: Boolean(tokenFromUrl),
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/tenant/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenFromUrl }),
      });
      const data = (await res.json()) as TenantVerifyResult;
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
      const leaseId = data.lease_id;
      const emailVal = data.email;
      let leaseStr = "";
      if (leaseId != null) leaseStr = leaseId;
      let emailStr = "";
      if (emailVal != null) emailStr = emailVal;
      localStorage.setItem("tenant_token", tokenFromUrl);
      localStorage.setItem("tenant_lease_id", leaseStr);
      localStorage.setItem("tenant_email", emailStr);
      router.push("/tenant/dashboard");
    }
  }, [verifyQuery.data, tokenFromUrl, router]);

  const requestAccessMutation = useMutation<
    RequestAccessResult,
    Error,
    { email: string }
  >({
    mutationFn: async (variables) => {
      const res = await fetch(`${API_BASE}/public/tenant/request-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: variables.email }),
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
          ? "No active lease found for this email."
          : "No se encontr\u00f3 un contrato activo para este correo."
      );
    },
  });

  function handleRequestAccess(e: React.FormEvent) {
    e.preventDefault();
    requestAccessMutation.mutate({ email });
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
            {isEn ? "Tenant Portal" : "Portal del Inquilino"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-3 text-center">
              <p className="font-medium text-lg">
                {isEn ? "Check your WhatsApp!" : "Revisa tu WhatsApp!"}
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
                  ? "Enter the email associated with your lease to receive an access link."
                  : "Ingresa el correo asociado a tu contrato para recibir un enlace de acceso."}
              </p>
              <label className="space-y-1 text-sm">
                <span>{isEn ? "Email" : "Correo electr\u00f3nico"}</span>
                <Input
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  required
                  type="email"
                  value={email}
                />
              </label>
              {displayError && (
                <p className="text-red-600 text-sm">{displayError}</p>
              )}
              <Button className="w-full" disabled={loading} type="submit">
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
