import { Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  listMessageThreads,
  resolveActiveOrgId,
  type MessageThread,
} from "@/lib/api";

export default function MessagesScreen() {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveActiveOrgId()
      .then((id) => { if (!cancelled) setOrgId(id); })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to resolve organization");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const loadThreads = useCallback(
    async (isRefresh: boolean) => {
      if (!orgId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const rows = await listMessageThreads({ orgId, limit: 50 });
        setThreads(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load messages");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    if (orgId) loadThreads(false);
  }, [orgId, loadThreads]);

  const refreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => loadThreads(true)} />,
    [loadThreads, refreshing]
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={
            threads.length === 0 ? styles.emptyContainer : styles.listContainer
          }
          data={threads}
          keyExtractor={(item) => item.id}
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <ThreadRow item={item} orgId={orgId!} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyBody}>
                Guest messages will appear here.
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          }
        />
      )}
    </View>
  );
}

function ThreadRow({ item }: { item: MessageThread; orgId: string }) {
  const hasUnread = (item.unread_count ?? 0) > 0;

  return (
    <Link
      href={{
        pathname: "/messages/[threadId]",
        params: { threadId: item.id },
      }}
      asChild
    >
      <Pressable
        style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.guestName, hasUnread ? styles.guestNameUnread : null]}>
            {item.guest_name || "Unknown"}
          </Text>
          {hasUnread && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unread_count}</Text>
            </View>
          )}
        </View>

        {item.channel && (
          <View style={styles.channelRow}>
            <View style={styles.channelChip}>
              <Text style={styles.channelText}>{item.channel}</Text>
            </View>
            {item.guest_phone && (
              <Text style={styles.phone}>{item.guest_phone}</Text>
            )}
          </View>
        )}

        {item.last_message && (
          <Text style={styles.preview} numberOfLines={2}>
            {item.last_message}
          </Text>
        )}

        {item.last_message_at && (
          <Text style={styles.time}>{formatTime(item.last_message_at)}</Text>
        )}
      </Pressable>
    </Link>
  );
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  const now = new Date();
  const diff = now.getTime() - parsed.getTime();

  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "short" }).format(parsed);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f7f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContainer: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 24, gap: 10 },
  emptyContainer: { flexGrow: 1, padding: 16, justifyContent: "center" },
  emptyCard: { borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 16, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#1f3136" },
  emptyBody: { fontSize: 14, color: "#4c5f65" },
  error: { fontSize: 13, color: "#b91c1c" },
  card: { borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 14, gap: 6 },
  cardPressed: { opacity: 0.9 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  guestName: { fontSize: 15, fontWeight: "600", color: "#1f3136", flex: 1 },
  guestNameUnread: { fontWeight: "800" },
  unreadBadge: { backgroundColor: "#FF5D46", borderRadius: 999, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  unreadText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  channelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  channelChip: { backgroundColor: "#ebefef", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  channelText: { fontSize: 11, fontWeight: "600", color: "#4c5f65" },
  phone: { fontSize: 12, color: "#587078" },
  preview: { fontSize: 14, color: "#4c5f65", lineHeight: 20 },
  time: { fontSize: 12, color: "#587078" },
});
