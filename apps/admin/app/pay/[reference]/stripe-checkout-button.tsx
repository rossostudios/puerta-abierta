"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

export function StripeCheckoutButton({
  referenceCode,
  formattedAmount,
  isEn,
}: {
  referenceCode: string;
  formattedAmount: string;
  isEn: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/public/payment/${referenceCode}/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            success_url: `${window.location.origin}/pay/${referenceCode}?success=1`,
            cancel_url: `${window.location.origin}/pay/${referenceCode}?cancelled=1`,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as Record<string, string>).detail ||
            (isEn ? "Payment unavailable" : "Pago no disponible")
        );
      }
      const data = (await res.json()) as Record<string, string>;
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={loading}
        onClick={handleCheckout}
        size="lg"
      >
        {loading
          ? isEn
            ? "Redirecting..."
            : "Redirigiendo..."
          : isEn
            ? `Pay ${formattedAmount} with Card`
            : `Pagar ${formattedAmount} con Tarjeta`}
      </Button>
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
