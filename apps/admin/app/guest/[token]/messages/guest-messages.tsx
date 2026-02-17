"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import { useGuest } from "../layout";

interface Message {
  id: string;
  created_at: string;
  payload?: {
    body?: string;
    direction?: string;
    sender_name?: string;
  };
}

export function GuestMessages() {
  const { token, headers, apiBase } = useGuest();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/guest/messages`, { headers });
      if (!res.ok) throw new Error("Failed to load messages");
      const json = await res.json();
      setMessages(Array.isArray(json.data) ? json.data : []);
    } catch {
      setError("Could not load messages.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, headers]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/guest/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      setDraft("");
      await loadMessages();
    } catch {
      setError("Could not send message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Messages</h1>
        <Link href={`/guest/${encodeURIComponent(token)}/itinerary`}>
          <Button size="sm" variant="outline">
            Back
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="max-h-[45vh] space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3 sm:max-h-[50vh]">
            {loading ? (
              <>
                <Skeleton className="h-12 w-3/4" />
                <Skeleton className="ml-auto h-12 w-2/3" />
                <Skeleton className="h-12 w-3/4" />
              </>
            ) : messages.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">
                No messages yet. Send one below.
              </p>
            ) : (
              messages.map((msg) => {
                const isInbound = msg.payload?.direction === "inbound";
                const body =
                  msg.payload?.body ??
                  (typeof msg.payload === "string"
                    ? msg.payload
                    : "");
                const sender = msg.payload?.sender_name;

                return (
                  <div
                    className={`flex ${isInbound ? "justify-end" : "justify-start"}`}
                    key={msg.id}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl border px-3 py-2 text-sm ${
                        isInbound
                          ? "border-primary/30 bg-primary/10"
                          : "border-border/60 bg-card"
                      }`}
                    >
                      {sender && (
                        <p className="text-[11px] text-muted-foreground mb-0.5 font-medium">
                          {sender}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{body}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {msg.created_at
                          ? new Date(msg.created_at).toLocaleString()
                          : ""}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form className="space-y-2" onSubmit={sendMessage}>
            <Textarea
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  sendMessage(e);
                }
              }}
              placeholder="Type your message..."
              rows={3}
              value={draft}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                Cmd/Ctrl + Enter to send
              </span>
              <Button disabled={sending || !draft.trim()} type="submit">
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
