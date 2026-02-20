"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/api-client";

type SendGuestPortalLinkProps = {
  reservationId: string;
  isEn: boolean;
};

export function SendGuestPortalLink({
  reservationId,
  isEn,
}: SendGuestPortalLinkProps) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    setLoading(true);
    setError("");
    const fallbackMsg = isEn
      ? "Failed to send link."
      : "No se pudo enviar el enlace.";
    try {
      await authedFetch<{ message: string }>(
        `/reservations/${encodeURIComponent(reservationId)}/guest-portal-link`,
        { method: "POST" }
      );
      setSent(true);
      setLoading(false);
    } catch (err) {
      let msg = fallbackMsg;
      if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <p className="text-green-600 text-sm">
        {isEn
          ? "Guest portal link sent!"
          : "¡Enlace del portal de huésped enviado!"}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        className="w-full justify-start"
        disabled={loading}
        onClick={handleSend}
        size="sm"
        variant="outline"
      >
        {loading
          ? isEn
            ? "Sending..."
            : "Enviando..."
          : isEn
            ? "Send Guest Portal Link"
            : "Enviar Enlace Portal Huésped"}
      </Button>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
