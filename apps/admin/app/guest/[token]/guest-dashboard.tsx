"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useActiveLocale } from "@/lib/i18n/client";

import { useGuest } from "./layout";

/* ---------- Types ---------- */

type ItineraryData = {
  reservation: Record<string, unknown>;
  guest: Record<string, unknown> | null;
  unit: Record<string, unknown> | null;
  property: Record<string, unknown> | null;
};

type CheckinData = {
  check_in_date: string | null;
  check_out_date: string | null;
  status: string | null;
  property_name: string | null;
  property_address: string | null;
  property_city: string | null;
  unit_name: string | null;
  wifi_network: string | null;
  wifi_password: string | null;
  check_in_instructions: string | null;
  house_rules: string | null;
  emergency_contact: string | null;
};

type AccessCode = {
  id: string;
  code: string;
  label?: string | null;
  device_name?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
};

type Message = {
  id: string;
  created_at: string;
  payload?: {
    body?: string;
    direction?: string;
    sender_name?: string;
  };
};

/* ---------- Helpers ---------- */

function str(
  obj: Record<string, unknown> | null | undefined,
  key: string
): string {
  if (!obj) return "";
  const v = obj[key];
  return typeof v === "string" ? v.trim() : "";
}

function fmtDate(raw: string | null | undefined, locale: string): string {
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return raw;
  }
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "confirmed":
    case "active":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "pending":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "cancelled":
    case "canceled":
      return "bg-red-100 text-red-800 border-red-200";
    case "completed":
    case "checked_out":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-blue-100 text-blue-800 border-blue-200";
  }
}

/* ---------- Section: ActivePanel type ---------- */

type ActivePanel = "none" | "service" | "rules";

/* ---------- Main dashboard ---------- */

export function GuestDashboard() {
  const { token, headers, apiBase } = useGuest();
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const _queryClient = useQueryClient();

  const [activePanel, setActivePanel] = useState<ActivePanel>("none");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Service request form state
  const [srCategory, setSrCategory] = useState("maintenance");
  const [srDescription, setSrDescription] = useState("");

  /* -- Itinerary query -- */
  const { data: itinerary, isLoading: itLoading } = useQuery({
    queryKey: ["guest-itinerary", token],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/guest/itinerary`, { headers });
      if (!res.ok) throw new Error("Failed");
      return (await res.json()) as ItineraryData;
    },
  });

  /* -- Checkin info query -- */
  const { data: checkin, isLoading: ciLoading } = useQuery({
    queryKey: ["guest-checkin-info", token],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/guest/checkin-info`, { headers });
      if (!res.ok) throw new Error("Failed");
      return (await res.json()) as CheckinData;
    },
  });

  /* -- Access codes query -- */
  const { data: accessCodes = [] } = useQuery({
    queryKey: ["guest-access-codes", token],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/guest/access-codes`, { headers });
      if (!res.ok) return [];
      const json = await res.json();
      return (
        Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : []
      ) as AccessCode[];
    },
  });

  /* -- Messages query (last 5) -- */
  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ["guest-messages", token],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/guest/messages`, { headers });
      if (!res.ok) return [];
      const json = await res.json();
      const items = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : [];
      return (items as Message[]).slice(0, 5);
    },
  });

  /* -- Service request mutation -- */
  const srMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${apiBase}/guest/request-service`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          category: srCategory,
          description: srDescription.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      return res.json();
    },
    onSuccess: () => {
      setSrDescription("");
      setSrCategory("maintenance");
      setActivePanel("none");
    },
  });

  /* -- Copy to clipboard -- */
  const copyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  }, []);

  /* -- Derived values -- */
  const reservation = itinerary?.reservation;
  const guestName = str(itinerary?.guest, "full_name");
  const propertyName =
    str(itinerary?.property, "name") || checkin?.property_name || "";
  const unitName = str(itinerary?.unit, "name") || checkin?.unit_name || "";
  const checkIn =
    str(reservation, "check_in_date") || checkin?.check_in_date || "";
  const checkOut =
    str(reservation, "check_out_date") || checkin?.check_out_date || "";
  const status = str(reservation, "status") || checkin?.status || "";
  const adults = reservation?.adults ?? 1;
  const children = reservation?.children ?? 0;

  const loading = itLoading && ciLoading;

  /* -- Category labels -- */
  const categories = [
    { value: "cleaning", label: isEn ? "Cleaning" : "Limpieza" },
    { value: "maintenance", label: isEn ? "Maintenance" : "Mantenimiento" },
    { value: "supplies", label: isEn ? "Supplies" : "Suministros" },
    { value: "other", label: isEn ? "Other" : "Otro" },
  ];

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {/* -- Welcome header -- */}
      <div>
        <h1 className="font-bold text-2xl tracking-tight sm:text-3xl">
          {guestName
            ? isEn
              ? `Welcome, ${guestName}`
              : `Bienvenido, ${guestName}`
            : isEn
              ? "Your Stay"
              : "Tu Estadia"}
        </h1>
        {propertyName && (
          <p className="mt-1 text-muted-foreground text-sm">
            {propertyName}
            {unitName ? ` \u2014 ${unitName}` : ""}
          </p>
        )}
      </div>

      {/* -- Reservation details card -- */}
      <Card className="overflow-hidden border-0 shadow-md">
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base sm:text-lg">
              {isEn ? "Reservation" : "Reserva"}
            </CardTitle>
            {status && (
              <Badge
                className={`capitalize ${statusColor(status)} border text-[11px]`}
                variant="outline"
              >
                {status}
              </Badge>
            )}
          </div>
        </div>
        <CardContent className="grid gap-4 px-5 pt-3 pb-5 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Check-in" : "Entrada"}
            </span>
            <p className="mt-0.5 font-semibold text-[15px]">
              {fmtDate(checkIn, locale) || "\u2014"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Check-out" : "Salida"}
            </span>
            <p className="mt-0.5 font-semibold text-[15px]">
              {fmtDate(checkOut, locale) || "\u2014"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Guests" : "Huespedes"}
            </span>
            <p className="mt-0.5 font-medium">
              {String(adults)}{" "}
              {isEn
                ? Number(adults) !== 1
                  ? "adults"
                  : "adult"
                : Number(adults) !== 1
                  ? "adultos"
                  : "adulto"}
              {Number(children) > 0
                ? `, ${String(children)} ${isEn ? (Number(children) !== 1 ? "children" : "child") : Number(children) !== 1 ? "ninos" : "nino"}`
                : ""}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Property" : "Propiedad"}
            </span>
            <p className="mt-0.5 font-medium">{propertyName || "\u2014"}</p>
          </div>
        </CardContent>
      </Card>

      {/* -- Access code(s) -- */}
      {accessCodes.length > 0 && (
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isEn ? "Access Code" : "Codigo de Acceso"}
            </CardTitle>
            <CardDescription className="text-xs">
              {isEn
                ? "Tap the code to copy it to your clipboard"
                : "Toca el codigo para copiarlo"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {accessCodes.map((ac) => (
              <button
                className="group flex w-full items-center justify-between rounded-xl border border-primary/30 border-dashed bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10 active:bg-primary/15"
                key={ac.id}
                onClick={() => copyCode(ac.code)}
                type="button"
              >
                <div className="text-left">
                  {(ac.label || ac.device_name) && (
                    <p className="mb-0.5 text-muted-foreground text-xs">
                      {ac.label || ac.device_name}
                    </p>
                  )}
                  <span className="font-bold font-mono text-2xl text-primary tracking-[0.15em] sm:text-3xl">
                    {ac.code}
                  </span>
                </div>
                <span className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 font-medium text-primary text-xs transition-colors group-hover:bg-primary/20">
                  {copiedCode === ac.code
                    ? isEn
                      ? "Copied!"
                      : "Copiado!"
                    : isEn
                      ? "Copy"
                      : "Copiar"}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* -- WiFi info (if available from checkin) -- */}
      {checkin && (checkin.wifi_network || checkin.wifi_password) && (
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">WiFi</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            {checkin.wifi_network && (
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Network" : "Red"}
                </span>
                <p className="mt-0.5 font-medium font-mono">
                  {checkin.wifi_network}
                </p>
              </div>
            )}
            {checkin.wifi_password && (
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Password" : "Contrasena"}
                </span>
                <button
                  className="mt-0.5 block cursor-pointer text-left font-medium font-mono transition-colors hover:text-primary"
                  onClick={() => {
                    navigator.clipboard.writeText(checkin.wifi_password!);
                    setCopiedCode("wifi");
                    setTimeout(() => setCopiedCode(null), 2000);
                  }}
                  type="button"
                >
                  {checkin.wifi_password}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {copiedCode === "wifi"
                      ? isEn
                        ? "(Copied!)"
                        : "(Copiado!)"
                      : isEn
                        ? "(tap to copy)"
                        : "(toca para copiar)"}
                  </span>
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* -- Quick action buttons -- */}
      <div className="grid grid-cols-3 gap-3">
        <button
          className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center transition-all ${
            activePanel === "service"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border/60 bg-card hover:border-primary/40 hover:shadow-sm"
          }`}
          onClick={() =>
            setActivePanel(activePanel === "service" ? "none" : "service")
          }
          type="button"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-lg">
            <svg
              className="text-orange-600"
              fill="none"
              height="20"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </span>
          <span className="font-medium text-xs leading-tight">
            {isEn ? "Service Request" : "Solicitud"}
          </span>
        </button>

        <Link
          className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-4 text-center transition-all hover:border-primary/40 hover:shadow-sm"
          href={`/guest/${encodeURIComponent(token)}/messages`}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-lg">
            <svg
              className="text-blue-600"
              fill="none"
              height="20"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span className="font-medium text-xs leading-tight">
            {isEn ? "Messages" : "Mensajes"}
          </span>
        </Link>

        <button
          className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center transition-all ${
            activePanel === "rules"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border/60 bg-card hover:border-primary/40 hover:shadow-sm"
          }`}
          onClick={() =>
            setActivePanel(activePanel === "rules" ? "none" : "rules")
          }
          type="button"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-lg">
            <svg
              className="text-violet-600"
              fill="none"
              height="20"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </span>
          <span className="font-medium text-xs leading-tight">
            {isEn ? "House Rules" : "Reglas"}
          </span>
        </button>
      </div>

      {/* -- Service request form (expandable) -- */}
      {activePanel === "service" && (
        <Card className="fade-in slide-in-from-top-2 animate-in border-primary/20 shadow-md duration-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isEn ? "Service Request" : "Solicitud de Servicio"}
            </CardTitle>
            <CardDescription className="text-xs">
              {isEn
                ? "Tell us what you need and we'll take care of it"
                : "Cuentanos que necesitas y nos encargamos"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!srDescription.trim()) return;
                srMutation.mutate();
              }}
            >
              <div className="space-y-1.5">
                <label className="font-medium text-sm" htmlFor="sr-category">
                  {isEn ? "Category" : "Categoria"}
                </label>
                <Select
                  id="sr-category"
                  onChange={(e) => setSrCategory(e.target.value)}
                  value={srCategory}
                >
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="font-medium text-sm" htmlFor="sr-desc">
                  {isEn ? "Description" : "Descripcion"}
                </label>
                <Textarea
                  id="sr-desc"
                  maxLength={1000}
                  onChange={(e) => setSrDescription(e.target.value)}
                  placeholder={
                    isEn
                      ? "Describe what you need..."
                      : "Describe lo que necesitas..."
                  }
                  rows={3}
                  value={srDescription}
                />
              </div>

              {srMutation.isError && (
                <p className="text-red-600 text-sm">
                  {isEn
                    ? "Could not submit request. Please try again."
                    : "No se pudo enviar. Intenta de nuevo."}
                </p>
              )}

              {srMutation.isSuccess && (
                <p className="text-emerald-600 text-sm">
                  {isEn
                    ? "Request submitted successfully!"
                    : "Solicitud enviada con exito!"}
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={!srDescription.trim() || srMutation.isPending}
                  type="submit"
                >
                  {srMutation.isPending
                    ? isEn
                      ? "Sending..."
                      : "Enviando..."
                    : isEn
                      ? "Submit Request"
                      : "Enviar Solicitud"}
                </Button>
                <Button
                  onClick={() => setActivePanel("none")}
                  type="button"
                  variant="outline"
                >
                  {isEn ? "Cancel" : "Cancelar"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* -- House rules panel (expandable) -- */}
      {activePanel === "rules" && (
        <Card className="fade-in slide-in-from-top-2 animate-in border-violet-200 shadow-md duration-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isEn ? "House Rules" : "Reglas de la Casa"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {checkin?.house_rules ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {checkin.house_rules}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "No house rules have been provided for this property."
                  : "No se han proporcionado reglas para esta propiedad."}
              </p>
            )}
            {checkin?.emergency_contact && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="font-medium text-red-800 text-xs uppercase tracking-wide">
                  {isEn ? "Emergency Contact" : "Contacto de Emergencia"}
                </p>
                <p className="mt-1 font-semibold text-red-900 text-sm">
                  {checkin.emergency_contact}
                </p>
              </div>
            )}
            <Button
              className="mt-4 w-full"
              onClick={() => setActivePanel("none")}
              variant="outline"
            >
              {isEn ? "Close" : "Cerrar"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* -- Check-in instructions (if available) -- */}
      {checkin?.check_in_instructions && (
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isEn ? "Check-in Instructions" : "Instrucciones de Entrada"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {checkin.check_in_instructions}
            </p>
          </CardContent>
        </Card>
      )}

      {/* -- Messages panel -- */}
      <Card className="border-0 shadow-md">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">
              {isEn ? "Messages" : "Mensajes"}
            </CardTitle>
            <CardDescription className="text-xs">
              {isEn ? "Recent conversation" : "Conversacion reciente"}
            </CardDescription>
          </div>
          <Link href={`/guest/${encodeURIComponent(token)}/messages`}>
            <Button className="text-xs" size="sm" variant="ghost">
              {isEn ? "View All" : "Ver Todos"}
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {msgsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-3/4 rounded-xl" />
              <Skeleton className="ml-auto h-10 w-2/3 rounded-xl" />
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-xl bg-muted/30 py-6 text-center">
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "No messages yet. Tap Messages above to start a conversation."
                  : "Sin mensajes. Toca Mensajes arriba para iniciar."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((msg) => {
                const isInbound = msg.payload?.direction === "inbound";
                const body =
                  msg.payload?.body ??
                  (typeof msg.payload === "string" ? msg.payload : "");
                const sender = msg.payload?.sender_name;
                const time = msg.created_at
                  ? new Date(msg.created_at).toLocaleString(locale, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";

                return (
                  <div
                    className={`flex ${isInbound ? "justify-end" : "justify-start"}`}
                    key={msg.id}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        isInbound
                          ? "bg-primary/10 text-foreground"
                          : "bg-muted/50 text-foreground"
                      }`}
                    >
                      {sender && (
                        <p className="mb-0.5 font-medium text-[11px] text-muted-foreground">
                          {sender}
                        </p>
                      )}
                      <p className="line-clamp-2 whitespace-pre-wrap">{body}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {time}
                      </p>
                    </div>
                  </div>
                );
              })}
              <Link
                className="mt-2 block text-center"
                href={`/guest/${encodeURIComponent(token)}/messages`}
              >
                <Button className="w-full" size="sm" variant="outline">
                  {isEn ? "Open Conversation" : "Abrir Conversacion"}
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* -- Quick links row -- */}
      <div className="grid grid-cols-2 gap-3">
        <Link href={`/guest/${encodeURIComponent(token)}/checkin`}>
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 transition-all hover:border-primary/40 hover:shadow-sm">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <svg
                className="text-emerald-600"
                fill="none"
                height="18"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                width="18"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-sm">
                {isEn ? "Check-in Info" : "Info de Entrada"}
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                {isEn ? "Instructions & map" : "Instrucciones y mapa"}
              </span>
            </span>
          </div>
        </Link>
        <Link href={`/guest/${encodeURIComponent(token)}/itinerary`}>
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 transition-all hover:border-primary/40 hover:shadow-sm">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100">
              <svg
                className="text-sky-600"
                fill="none"
                height="18"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                width="18"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
                <line x1="16" x2="16" y1="2" y2="6" />
                <line x1="8" x2="8" y1="2" y2="6" />
                <line x1="3" x2="21" y1="10" y2="10" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-sm">
                {isEn ? "Itinerary" : "Itinerario"}
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                {isEn ? "Full stay details" : "Detalle completo"}
              </span>
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}
