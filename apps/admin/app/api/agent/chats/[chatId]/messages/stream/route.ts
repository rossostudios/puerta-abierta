import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText } from "ai";
import { NextResponse } from "next/server";
import {
  buildSystemPrompt,
  buildToolsFromDefinitions,
  fetchToolDefinitions,
  getAgentConfig,
} from "@/lib/agents";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

/**
 * When OPENAI_API_KEY is set in the Next.js env, we orchestrate the LLM
 * conversation here using AI SDK 6 streamText, with tool execution delegated
 * to the Rust backend via POST /v1/agent/execute-tool.
 *
 * When OPENAI_API_KEY is NOT set, we fall back to proxying the Rust backend
 * SSE stream (legacy path, for backward compatibility).
 */
const USE_SDK_ORCHESTRATION = Boolean(process.env.OPENAI_API_KEY);

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
// AI SDK 6 Orchestration Path
// ---------------------------------------------------------------------------

async function handleSdkOrchestration(
  chatId: string,
  orgId: string,
  message: string,
  token: string
): Promise<Response> {
  // Fetch chat details from Rust backend to get agent_slug and conversation history
  const [chatRes, messagesRes] = await Promise.all([
    fetch(
      `${API_BASE_URL}/agent/chats/${encodeURIComponent(chatId)}?org_id=${encodeURIComponent(orgId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    ),
    fetch(
      `${API_BASE_URL}/agent/chats/${encodeURIComponent(chatId)}/messages?org_id=${encodeURIComponent(orgId)}&limit=24`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    ),
  ]);

  const chatData = chatRes.ok
    ? ((await chatRes.json()) as Record<string, unknown>)
    : {};
  const messagesData = messagesRes.ok
    ? ((await messagesRes.json()) as {
        data?: Array<{ role?: string; content?: string }>;
      })
    : {};

  const agentSlug =
    typeof chatData.agent_slug === "string"
      ? chatData.agent_slug
      : "guest-concierge";
  const preferredModel =
    typeof chatData.preferred_model === "string" &&
    chatData.preferred_model.trim()
      ? chatData.preferred_model
      : (process.env.OPENAI_PRIMARY_MODEL ?? "gpt-4.1");
  const role = "operator"; // Default, actual role comes from backend auth

  const agentConfig = getAgentConfig(agentSlug);

  // Fetch tool definitions from Rust backend
  const toolDefs = await fetchToolDefinitions(token, orgId, agentSlug);

  // Build AI SDK 6 tools
  const tools = buildToolsFromDefinitions(
    toolDefs,
    agentConfig,
    token,
    orgId,
    chatId
  );

  // Build conversation history
  const history = (messagesData.data ?? [])
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: (msg.content ?? "").slice(0, 4000),
    }));

  // Build system prompt
  const systemPrompt = buildSystemPrompt(agentConfig, orgId, role);

  // Create OpenAI provider
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Use AI SDK 6 streamText with maxSteps for multi-step tool use
  const result = streamText({
    model: openai(preferredModel),
    system: systemPrompt,
    messages: [...history, { role: "user", content: message }],
    tools: tools as Parameters<typeof streamText>[0]["tools"],
    stopWhen: stepCountIs(agentConfig.maxSteps),
    onFinish: async ({ text, steps }) => {
      // Persist the user message + assistant response to the Rust backend.
      // NOTE: The backend may not support persist_only, in which case it
      // tries to re-run the agent and fails.  We log the error so it can
      // be debugged but don't break the stream.
      try {
        // Build complete tool trace from all steps
        const allToolCalls = (steps ?? []).flatMap(
          (step) =>
            step.toolCalls?.map((tc) => ({
              tool: tc.toolName,
              args: "args" in tc ? tc.args : {},
              ok: true,
            })) ?? []
        );

        const persistRes = await fetch(
          `${API_BASE_URL}/agent/chats/${encodeURIComponent(chatId)}/messages?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message,
              allow_mutations: true,
              confirm_write: true,
              persist_only: true,
              assistant_content: text,
              tool_trace: allToolCalls,
              model_used: preferredModel,
            }),
          }
        );
        if (!persistRes.ok) {
          const body = await persistRes.text().catch(() => "");
          console.warn(
            `[SDK onFinish] Persistence returned ${persistRes.status}: ${body}`
          );
        }
      } catch (err) {
        console.warn("[SDK onFinish] Persistence error:", err);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}

// ---------------------------------------------------------------------------
// Legacy Rust Proxy Path
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

function handleLegacyProxy(
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
          },
        });
        emitSsePart(controller, encoder, { type: "finish-step" });
        emitSsePart(controller, encoder, { type: "finish" });
        emitDone(controller, encoder);
        finished = true;
      };

      const processEvent = (event: BackendEvent) => {
        const eventType = event.type ?? "";
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
      "x-vercel-ai-ui-message-stream": "v1",
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

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Route to AI SDK 6 orchestration or legacy Rust proxy
  if (USE_SDK_ORCHESTRATION) {
    try {
      return await handleSdkOrchestration(chatId, orgId, message, token);
    } catch (err) {
      // Fallback to legacy proxy on SDK orchestration failure
      console.error("[SDK Orchestration Error]", err);
      const writeFlags = resolveWriteFlags(payload);
      return handleLegacyProxy(chatId, orgId, message, token, writeFlags);
    }
  }

  const writeFlags = resolveWriteFlags(payload);
  return handleLegacyProxy(chatId, orgId, message, token, writeFlags);
}
