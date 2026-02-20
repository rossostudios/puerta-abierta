"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { deleteJson, postJson } from "@/lib/api";

function toStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function messagingUrl(params?: {
  success?: string;
  error?: string;
  tab?: string;
}): string {
  const qs = new URLSearchParams();
  if (params?.success) qs.set("success", params.success);
  if (params?.error) qs.set("error", params.error);
  if (params?.tab) qs.set("tab", params.tab);
  const suffix = qs.toString();
  return suffix ? `/module/messaging?${suffix}` : "/module/messaging";
}

export async function sendMessageAction(formData: FormData) {
  const organization_id = toStringValue(formData.get("organization_id"));
  const channel = toStringValue(formData.get("channel"));
  const recipient = toStringValue(formData.get("recipient"));
  const guest_id = toStringValue(formData.get("guest_id")) || undefined;
  const reservation_id =
    toStringValue(formData.get("reservation_id")) || undefined;
  const template_id = toStringValue(formData.get("template_id")) || undefined;
  const body = toStringValue(formData.get("body"));
  const subject = toStringValue(formData.get("subject")) || undefined;
  const scheduled_at = toStringValue(formData.get("scheduled_at")) || undefined;

  if (!organization_id) {
    redirect(messagingUrl({ error: "Missing organization context." }));
  }
  if (!channel) {
    redirect(messagingUrl({ error: "Channel is required." }));
  }
  if (!recipient) {
    redirect(messagingUrl({ error: "Recipient is required." }));
  }
  if (!(body || template_id)) {
    redirect(messagingUrl({ error: "Message body or template is required." }));
  }

  try {
    await postJson("/messages/send", {
      organization_id,
      channel,
      recipient,
      ...(guest_id ? { guest_id } : {}),
      ...(reservation_id ? { reservation_id } : {}),
      ...(template_id ? { template_id } : {}),
      ...(body ? { body } : {}),
      ...(subject ? { subject } : {}),
      ...(scheduled_at ? { scheduled_at } : {}),
    });

    revalidatePath("/module/messaging");
    redirect(messagingUrl({ success: "message-sent" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(messagingUrl({ error: message.slice(0, 240) }));
  }
}

function extractVariables(body: string): string[] {
  const variables: string[] = [];
  const pattern = /\{\{(\w+)\}\}/g;
  let m = pattern.exec(body);
  while (m) {
    const name = m[1];
    if (!name) {
      m = pattern.exec(body);
      continue;
    }
    if (!variables.includes(name)) variables.push(name);
    m = pattern.exec(body);
  }
  return variables;
}

export async function createTemplateAction(formData: FormData) {
  const organization_id = toStringValue(formData.get("organization_id"));
  if (!organization_id) {
    redirect(
      messagingUrl({ error: "Missing organization context.", tab: "templates" })
    );
  }

  const name = toStringValue(formData.get("name"));
  const channel = toStringValue(formData.get("channel")) || "whatsapp";
  const body = toStringValue(formData.get("body"));
  const subject = toStringValue(formData.get("subject")) || undefined;
  const template_key =
    toStringValue(formData.get("template_key")) ||
    name.toLowerCase().replaceAll(/\s+/g, "_");
  const language_code = toStringValue(formData.get("language_code")) || "es-PY";

  if (!name) {
    redirect(
      messagingUrl({ error: "Template name is required.", tab: "templates" })
    );
  }
  if (!body) {
    redirect(
      messagingUrl({ error: "Template body is required.", tab: "templates" })
    );
  }

  const variables = extractVariables(body);

  try {
    await postJson("/message-templates", {
      organization_id,
      name,
      template_key,
      channel,
      language_code,
      body,
      variables,
      ...(subject ? { subject } : {}),
    });

    revalidatePath("/module/messaging");
    redirect(messagingUrl({ success: "template-created", tab: "templates" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(messagingUrl({ error: message.slice(0, 240), tab: "templates" }));
  }
}

export async function deleteTemplateAction(formData: FormData) {
  const template_id = toStringValue(formData.get("template_id"));
  if (!template_id) {
    redirect(
      messagingUrl({ error: "template_id is required", tab: "templates" })
    );
  }

  try {
    await deleteJson(`/message-templates/${encodeURIComponent(template_id)}`);
    revalidatePath("/module/messaging");
    redirect(messagingUrl({ success: "template-deleted", tab: "templates" }));
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : String(err);
    redirect(messagingUrl({ error: message.slice(0, 240), tab: "templates" }));
  }
}
