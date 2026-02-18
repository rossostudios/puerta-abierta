"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import Image from "next/image";

import { AvailabilityCalendar } from "@/components/booking/availability-calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type OrgInfo = {
  id: string;
  name: string;
  brand_color: string | null;
  logo_url: string | null;
};

type UnitOption = {
  id: string;
  name: string;
  property_name: string;
};

type BookingState = "form" | "submitting" | "confirmed" | "error";

export function BookingPage({
  orgSlug,
  locale,
}: {
  orgSlug: string;
  locale: string;
}) {
  const isEn = locale === "en-US";

  // Fetch org + units
  const {
    data: bookingData,
    isLoading: loading,
    error: fetchQueryError,
  } = useQuery({
    queryKey: ["booking-page", orgSlug],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/public/booking/${encodeURIComponent(orgSlug)}`
      );
      if (!res.ok) {
        throw new Error(
          isEn
            ? "Booking is not available for this organization."
            : "Las reservas no están disponibles para esta organización."
        );
      }
      const data = await res.json();
      const orgData = data.organization ?? data;
      const org: OrgInfo = {
        id: asString(orgData.id),
        name: asString(orgData.name),
        brand_color: asString(orgData.brand_color) || null,
        logo_url: asString(orgData.logo_url) || null,
      };
      const unitRows = (data.units ?? []) as Record<string, unknown>[];
      const units: UnitOption[] = unitRows
        .map((u) => ({
          id: asString(u.id),
          name: asString(u.name) || asString(u.code),
          property_name: asString(u.property_name),
        }))
        .filter((u) => u.id);
      return { org, units };
    },
    retry: false,
  });

  const org = bookingData?.org ?? null;
  const units = bookingData?.units ?? [];
  const fetchError = fetchQueryError?.message ?? null;

  // Form state
  const [unitId, setUnitId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [numGuests, setNumGuests] = useState(1);
  const [notes, setNotes] = useState("");
  const [bookingState, setBookingState] = useState<BookingState>("form");
  const [bookingError, setBookingError] = useState("");
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diff = Math.ceil((end.getTime() - start.getTime()) / 86400000);
    return diff > 0 ? diff : 0;
  }, [checkIn, checkOut]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!unitId || !checkIn || !checkOut || !guestName) return;

      setBookingState("submitting");
      setBookingError("");

      try {
        const res = await fetch(
          `${API_BASE}/public/booking/${encodeURIComponent(orgSlug)}/reserve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              unit_id: unitId,
              check_in_date: checkIn,
              check_out_date: checkOut,
              guest_full_name: guestName,
              guest_email: guestEmail || undefined,
              guest_phone_e164: guestPhone || undefined,
              num_guests: numGuests,
              notes: notes || undefined,
            }),
          }
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg = asString(body.error) || asString(body.message) || "Booking failed";
          setBookingError(msg);
          setBookingState("error");
          return;
        }

        const body = await res.json().catch(() => ({}));
        if (body.payment_url) {
          setPaymentUrl(asString(body.payment_url));
        }
        setBookingState("confirmed");
      } catch {
        setBookingError(
          isEn ? "Network error. Please try again." : "Error de red. Intenta de nuevo."
        );
        setBookingState("error");
      }
    },
    [unitId, checkIn, checkOut, guestName, guestEmail, guestPhone, numGuests, notes, orgSlug, isEn]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="animate-pulse text-muted-foreground">
          {isEn ? "Loading..." : "Cargando..."}
        </p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{fetchError}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (bookingState === "confirmed") {
    const brandColor = org?.brand_color || "#DA1E37";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardContent className="space-y-4 py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <span className="text-3xl">&#10003;</span>
            </div>
            <h2 className="text-xl font-semibold">
              {isEn ? "Booking Confirmed!" : "Reserva Confirmada!"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {isEn
                ? `Thank you, ${guestName}. Your booking request has been submitted and is pending confirmation.`
                : `Gracias, ${guestName}. Tu solicitud de reserva fue enviada y está pendiente de confirmación.`}
            </p>
            <p className="text-sm">
              {checkIn} &rarr; {checkOut} ({nights}{" "}
              {isEn ? "nights" : "noches"})
            </p>
            {paymentUrl ? (
              <a
                className="inline-flex items-center justify-center rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90"
                href={paymentUrl}
                style={{ backgroundColor: brandColor }}
              >
                {isEn ? "Pay Deposit" : "Pagar Depósito"}
              </a>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  const brandColor = org?.brand_color || "#DA1E37";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div
        className="border-b px-4 py-4 sm:px-6"
        style={{ borderColor: `${brandColor}30` }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {org?.logo_url ? (
            <Image
              alt={org.name}
              className="h-8 w-8 rounded object-contain"
              height={32}
              src={org.logo_url}
              unoptimized
              width={32}
            />
          ) : null}
          <h1 className="text-lg font-semibold">{org?.name}</h1>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "Book Your Stay" : "Reserva tu Estadía"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              {/* Unit selection */}
              <label className="block space-y-1 text-sm">
                <span className="font-medium">
                  {isEn ? "Unit" : "Unidad"}
                </span>
                <Select
                  onChange={(e) => setUnitId(e.target.value)}
                  required
                  value={unitId}
                >
                  <option disabled value="">
                    {isEn ? "Select a unit" : "Selecciona una unidad"}
                  </option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {[u.property_name, u.name].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </Select>
              </label>

              {/* Availability calendar */}
              {unitId ? (
                <AvailabilityCalendar
                  brandColor={brandColor}
                  isEn={isEn}
                  onDateRangeSelect={(ci, co) => {
                    setCheckIn(ci);
                    setCheckOut(co);
                  }}
                  orgSlug={orgSlug}
                  unitId={unitId}
                />
              ) : null}

              {/* Dates */}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">
                    {isEn ? "Check-in" : "Entrada"}
                  </span>
                  <Input
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setCheckIn(e.target.value)}
                    required
                    type="date"
                    value={checkIn}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">
                    {isEn ? "Check-out" : "Salida"}
                  </span>
                  <Input
                    min={checkIn || new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setCheckOut(e.target.value)}
                    required
                    type="date"
                    value={checkOut}
                  />
                </label>
              </div>

              {nights > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {nights} {isEn ? "nights" : "noches"}
                </p>
              ) : null}

              {/* Guest info */}
              <label className="block space-y-1 text-sm">
                <span className="font-medium">
                  {isEn ? "Full name" : "Nombre completo"}
                </span>
                <Input
                  onChange={(e) => setGuestName(e.target.value)}
                  required
                  value={guestName}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">
                    {isEn ? "Email" : "Correo"}
                  </span>
                  <Input
                    onChange={(e) => setGuestEmail(e.target.value)}
                    type="email"
                    value={guestEmail}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">
                    {isEn ? "Phone" : "Teléfono"}
                  </span>
                  <Input
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="+595..."
                    value={guestPhone}
                  />
                </label>
              </div>

              <label className="block space-y-1 text-sm">
                <span className="font-medium">
                  {isEn ? "Number of guests" : "Número de huéspedes"}
                </span>
                <Input
                  max={20}
                  min={1}
                  onChange={(e) => setNumGuests(Number(e.target.value) || 1)}
                  type="number"
                  value={numGuests}
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="font-medium">
                  {isEn ? "Notes (optional)" : "Notas (opcional)"}
                </span>
                <Textarea
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  value={notes}
                />
              </label>

              {bookingError ? (
                <div className="rounded-lg border border-red-200/60 bg-red-50/40 px-3 py-2 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-400">
                  {bookingError}
                </div>
              ) : null}

              <Button
                className="w-full"
                disabled={bookingState === "submitting"}
                style={{ backgroundColor: brandColor }}
                type="submit"
              >
                {bookingState === "submitting"
                  ? isEn
                    ? "Submitting..."
                    : "Enviando..."
                  : isEn
                    ? "Book Now"
                    : "Reservar Ahora"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
