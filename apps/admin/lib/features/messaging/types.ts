export type MessageLogItem = {
  id: string;
  guest_id: string | null;
  reservation_id: string | null;
  channel: string;
  recipient: string;
  status: string;
  direction: string;
  body: string | null;
  subject: string | null;
  template_name: string | null;
  created_at: string | null;
  scheduled_at: string | null;
};

export type GuestInfo = {
  id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
};

export type MessageTemplate = {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
};

export type Conversation = {
  guestId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  messages: MessageLogItem[];
  lastMessage: MessageLogItem | null;
  reservationId: string | null;
};

// ---------------------------------------------------------------------------
// Normalizers (defensive parsing from Record<string, unknown>)
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optStr(value: unknown): string | null {
  const s = str(value);
  return s || null;
}

export function toMessageLogItem(raw: Record<string, unknown>): MessageLogItem {
  // body/subject live inside the payload jsonb column
  const payload =
    typeof raw.payload === "object" && raw.payload !== null
      ? (raw.payload as Record<string, unknown>)
      : {};

  return {
    id: str(raw.id),
    guest_id: optStr(raw.guest_id),
    reservation_id: optStr(raw.reservation_id),
    channel: str(raw.channel) || "email",
    recipient: str(raw.recipient),
    status: str(raw.status) || "queued",
    direction: str(raw.direction) || "outbound",
    body: optStr(payload.body) ?? optStr(raw.body),
    subject: optStr(payload.subject) ?? optStr(raw.subject),
    template_name: optStr(raw.template_name),
    created_at: optStr(raw.created_at),
    scheduled_at: optStr(raw.scheduled_at),
  };
}

export function toGuestInfo(raw: Record<string, unknown>): GuestInfo {
  const firstName = str(raw.first_name);
  const lastName = str(raw.last_name);
  const fullName =
    str(raw.full_name) ||
    str(raw.name) ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    "Guest";

  return {
    id: str(raw.id),
    full_name: fullName,
    email: optStr(raw.email),
    phone_e164: optStr(raw.phone_e164) ?? optStr(raw.phone),
  };
}

export function toMessageTemplate(
  raw: Record<string, unknown>
): MessageTemplate {
  return {
    id: str(raw.id),
    name: str(raw.name) || str(raw.template_name) || "Untitled",
    channel: str(raw.channel) || "email",
    subject: optStr(raw.subject),
    body: str(raw.body),
  };
}

export function groupByConversation(
  logs: MessageLogItem[],
  guestMap: Map<string, GuestInfo>
): Conversation[] {
  const grouped = new Map<string, MessageLogItem[]>();

  for (const log of logs) {
    const key = log.guest_id || `anon:${log.recipient}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(log);
    } else {
      grouped.set(key, [log]);
    }
  }

  const conversations: Conversation[] = [];

  for (const [key, messages] of grouped) {
    // Sort messages by created_at ascending
    messages.sort((a, b) => {
      const da = a.created_at ?? "";
      const db = b.created_at ?? "";
      return da < db ? -1 : da > db ? 1 : 0;
    });

    const lastMessage = messages.at(-1) ?? null;
    const guest = guestMap.get(key);
    const firstMsg = messages[0];

    conversations.push({
      guestId: key,
      guestName: guest?.full_name ?? firstMsg?.recipient ?? "Unknown",
      guestEmail: guest?.email ?? null,
      guestPhone: guest?.phone_e164 ?? null,
      messages,
      lastMessage,
      reservationId: lastMessage?.reservation_id ?? null,
    });
  }

  // Sort conversations by last message date descending
  conversations.sort((a, b) => {
    const da = a.lastMessage?.created_at ?? "";
    const db = b.lastMessage?.created_at ?? "";
    return da > db ? -1 : da < db ? 1 : 0;
  });

  return conversations;
}
