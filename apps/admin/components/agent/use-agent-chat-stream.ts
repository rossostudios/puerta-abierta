"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type UIDataTypes = Record<string, never>;

export type TextUIPart = {
  type: "text";
  text: string;
};

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  parts: TextUIPart[];
};

export type DataUIPart<_T = UIDataTypes> = {
  type: string;
  data?: unknown;
  [key: string]: unknown;
};

export function isTextUIPart(part: unknown): part is TextUIPart {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

type StreamStatus = "ready" | "submitted" | "streaming";

type PrepareRequestResult = {
  api: string;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  body?: Record<string, unknown>;
};

type UseAgentChatStreamOptions = {
  id?: string;
  prepareRequest: (args: { text: string }) => PrepareRequestResult;
  onData?: (part: DataUIPart<UIDataTypes>) => void;
  onFinish?: () => void;
  onError?: (error: Error) => void;
};

type SendMessageInput =
  | string
  | {
      text: string;
    };

type BackendUiStreamEvent = {
  type?: string;
  messageId?: string;
  id?: string;
  delta?: string;
  errorText?: string;
  data?: unknown;
  [key: string]: unknown;
};

function createUserMessage(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function createAssistantMessage(messageId: string): UIMessage {
  return {
    id: messageId,
    role: "assistant",
    parts: [{ type: "text", text: "" }],
  };
}

export function useAgentChatStream({
  prepareRequest,
  onData,
  onFinish,
  onError,
}: UseAgentChatStreamOptions) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<StreamStatus>("ready");
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const onDataRef = useRef(onData);
  const onFinishRef = useRef(onFinish);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("ready");
  }, []);

  const sendMessage = useCallback(
    async (input: SendMessageInput) => {
      const text =
        typeof input === "string" ? input.trim() : (input.text ?? "").trim();
      if (!text) return;

      // Prevent concurrent streams from overlapping.
      abortRef.current?.abort();

      const userMessage = createUserMessage(text);
      setMessages((prev) => [...prev, userMessage]);
      setError(null);
      setStatus("submitted");

      const controller = new AbortController();
      abortRef.current = controller;

      let currentAssistantMessageId: string | null = null;
      let finished = false;

      const ensureAssistant = (messageId: string) => {
        currentAssistantMessageId = messageId;
        setMessages((prev) => {
          if (prev.some((m) => m.id === messageId)) return prev;
          return [...prev, createAssistantMessage(messageId)];
        });
      };

      const appendAssistantDelta = (delta: string) => {
        if (!delta) return;
        if (!currentAssistantMessageId) {
          ensureAssistant(crypto.randomUUID());
        }
        const messageId = currentAssistantMessageId!;
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            const [first, ...rest] = msg.parts;
            if (first && isTextUIPart(first)) {
              return {
                ...msg,
                parts: [{ ...first, text: `${first.text}${delta}` }, ...rest],
              };
            }
            return {
              ...msg,
              parts: [{ type: "text", text: delta }],
            };
          })
        );
      };

      const finish = () => {
        if (finished) return;
        finished = true;
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setStatus("ready");
        onFinishRef.current?.();
      };

      const fail = (incoming: unknown) => {
        const nextError =
          incoming instanceof Error ? incoming : new Error(String(incoming));
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setStatus("ready");
        setError(nextError);
        onErrorRef.current?.(nextError);
      };

      try {
        const req = prepareRequest({ text });
        const response = await fetch(req.api, {
          method: "POST",
          cache: "no-store",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            ...(req.headers ?? {}),
          },
          credentials: req.credentials,
          body: JSON.stringify(req.body ?? { message: text }),
          signal: controller.signal,
        });

        if (!(response.ok && response.body)) {
          const body = await response.text().catch(() => "");
          throw new Error(
            body || response.statusText || "Agent streaming request failed."
          );
        }

        setStatus("streaming");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
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
            if (!raw) continue;
            if (raw === "[DONE]") {
              finish();
              break;
            }

            let event: BackendUiStreamEvent;
            try {
              event = JSON.parse(raw) as BackendUiStreamEvent;
            } catch {
              continue;
            }

            const type = typeof event.type === "string" ? event.type : "";
            if (type === "start" && typeof event.messageId === "string") {
              ensureAssistant(event.messageId);
              continue;
            }

            if (type === "text-delta" && typeof event.delta === "string") {
              appendAssistantDelta(event.delta);
              continue;
            }

            if (type === "error") {
              fail(
                typeof event.errorText === "string"
                  ? event.errorText
                  : "Agent streaming error."
              );
              continue;
            }

            if (type.startsWith("data-")) {
              onDataRef.current?.(event as DataUIPart<UIDataTypes>);
            }
          }

          if (finished) break;
        }

        if (!finished) finish();
      } catch (incoming) {
        if (
          incoming instanceof DOMException &&
          incoming.name === "AbortError"
        ) {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
          setStatus("ready");
          return;
        }
        fail(incoming);
      }
    },
    [prepareRequest]
  );

  return {
    messages,
    sendMessage,
    stop,
    setMessages,
    status,
    error,
    clearError,
  };
}
