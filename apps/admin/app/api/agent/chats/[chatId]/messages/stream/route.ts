import { NextResponse } from "next/server";
import { getServerAccessToken } from "@/lib/auth/server-access-token";

import { SERVER_API_BASE_URL } from "@/lib/server-api-base";

const API_BASE_URL = SERVER_API_BASE_URL;

type RouteParams = {
  params: Promise<{ chatId: string }>;
};

type ChatPayloadMessage = {
  role?: string;
  content?: string;
  parts?: Array<{ type?: string; text?: string }>;
};

type StreamMessagePayload = {
  org_id?: string;
  message?: string;
  messages?: ChatPayloadMessage[];
  allow_mutations?: boolean;
  confirm_write?: boolean;
};

function extractUserMessage(payload: StreamMessagePayload): string {
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if (!Array.isArray(payload.messages)) {
    return "";
  }

  for (let i = payload.messages.length - 1; i >= 0; i -= 1) {
    const row = payload.messages[i];
    if (!row || row.role !== "user") {
      continue;
    }

    if (typeof row.content === "string" && row.content.trim()) {
      return row.content.trim();
    }

    if (!Array.isArray(row.parts)) {
      continue;
    }

    const text = row.parts
      .filter(
        (part) => part && part.type === "text" && typeof part.text === "string"
      )
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// Rust Agent Runtime Proxy Path
// ---------------------------------------------------------------------------

type BackendEvent = {
  type?: string;
  message?: string;
  name?: string;
  args?: Record<string, unknown>;
  preview?: string;
  ok?: boolean;
  text?: string;
  content?: string;
  tool_trace?: unknown[];
  model_used?: string | null;
  fallback_used?: boolean;
};

type BackendRuntimeEnvelope = {
  type?: string;
  runtime_version?: string;
  run_id?: string;
  trace_id?: string;
  timestamp?: string;
  payload?: BackendEvent;
};

type WriteFlags = {
  allow_mutations?: boolean;
  confirm_write?: boolean;
};

type StreamController = {
  enqueue: (chunk: Uint8Array) => void;
};

function resolveWriteFlags(payload: StreamMessagePayload): WriteFlags {
  const flags: WriteFlags = {};
  if (typeof payload.allow_mutations === "boolean") {
    flags.allow_mutations = payload.allow_mutations;
  }
  if (typeof payload.confirm_write === "boolean") {
    flags.confirm_write = payload.confirm_write;
  }
  return flags;
}

function emitSsePart(
  controller: StreamController,
  encoder: TextEncoder,
  payload: unknown
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function emitDone(controller: StreamController, encoder: TextEncoder) {
  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
}

function handleBackendAgentProxy(
  chatId: string,
  orgId: string,
  message: string,
  token: string,
  writeFlags: WriteFlags
): Response {
  let backendResponsePromise: Promise<globalThis.Response>;
  try {
    backendResponsePromise = fetch(
      `${API_BASE_URL}/agent/chats/${encodeURIComponent(chatId)}/messages/stream?org_id=${encodeURIComponent(orgId)}`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message,
          ...writeFlags,
        }),
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    ) as unknown as Response;
  }

  const messageId = crypto.randomUUID();
  const textPartId = `text-${messageId}`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let started = false;
      let textStarted = false;
      let finished = false;
      let currentText = "";
      let toolCallCounter = 0;
      const runtimeMeta: {
        runtime_version?: string;
        run_id?: string;
        trace_id?: string;
      } = {};
      const pendingToolCalls = new Map<string, string[]>();

      const ensureStart = () => {
        if (started) return;
        started = true;
        emitSsePart(controller, encoder, { type: "start", messageId });
      };

      const ensureTextStart = () => {
        ensureStart();
        if (textStarted) return;
        textStarted = true;
        emitSsePart(controller, encoder, {
          type: "text-start",
          id: textPartId,
        });
      };

      const finalize = (
        doneContent: string,
        modelUsed: string | null | undefined,
        fallbackUsed: boolean,
        toolTrace: unknown[] | undefined
      ) => {
        if (finished) return;
        ensureTextStart();
        if (doneContent) {
          if (doneContent.startsWith(currentText)) {
            const delta = doneContent.slice(currentText.length);
            if (delta)
              emitSsePart(controller, encoder, {
                type: "text-delta",
                id: textPartId,
                delta,
              });
            currentText = doneContent;
          } else {
            emitSsePart(controller, encoder, {
              type: "text-delta",
              id: textPartId,
              delta: doneContent,
            });
            currentText = `${currentText}${doneContent}`;
          }
        }
        emitSsePart(controller, encoder, { type: "text-end", id: textPartId });
        emitSsePart(controller, encoder, {
          type: "data-casaora-meta",
          data: {
            messageId,
            model_used: typeof modelUsed === "string" ? modelUsed : null,
            fallback_used: fallbackUsed,
            tool_trace: Array.isArray(toolTrace) ? toolTrace : [],
            runtime_version: runtimeMeta.runtime_version ?? null,
            run_id: runtimeMeta.run_id ?? null,
            trace_id: runtimeMeta.trace_id ?? null,
          },
        });
        emitSsePart(controller, encoder, { type: "finish-step" });
        emitSsePart(controller, encoder, { type: "finish" });
        emitDone(controller, encoder);
        finished = true;
      };

      const processEvent = (
        rawEvent: BackendEvent | BackendRuntimeEnvelope
      ) => {
        let eventType = rawEvent.type ?? "";
        let event: BackendEvent = rawEvent as BackendEvent;

        if (
          rawEvent &&
          typeof rawEvent === "object" &&
          "payload" in rawEvent &&
          (rawEvent as BackendRuntimeEnvelope).payload &&
          typeof (rawEvent as BackendRuntimeEnvelope).payload === "object"
        ) {
          const envelope = rawEvent as BackendRuntimeEnvelope;
          eventType = envelope.type ?? eventType;
          event = envelope.payload ?? {};
          runtimeMeta.runtime_version =
            typeof envelope.runtime_version === "string"
              ? envelope.runtime_version
              : runtimeMeta.runtime_version;
          runtimeMeta.run_id =
            typeof envelope.run_id === "string"
              ? envelope.run_id
              : runtimeMeta.run_id;
          runtimeMeta.trace_id =
            typeof envelope.trace_id === "string"
              ? envelope.trace_id
              : runtimeMeta.trace_id;
        }

        if (eventType === "status") {
          ensureStart();
          emitSsePart(controller, encoder, {
            type: "data-casaora-status",
            data: { message: event.message ?? "" },
          });
          return;
        }
        if (eventType === "tool_call") {
          ensureStart();
          const toolName =
            typeof event.name === "string" && event.name.trim()
              ? event.name.trim()
              : "tool";
          toolCallCounter += 1;
          const toolCallId = `tool-call-${toolCallCounter}`;
          const queue = pendingToolCalls.get(toolName) ?? [];
          queue.push(toolCallId);
          pendingToolCalls.set(toolName, queue);
          const input =
            event.args && typeof event.args === "object" ? event.args : {};
          emitSsePart(controller, encoder, {
            type: "tool-input-available",
            toolCallId,
            toolName,
            input,
          });
          emitSsePart(controller, encoder, {
            type: "data-casaora-tool",
            data: {
              phase: "call",
              tool_name: toolName,
              tool_call_id: toolCallId,
              args: input,
            },
          });
          return;
        }
        if (eventType === "tool_result") {
          ensureStart();
          const toolName =
            typeof event.name === "string" && event.name.trim()
              ? event.name.trim()
              : "tool";
          const queue = pendingToolCalls.get(toolName) ?? [];
          const toolCallId =
            queue.shift() ?? `tool-call-${toolCallCounter + 1}`;
          pendingToolCalls.set(toolName, queue);
          emitSsePart(controller, encoder, {
            type: "tool-output-available",
            toolCallId,
            output: {
              ok: event.ok === true,
              preview: typeof event.preview === "string" ? event.preview : "",
            },
          });
          emitSsePart(controller, encoder, {
            type: "data-casaora-tool",
            data: {
              phase: "result",
              tool_name: toolName,
              tool_call_id: toolCallId,
              ok: event.ok === true,
              preview: typeof event.preview === "string" ? event.preview : "",
            },
          });
          return;
        }
        if (eventType === "token" && typeof event.text === "string") {
          ensureTextStart();
          if (event.text.startsWith(currentText)) {
            const delta = event.text.slice(currentText.length);
            if (delta)
              emitSsePart(controller, encoder, {
                type: "text-delta",
                id: textPartId,
                delta,
              });
            currentText = event.text;
          } else {
            emitSsePart(controller, encoder, {
              type: "text-delta",
              id: textPartId,
              delta: event.text,
            });
            currentText = `${currentText}${event.text}`;
          }
          return;
        }
        if (eventType === "done") {
          finalize(
            typeof event.content === "string" ? event.content : "",
            event.model_used,
            event.fallback_used === true,
            event.tool_trace
          );
          return;
        }
        if (eventType === "error") {
          ensureStart();
          emitSsePart(controller, encoder, {
            type: "error",
            errorText:
              typeof event.message === "string"
                ? event.message
                : "Agent streaming error.",
          });
          finalize("", null, false, []);
        }
      };

      const run = async () => {
        const backendResponse = await backendResponsePromise;
        if (!(backendResponse.ok && backendResponse.body)) {
          const text = await backendResponse.text().catch(() => "");
          ensureStart();
          emitSsePart(controller, encoder, {
            type: "error",
            errorText:
              text || backendResponse.statusText || "Streaming request failed.",
          });
          finalize("", null, false, []);
          controller.close();
          return;
        }

        const reader = backendResponse.body.getReader();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const event = JSON.parse(raw) as BackendEvent;
              processEvent(event);
              if (finished) break;
            } catch {
              /* skip malformed events */
            }
          }
          if (finished) break;
        }
        if (!finished) finalize(currentText, null, false, []);
        controller.close();
      };

      run().catch((error) => {
        controller.error(error);
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request, { params }: RouteParams) {
  const { chatId } = await params;
  const searchParams = new URL(request.url).searchParams;

  let payload: StreamMessagePayload;
  try {
    payload = (await request.json()) as StreamMessagePayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId =
    searchParams.get("org_id")?.trim() ?? payload.org_id?.trim() ?? "";
  const message = extractUserMessage(payload);

  if (!(chatId && orgId && message)) {
    return NextResponse.json(
      { ok: false, error: "chatId, org_id, and message are required." },
      { status: 400 }
    );
  }
  const token = await getServerAccessToken();

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const writeFlags = resolveWriteFlags(payload);
  return handleBackendAgentProxy(chatId, orgId, message, token, writeFlags);
}
