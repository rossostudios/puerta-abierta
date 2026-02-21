import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  listThreadMessages,
  resolveActiveOrgId,
  sendThreadMessage,
  type Message,
} from "@/lib/api";

export default function ThreadScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message> | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveActiveOrgId()
      .then((id) => { if (!cancelled) setOrgId(id); })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to resolve org");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const loadMessages = useCallback(async () => {
    if (!orgId || !threadId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listThreadMessages({ orgId, threadId, limit: 100 });
      setMessages(rows.reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load messages");
    } finally {
      setLoading(false);
    }
  }, [orgId, threadId]);

  useEffect(() => {
    if (orgId && threadId) loadMessages();
  }, [orgId, threadId, loadMessages]);

  const handleSend = useCallback(async () => {
    if (!orgId || !threadId || !draft.trim()) return;
    setSending(true);
    try {
      await sendThreadMessage({ orgId, threadId, body: draft.trim() });
      const sentMsg: Message = {
        id: `temp-${Date.now()}`,
        thread_id: threadId,
        direction: "outbound",
        body: draft.trim(),
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, sentMsg]);
      setDraft("");
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }, [orgId, threadId, draft]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => <MessageBubble msg={item} />}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          }
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message..."
          multiline
          maxLength={2000}
          editable={!sending}
        />
        <Pressable
          style={[styles.sendBtn, (!draft.trim() || sending) ? styles.sendBtnDisabled : null]}
          onPress={handleSend}
          disabled={!draft.trim() || sending}
        >
          <Text style={styles.sendText}>{sending ? "..." : "Send"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isOutbound = msg.direction === "outbound";

  return (
    <View style={[styles.bubble, isOutbound ? styles.bubbleOut : styles.bubbleIn]}>
      <Text style={[styles.bubbleText, isOutbound ? styles.bubbleTextOut : null]}>
        {msg.body}
      </Text>
      <Text style={[styles.bubbleTime, isOutbound ? styles.bubbleTimeOut : null]}>
        {formatTime(msg.created_at)}
      </Text>
    </View>
  );
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "";
  return new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(parsed);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f7f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContainer: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  emptyCard: { borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 16, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#1f3136" },
  error: { fontSize: 13, color: "#b91c1c" },
  bubble: { maxWidth: "80%", borderRadius: 16, padding: 10, gap: 2 },
  bubbleIn: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e6e6", alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleOut: { backgroundColor: "#1b6f65", alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, color: "#1f3136", lineHeight: 20 },
  bubbleTextOut: { color: "#fff" },
  bubbleTime: { fontSize: 11, color: "#587078", alignSelf: "flex-end" },
  bubbleTimeOut: { color: "rgba(255,255,255,0.7)" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#e2e6e6", backgroundColor: "#fff" },
  input: { flex: 1, borderWidth: 1, borderColor: "#d8dede", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, maxHeight: 100, backgroundColor: "#f7f7f5" },
  sendBtn: { backgroundColor: "#1b6f65", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
