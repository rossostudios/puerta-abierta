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
  listNotifications,
  markNotificationRead,
  resolveActiveOrgId,
  type Notification,
} from "@/lib/api";

type StatusFilter = "all" | "unread" | "read";

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
];

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("unread");
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

  const loadNotifications = useCallback(
    async (isRefresh: boolean) => {
      if (!orgId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const rows = await listNotifications({ orgId, status: filter, limit: 50 });
        setNotifications(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load notifications");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId, filter]
  );

  useEffect(() => {
    if (orgId) loadNotifications(false);
  }, [orgId, filter, loadNotifications]);

  const handleMarkRead = useCallback(
    async (id: string) => {
      if (!orgId) return;
      try {
        await markNotificationRead({ orgId, notificationId: id });
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, read_at: new Date().toISOString() } : n
          )
        );
      } catch {
        // silent
      }
    },
    [orgId]
  );

  const refreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => loadNotifications(true)} />,
    [loadNotifications, refreshing]
  );

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, active ? styles.filterChipActive : null]}
            >
              <Text style={[styles.filterText, active ? styles.filterTextActive : null]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={
            notifications.length === 0 ? styles.emptyContainer : styles.listContainer
          }
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <NotificationCard item={item} onMarkRead={handleMarkRead} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No notifications</Text>
              <Text style={styles.emptyBody}>You're all caught up!</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          }
        />
      )}
    </View>
  );
}

function NotificationCard({
  item,
  onMarkRead,
}: {
  item: Notification;
  onMarkRead: (id: string) => void;
}) {
  const isUnread = !item.read_at;

  return (
    <Pressable
      style={[styles.card, isUnread ? styles.cardUnread : null]}
      onPress={() => {
        if (isUnread) onMarkRead(item.id);
      }}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.severityDot, dotForSeverity(item.severity)]} />
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
      </View>

      {item.body ? (
        <Text style={styles.body} numberOfLines={3}>
          {item.body}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        <View style={styles.categoryChip}>
          <Text style={styles.categoryText}>{item.category}</Text>
        </View>
        {item.created_at && (
          <Text style={styles.time}>{formatTime(item.created_at)}</Text>
        )}
      </View>
    </Pressable>
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

function dotForSeverity(severity: string) {
  if (severity === "critical") return styles.dotCritical;
  if (severity === "warning") return styles.dotWarning;
  return styles.dotInfo;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f7f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  filterChip: { borderWidth: 1, borderColor: "#d8dede", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff" },
  filterChipActive: { backgroundColor: "#1b6f65", borderColor: "#1b6f65" },
  filterText: { color: "#2c3d42", fontSize: 12, fontWeight: "600" },
  filterTextActive: { color: "#fff" },
  listContainer: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 24, gap: 8 },
  emptyContainer: { flexGrow: 1, padding: 16, justifyContent: "center" },
  emptyCard: { borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 16, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#1f3136" },
  emptyBody: { fontSize: 14, color: "#4c5f65" },
  error: { fontSize: 13, color: "#b91c1c" },
  card: { borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 14, gap: 6 },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: "#FF5D46" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  dotCritical: { backgroundColor: "#dc2626" },
  dotWarning: { backgroundColor: "#f59e0b" },
  dotInfo: { backgroundColor: "#6b7280" },
  title: { fontSize: 15, fontWeight: "700", color: "#1f3136", flex: 1 },
  body: { fontSize: 14, color: "#4c5f65", lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  categoryChip: { backgroundColor: "#ebefef", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  categoryText: { fontSize: 11, fontWeight: "600", color: "#4c5f65" },
  time: { fontSize: 12, color: "#587078" },
});
