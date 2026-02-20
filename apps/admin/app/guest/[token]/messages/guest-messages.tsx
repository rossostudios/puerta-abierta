"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import { useGuest } from "../layout";

type Message = {
  id: string;
  created_at: string;
  payload?: {
    body?: string;
    direction?: string;
    sender_name?: string;
  };
};

export function GuestMessages() {
  "use no memo";
  const { token, headers, apiBase } = useGuest();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const { data: messages = [], isPending: loading } = useQuery({
    queryKey: ["guest-messages", token],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/guest/messages`, { headers });
      if (!res.ok) {
        setError("Could not load messages.");
        return [];
      }
      const json = await res.json();
      const items = json.data;
      return (Array.isArray(items) ? items : []) as Message[];
    },
    enabled: Boolean(token),
  });

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
      if (!res.ok) {
        setError("Could not send message.");
        setSending(false);
        return;
      }
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["guest-messages"] });
      setSending(false);
    } catch {
      setError("Could not send message.");
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-bold text-2xl">Messages</h1>
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
          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="max-h-[45vh] space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3 sm:max-h-[50vh]">
            {loading ? (
              <>
                <Skeleton className="h-12 w-3/4" />
                <Skeleton className="ml-auto h-12 w-2/3" />
                <Skeleton className="h-12 w-3/4" />
              </>
            ) : messages.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">
                No messages yet. Send one below.
              </p>
            ) : (
              messages.map((msg) => {
                const isInbound = msg.payload?.direction === "inbound";
                const body =
                  msg.payload?.body ??
                  (typeof msg.payload === "string" ? msg.payload : "");
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
                        <p className="mb-0.5 font-medium text-[11px] text-muted-foreground">
                          {sender}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{body}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
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
