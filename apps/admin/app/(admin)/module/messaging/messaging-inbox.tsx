"use client";

import {
  AlertCircleIcon,
  Clock01Icon,
  InboxIcon,
  Mail01Icon,
  MailSend01Icon,
  Message01Icon,
  PlusSignIcon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

import type {
  Conversation,
  MessageLogItem,
  MessageTemplate,
} from "@/lib/features/messaging/types";

import { AiComposeAssist } from "@/components/messaging/ai-compose-assist";

import { sendMessageAction } from "./actions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type MessagingInboxProps = {
  conversations: Conversation[];
  templates: MessageTemplate[];
  orgId: string;
  initialStatus?: string;
  initialSegment?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FilterKey =
  | "all"
  | "sent"
  | "failed"
  | "scheduled"
  | "unread"
  | "awaiting"
  | "resolved"
  | "starred";

function initials(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "?";
  const parts = trimmed
    .split(" ")
    .map((p) => p.trim())
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts.at(-1)?.[0] : "";
  return `${first}${second}`.toUpperCase();
}

function relativeTime(dateStr: string | null, isEn: boolean): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));

  if (diffSec < 60) return isEn ? "now" : "ahora";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMo = Math.floor(diffDay / 30);
  return `${diffMo}${isEn ? "mo" : "m"}`;
}

function formatTimestamp(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function channelMeta(channel: string) {
  switch (channel.toLowerCase()) {
    case "whatsapp":
      return {
        label: "WhatsApp",
        icon: Message01Icon,
        className:
          "border-emerald-200/60 bg-emerald-50/60 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-400",
      };
    case "sms":
      return {
        label: "SMS",
        icon: Message01Icon,
        className:
          "border-amber-200/60 bg-amber-50/60 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-400",
      };
    case "marketplace":
      return {
        label: "Marketplace",
        icon: InboxIcon,
        className:
          "border-violet-200/60 bg-violet-50/60 text-violet-700 dark:border-violet-800/40 dark:bg-violet-950/30 dark:text-violet-400",
      };
    default:
      return {
        label: "Email",
        icon: Mail01Icon,
        className:
          "border-blue-200/60 bg-blue-50/60 text-blue-700 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-400",
      };
  }
}

function statusDot(status: string) {
  switch (status.toLowerCase()) {
    case "sent":
    case "delivered":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "scheduled":
    case "queued":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function matchesFilter(convo: Conversation, filter: FilterKey): boolean {
  if (filter === "all") return true;
  const last = convo.lastMessage;
  const s = last?.status?.toLowerCase() ?? "";
  if (filter === "sent") return s === "sent" || s === "delivered";
  if (filter === "failed") return s === "failed";
  if (filter === "scheduled") return s === "scheduled" || s === "queued";
  // "unread" — last message is inbound with no outbound reply after it
  if (filter === "unread") {
    if (!last) return false;
    const lastIdx = convo.messages.findIndex((m) => m.id === last.id);
    if (last.direction !== "inbound") return false;
    return !convo.messages.slice(lastIdx + 1).some((m) => m.direction === "outbound");
  }
  // "awaiting" — last message direction is inbound (guest waiting for reply)
  if (filter === "awaiting") return last?.direction === "inbound";
  // "resolved" — last message is outbound and sent/delivered
  if (filter === "resolved") {
    return (
      last?.direction === "outbound" &&
      (s === "sent" || s === "delivered")
    );
  }
  // "starred" — future feature, no conversations match yet
  if (filter === "starred") return false;
  return true;
}

function previewText(msg: MessageLogItem | null): string {
  if (!msg) return "";
  return (msg.body ?? msg.subject ?? msg.template_name ?? "").slice(0, 80);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterPill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "bg-background/60 text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {label}
      <span className="rounded-full bg-muted/50 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
        {count}
      </span>
    </button>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const meta = channelMeta(channel);
  return (
    <Badge
      className={cn(
        "gap-1 border px-1.5 py-px text-[10px] font-semibold",
        meta.className
      )}
      variant="outline"
    >
      <Icon icon={meta.icon} size={11} />
      {meta.label}
    </Badge>
  );
}

function ConversationRow({
  convo,
  selected,
  isEn,
  onClick,
}: {
  convo: Conversation;
  selected: boolean;
  isEn: boolean;
  onClick: () => void;
}) {
  const lastMsg = convo.lastMessage;
  const channel = lastMsg?.channel ?? "email";
  const preview = previewText(lastMsg);

  return (
    <button
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors",
        selected
          ? "bg-primary/8 ring-1 ring-primary/15"
          : "hover:bg-muted/40"
      )}
      onClick={onClick}
      type="button"
    >
      {/* Avatar */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20 text-[13px] font-semibold text-primary">
        {initials(convo.guestName)}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-foreground">
            {convo.guestName}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {relativeTime(lastMsg?.created_at ?? null, isEn)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              statusDot(lastMsg?.status ?? "")
            )}
          />
          <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            {preview || (isEn ? "No messages" : "Sin mensajes")}
          </p>
        </div>
        <div className="mt-1.5">
          <ChannelBadge channel={channel} />
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  isEn,
}: {
  msg: MessageLogItem;
  isEn: boolean;
}) {
  const isOutbound = msg.direction === "outbound";

  return (
    <div
      className={cn(
        "flex w-full",
        isOutbound ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] space-y-1.5 rounded-2xl px-4 py-2.5",
          isOutbound
            ? "rounded-br-md bg-primary/10 text-foreground"
            : "rounded-bl-md border border-border/60 bg-muted/30 text-foreground"
        )}
      >
        {msg.subject ? (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {msg.subject}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
          {msg.body ?? (isEn ? "(no content)" : "(sin contenido)")}
        </p>
        <div className="flex items-center justify-end gap-2">
          <span className="text-[10px] tabular-nums text-muted-foreground/70">
            {formatTimestamp(msg.created_at)}
          </span>
          <StatusBadge
            className="h-auto px-1.5 py-0 text-[9px]"
            value={msg.status}
          />
        </div>
      </div>
    </div>
  );
}

function DetailPanel({
  convo,
  templates,
  orgId,
  isEn,
  onBack,
}: {
  convo: Conversation;
  templates: MessageTemplate[];
  orgId: string;
  isEn: boolean;
  onBack?: () => void;
}) {
  const timelineEnd = useRef<HTMLDivElement>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [bodyValue, setBodyValue] = useState("");

  const lastChannel = convo.lastMessage?.channel ?? "email";
  const recipient =
    lastChannel === "email"
      ? convo.guestEmail ?? ""
      : convo.guestPhone ?? "";

  // Scroll to bottom on mount
  useEffect(() => {
    timelineEnd.current?.scrollIntoView({ behavior: "instant" });
  }, [convo.guestId]);

  const handleTemplateChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const tplId = e.target.value;
      setSelectedTemplateId(tplId);
      if (tplId) {
        const tpl = templates.find((t) => t.id === tplId);
        if (tpl) setBodyValue(tpl.body);
      }
    },
    [templates]
  );

  const channelMeta_ = channelMeta(lastChannel);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
        {onBack ? (
          <Button
            className="mr-1"
            onClick={onBack}
            size="sm"
            type="button"
            variant="ghost"
          >
            &larr;
          </Button>
        ) : null}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/20 text-sm font-semibold text-primary">
          {initials(convo.guestName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {convo.guestName}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {convo.guestEmail ?? convo.guestPhone ?? ""}
          </p>
        </div>
        <ChannelBadge channel={lastChannel} />
      </div>

      {/* Timeline */}
      <ScrollArea className="flex-1">
        <div className="space-y-3 px-4 py-4">
          {convo.messages.map((msg) => (
            <MessageBubble isEn={isEn} key={msg.id} msg={msg} />
          ))}
          <div ref={timelineEnd} />
        </div>
      </ScrollArea>

      {/* Compose */}
      <div className="border-t border-border/50 px-4 py-3">
        <Form action={sendMessageAction} className="space-y-2">
          <input name="organization_id" type="hidden" value={orgId} />
          <input name="channel" type="hidden" value={lastChannel} />
          <input name="recipient" type="hidden" value={recipient} />
          {convo.guestId.startsWith("anon:") ? null : (
            <input name="guest_id" type="hidden" value={convo.guestId} />
          )}
          {convo.reservationId ? (
            <input
              name="reservation_id"
              type="hidden"
              value={convo.reservationId}
            />
          ) : null}
          {selectedTemplateId ? (
            <input
              name="template_id"
              type="hidden"
              value={selectedTemplateId}
            />
          ) : null}

          {templates.length > 0 ? (
            <select
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors focus:border-ring/55 focus:outline-none focus:ring-2 focus:ring-ring/25"
              onChange={handleTemplateChange}
              value={selectedTemplateId}
            >
              <option value="">
                {isEn ? "Use a template..." : "Usar plantilla..."}
              </option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          ) : null}

          <AiComposeAssist
            channel={lastChannel}
            conversation={convo.messages}
            guestName={convo.guestName}
            isEn={isEn}
            onDraftAccepted={(text) => setBodyValue(text)}
            orgId={orgId}
          />

          <div className="flex items-end gap-2">
            <Textarea
              className="min-h-[56px] flex-1 text-[13px]"
              name="body"
              onChange={(e) => setBodyValue(e.target.value)}
              placeholder={
                isEn
                  ? "Write a message..."
                  : "Escribe un mensaje..."
              }
              rows={2}
              value={bodyValue}
            />
            <Button
              className="shrink-0 gap-1.5"
              disabled={!bodyValue.trim()}
              size="sm"
              type="submit"
            >
              <Icon icon={MailSend01Icon} size={14} />
              {isEn ? "Send" : "Enviar"}
            </Button>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
            <Icon icon={channelMeta_.icon} size={12} />
            <span>
              {isEn ? "via" : "por"} {channelMeta_.label}
              {recipient ? ` → ${recipient}` : ""}
            </span>
          </div>
        </Form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compose Sheet (new message)
// ---------------------------------------------------------------------------

function ComposeSheet({
  open,
  onOpenChange,
  templates,
  orgId,
  isEn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: MessageTemplate[];
  orgId: string;
  isEn: boolean;
}) {
  const [channel, setChannel] = useState("email");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [bodyValue, setBodyValue] = useState("");

  const handleTemplateChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const tplId = e.target.value;
      setSelectedTemplateId(tplId);
      if (tplId) {
        const tpl = templates.find((t) => t.id === tplId);
        if (tpl) {
          setBodyValue(tpl.body);
          setChannel(tpl.channel || "email");
        }
      }
    },
    [templates]
  );

  return (
    <Sheet
      contentClassName="max-w-full sm:max-w-lg"
      description={
        isEn
          ? "Send a new message to a guest."
          : "Enviar un nuevo mensaje a un huésped."
      }
      onOpenChange={onOpenChange}
      open={open}
      title={
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Compose" : "Redactar"}
            </Badge>
            <Badge className="text-[11px]" variant="secondary">
              {isEn ? "Communications" : "Comunicaciones"}
            </Badge>
          </div>
          <p className="truncate font-semibold text-base">
            {isEn ? "New message" : "Nuevo mensaje"}
          </p>
        </div>
      }
    >
      <Form action={sendMessageAction} className="space-y-4">
        <input name="organization_id" type="hidden" value={orgId} />

        {/* Channel */}
        <div className="grid gap-1">
          <label className="text-xs font-medium">
            {isEn ? "Channel" : "Canal"}
          </label>
          <div className="flex gap-2">
            {(["email", "whatsapp", "sms"] as const).map((ch) => {
              const meta = channelMeta(ch);
              return (
                <button
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    channel === ch
                      ? cn("ring-1 ring-primary/20", meta.className)
                      : "bg-background/60 text-muted-foreground hover:text-foreground"
                  )}
                  key={ch}
                  onClick={() => setChannel(ch)}
                  type="button"
                >
                  <Icon icon={meta.icon} size={13} />
                  {meta.label}
                </button>
              );
            })}
          </div>
          <input name="channel" type="hidden" value={channel} />
        </div>

        {/* Recipient */}
        <div className="grid gap-1">
          <label className="text-xs font-medium">
            {isEn ? "Recipient" : "Destinatario"}
          </label>
          <input
            className="flex h-9 w-full rounded-xl border border-input bg-background px-3 text-sm transition-colors placeholder:text-muted-foreground/85 focus-visible:border-ring/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
            name="recipient"
            placeholder={
              channel === "email"
                ? "guest@example.com"
                : "+595981000000"
            }
            required
          />
        </div>

        {/* Subject (email only) */}
        {channel === "email" ? (
          <div className="grid gap-1">
            <label className="text-xs font-medium">
              {isEn ? "Subject" : "Asunto"}
            </label>
            <input
              className="flex h-9 w-full rounded-xl border border-input bg-background px-3 text-sm transition-colors placeholder:text-muted-foreground/85 focus-visible:border-ring/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
              name="subject"
              placeholder={
                isEn ? "Message subject..." : "Asunto del mensaje..."
              }
            />
          </div>
        ) : null}

        {/* Template */}
        {templates.length > 0 ? (
          <div className="grid gap-1">
            <label className="text-xs font-medium">
              {isEn ? "Template" : "Plantilla"}
            </label>
            <select
              className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-sm text-muted-foreground transition-colors focus:border-ring/55 focus:outline-none focus:ring-2 focus:ring-ring/25"
              onChange={handleTemplateChange}
              value={selectedTemplateId}
            >
              <option value="">
                {isEn ? "None" : "Ninguna"}
              </option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
            {selectedTemplateId ? (
              <input
                name="template_id"
                type="hidden"
                value={selectedTemplateId}
              />
            ) : null}
          </div>
        ) : null}

        {/* Body */}
        <div className="grid gap-1">
          <label className="text-xs font-medium">
            {isEn ? "Message" : "Mensaje"}
          </label>
          <Textarea
            name="body"
            onChange={(e) => setBodyValue(e.target.value)}
            placeholder={
              isEn
                ? "Write your message..."
                : "Escribe tu mensaje..."
            }
            required={!selectedTemplateId}
            rows={4}
            value={bodyValue}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            {isEn ? "Cancel" : "Cancelar"}
          </Button>
          <Button className="gap-1.5" type="submit">
            <Icon icon={MailSend01Icon} size={15} />
            {isEn ? "Send message" : "Enviar mensaje"}
          </Button>
        </div>
      </Form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const STATUS_TO_FILTER: Record<string, FilterKey> = {
  unread: "unread",
  awaiting: "awaiting",
  resolved: "resolved",
  starred: "starred",
};

export function MessagingInbox({
  conversations,
  templates,
  orgId,
  initialStatus,
  initialSegment,
}: MessagingInboxProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const derivedInitialFilter: FilterKey =
    (initialStatus && STATUS_TO_FILTER[initialStatus]) || "all";
  const [activeFilter, setActiveFilter] =
    useState<FilterKey>(derivedInitialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Filter counts
  const counts = useMemo(() => {
    const c = {
      all: conversations.length,
      sent: 0,
      failed: 0,
      scheduled: 0,
      unread: 0,
      awaiting: 0,
      resolved: 0,
      starred: 0,
    };
    for (const convo of conversations) {
      if (matchesFilter(convo, "sent")) c.sent += 1;
      if (matchesFilter(convo, "failed")) c.failed += 1;
      if (matchesFilter(convo, "scheduled")) c.scheduled += 1;
      if (matchesFilter(convo, "unread")) c.unread += 1;
      if (matchesFilter(convo, "awaiting")) c.awaiting += 1;
      if (matchesFilter(convo, "resolved")) c.resolved += 1;
    }
    return c;
  }, [conversations]);

  const filtered = useMemo(
    () => conversations.filter((c) => matchesFilter(c, activeFilter)),
    [conversations, activeFilter]
  );

  const selectedConvo = useMemo(
    () =>
      selectedId
        ? conversations.find((c) => c.guestId === selectedId) ?? null
        : null,
    [conversations, selectedId]
  );

  // Auto-select first conversation
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0]!.guestId);
    }
  }, [filtered, selectedId]);

  const handleSelectConvo = useCallback((id: string) => {
    setSelectedId(id);
    // On mobile, open the detail Sheet
    setMobileDetailOpen(true);
  }, []);

  // Empty state
  if (conversations.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end">
          <Button
            className="gap-1.5"
            onClick={() => setComposeOpen(true)}
            type="button"
            variant="secondary"
          >
            <Icon icon={PlusSignIcon} size={15} />
            {isEn ? "Compose" : "Redactar"}
          </Button>
        </div>

        <EmptyState
          action={
            <Button
              className="gap-1.5"
              onClick={() => setComposeOpen(true)}
              type="button"
              variant="secondary"
            >
              <Icon icon={MailSend01Icon} size={15} />
              {isEn ? "Send first message" : "Enviar primer mensaje"}
            </Button>
          }
          className="rounded-xl border border-dashed bg-muted/10 py-20"
          description={
            isEn
              ? "Message logs from WhatsApp, Email, and SMS will appear here. Send your first message to get started."
              : "Los registros de mensajes de WhatsApp, Email y SMS aparecerán aquí. Envía tu primer mensaje para comenzar."
          }
          icon={InboxIcon}
          title={isEn ? "No messages yet" : "Aún no hay mensajes"}
        />

        <ComposeSheet
          isEn={isEn}
          onOpenChange={setComposeOpen}
          open={composeOpen}
          orgId={orgId}
          templates={templates}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill
            active={activeFilter === "all"}
            count={counts.all}
            label={isEn ? "All" : "Todos"}
            onClick={() => setActiveFilter("all")}
          />
          <FilterPill
            active={activeFilter === "unread"}
            count={counts.unread}
            label={isEn ? "Unread" : "No leídos"}
            onClick={() => setActiveFilter("unread")}
          />
          <FilterPill
            active={activeFilter === "awaiting"}
            count={counts.awaiting}
            label={isEn ? "Awaiting" : "Esperando"}
            onClick={() => setActiveFilter("awaiting")}
          />
          <FilterPill
            active={activeFilter === "resolved"}
            count={counts.resolved}
            label={isEn ? "Resolved" : "Resueltos"}
            onClick={() => setActiveFilter("resolved")}
          />
          <FilterPill
            active={activeFilter === "sent"}
            count={counts.sent}
            label={isEn ? "Sent" : "Enviados"}
            onClick={() => setActiveFilter("sent")}
          />
          <FilterPill
            active={activeFilter === "failed"}
            count={counts.failed}
            label={isEn ? "Failed" : "Fallidos"}
            onClick={() => setActiveFilter("failed")}
          />
          <FilterPill
            active={activeFilter === "scheduled"}
            count={counts.scheduled}
            label={isEn ? "Scheduled" : "Programados"}
            onClick={() => setActiveFilter("scheduled")}
          />
        </div>

        <Button
          className="gap-1.5"
          onClick={() => setComposeOpen(true)}
          type="button"
          variant="secondary"
        >
          <Icon icon={PlusSignIcon} size={15} />
          {isEn ? "Compose" : "Redactar"}
        </Button>
      </div>

      {/* Split panel */}
      <div className="overflow-hidden rounded-xl border bg-background/40">
        <div className="flex h-[calc(100vh-20rem)] min-h-[480px]">
          {/* Conversation list */}
          <div
            className={cn(
              "w-full border-r border-border/40 md:w-[38%] md:min-w-[280px] md:max-w-[400px]",
              selectedConvo ? "hidden md:block" : ""
            )}
          >
            <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
              <Icon
                className="text-muted-foreground"
                icon={InboxIcon}
                size={15}
              />
              <span className="text-[12px] font-medium text-muted-foreground">
                {filtered.length}{" "}
                {isEn
                  ? filtered.length === 1
                    ? "conversation"
                    : "conversations"
                  : filtered.length === 1
                    ? "conversación"
                    : "conversaciones"}
              </span>
            </div>
            <ScrollArea className="h-[calc(100%-40px)]">
              <div className="space-y-0.5 p-1.5">
                {filtered.map((convo) => (
                  <ConversationRow
                    convo={convo}
                    isEn={isEn}
                    key={convo.guestId}
                    onClick={() => handleSelectConvo(convo.guestId)}
                    selected={selectedId === convo.guestId}
                  />
                ))}
                {filtered.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                    {isEn
                      ? "No conversations match this filter."
                      : "No hay conversaciones con este filtro."}
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </div>

          {/* Detail panel (desktop) */}
          <div className="hidden min-w-0 flex-1 md:block">
            {selectedConvo ? (
              <DetailPanel
                convo={selectedConvo}
                isEn={isEn}
                orgId={orgId}
                templates={templates}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Icon
                    className="mx-auto text-muted-foreground/40"
                    icon={Message01Icon}
                    size={32}
                  />
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {isEn
                      ? "Select a conversation"
                      : "Selecciona una conversación"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile detail Sheet */}
      <Sheet
        contentClassName="max-w-full sm:max-w-xl"
        onOpenChange={setMobileDetailOpen}
        open={mobileDetailOpen && selectedConvo !== null}
        title={
          selectedConvo ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {isEn ? "Conversation" : "Conversación"}
                </Badge>
                <ChannelBadge
                  channel={selectedConvo.lastMessage?.channel ?? "email"}
                />
              </div>
              <p className="truncate font-semibold text-base">
                {selectedConvo.guestName}
              </p>
            </div>
          ) : undefined
        }
      >
        {selectedConvo ? (
          <div className="-mx-6 -my-5 h-[70vh]">
            <DetailPanel
              convo={selectedConvo}
              isEn={isEn}
              onBack={() => setMobileDetailOpen(false)}
              orgId={orgId}
              templates={templates}
            />
          </div>
        ) : null}
      </Sheet>

      <ComposeSheet
        isEn={isEn}
        onOpenChange={setComposeOpen}
        open={composeOpen}
        orgId={orgId}
        templates={templates}
      />
    </div>
  );
}
