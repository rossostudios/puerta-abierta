"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

type MessageLog = Record<string, unknown>;

export function TenantMessages({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [messages, setMessages] = useState<MessageLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    const token = localStorage.getItem("tenant_token");
    if (!token) {
      router.push("/tenant/login");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/tenant/messages`, {
        headers: { "x-tenant-token": token },
      });
      if (res.status === 401) {
        localStorage.clear();
        router.push("/tenant/login");
        return;
      }
      const data = await res.json();
      setMessages(Array.isArray(data.data) ? data.data : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          {isEn ? "Loading..." : "Cargando..."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isEn ? "Messages" : "Mensajes"}
        </h1>
        <Link href="/tenant/dashboard">
          <Button size="sm" variant="outline">
            {isEn ? "Back" : "Volver"}
          </Button>
        </Link>
      </div>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {isEn
                ? "No messages yet."
                : "No hay mensajes aún."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => {
            const id = asString(msg.id);
            const channel = asString(msg.channel);
            const status = asString(msg.status);
            const direction = asString(msg.direction) || "outbound";
            const payload = (msg.payload ?? {}) as Record<string, unknown>;
            const body = asString(payload.body) || asString(payload.subject) || "";
            const sentAt = asString(msg.sent_at) || asString(msg.created_at);

            return (
              <Card key={id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide">
                          {direction === "inbound"
                            ? isEn ? "Received" : "Recibido"
                            : isEn ? "Sent" : "Enviado"}
                        </span>
                        <span className="bg-muted rounded px-1.5 py-0.5 text-xs capitalize">
                          {channel}
                        </span>
                        <StatusBadge label={status} value={status} />
                      </div>
                      <p className="text-sm leading-relaxed">
                        {body || (isEn ? "(no content)" : "(sin contenido)")}
                      </p>
                    </div>
                    {sentAt && (
                      <p className="text-muted-foreground shrink-0 text-xs">
                        {new Date(sentAt).toLocaleDateString(locale, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
