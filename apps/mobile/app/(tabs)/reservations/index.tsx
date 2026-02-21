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
  listReservations,
  resolveActiveOrgId,
  type Reservation,
} from "@/lib/api";

type DateFilter = "today" | "week" | "all";

const DATE_FILTERS: Array<{ key: DateFilter; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All" },
];

function dateRange(filter: DateFilter): { from?: string; to?: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (filter === "today") return { from: today, to: today };
  if (filter === "week") {
    const end = new Date(now.getTime() + 7 * 86_400_000);
    return { from: today, to: end.toISOString().slice(0, 10) };
  }
  return {};
}

export default function ReservationsScreen() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveActiveOrgId()
      .then((id) => {
        if (!cancelled) setOrgId(id);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to resolve organization");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const loadReservations = useCallback(
    async (isRefresh: boolean) => {
      if (!orgId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const { from, to } = dateRange(dateFilter);
        const rows = await listReservations({ orgId, from, to, limit: 100 });
        setReservations(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load reservations");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId, dateFilter]
  );

  useEffect(() => {
    if (orgId) loadReservations(false);
  }, [orgId, dateFilter, loadReservations]);

  const refreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => loadReservations(true)} />,
    [loadReservations, refreshing]
  );

  const arrivals = reservations.filter((r) => {
    const today = new Date().toISOString().slice(0, 10);
    return r.check_in?.slice(0, 10) === today;
  });
  const departures = reservations.filter((r) => {
    const today = new Date().toISOString().slice(0, 10);
    return r.check_out?.slice(0, 10) === today;
  });

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {DATE_FILTERS.map((f) => {
          const active = f.key === dateFilter;
          return (
            <Pressable
              key={f.key}
              onPress={() => setDateFilter(f.key)}
              style={[styles.filterChip, active ? styles.filterChipActive : null]}
            >
              <Text style={[styles.filterText, active ? styles.filterTextActive : null]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {dateFilter === "today" && (arrivals.length > 0 || departures.length > 0) && (
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.summaryArrival]}>
            <Text style={styles.summaryNumber}>{arrivals.length}</Text>
            <Text style={styles.summaryLabel}>Arrivals</Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryDeparture]}>
            <Text style={styles.summaryNumber}>{departures.length}</Text>
            <Text style={styles.summaryLabel}>Departures</Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={
            reservations.length === 0 ? styles.emptyContainer : styles.listContainer
          }
          data={reservations}
          keyExtractor={(item) => item.id}
          refreshControl={refreshControl}
          renderItem={({ item }) => <ReservationCard item={item} />}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No reservations found</Text>
              <Text style={styles.emptyBody}>Try changing the date filter.</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          }
        />
      )}
    </View>
  );
}

function ReservationCard({ item }: { item: Reservation }) {
  const isArrival = item.check_in?.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const isDeparture = item.check_out?.slice(0, 10) === new Date().toISOString().slice(0, 10);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.guestName}>{item.guest_name || "Unknown guest"}</Text>
        <View style={[styles.chip, chipForStatus(item.status)]}>
          <Text style={styles.chipText}>{item.status}</Text>
        </View>
      </View>

      <Text style={styles.propertyName}>
        {[item.property_name, item.unit_name].filter(Boolean).join(" · ")}
      </Text>

      <View style={styles.datesRow}>
        <Text style={[styles.dateText, isArrival ? styles.dateHighlight : null]}>
          In: {formatDate(item.check_in)}
        </Text>
        <Text style={[styles.dateText, isDeparture ? styles.dateHighlight : null]}>
          Out: {formatDate(item.check_out)}
        </Text>
      </View>

      <View style={styles.metaRow}>
        {item.guests_count != null && (
          <Text style={styles.meta}>{item.guests_count} guests</Text>
        )}
        {item.source && <Text style={styles.meta}>{item.source}</Text>}
        {item.total_amount != null && (
          <Text style={styles.meta}>
            {item.currency === "PYG" ? "₲" : "$"}
            {item.total_amount.toLocaleString()}
          </Text>
        )}
      </View>
    </View>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(parsed);
}

function chipForStatus(status: string) {
  const s = status?.toLowerCase();
  if (s === "confirmed") return styles.chipSuccess;
  if (s === "checked_in") return styles.chipWarning;
  if (s === "cancelled") return styles.chipDanger;
  return styles.chipInfo;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f7f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  filterChip: { borderWidth: 1, borderColor: "#d8dede", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff" },
  filterChipActive: { backgroundColor: "#1b6f65", borderColor: "#1b6f65" },
  filterText: { color: "#2c3d42", fontSize: 12, fontWeight: "600" },
  filterTextActive: { color: "#fff" },
  summaryRow: { flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  summaryCard: { flex: 1, borderRadius: 12, padding: 12, alignItems: "center" },
  summaryArrival: { backgroundColor: "#dbe8f6" },
  summaryDeparture: { backgroundColor: "#fce7c5" },
  summaryNumber: { fontSize: 24, fontWeight: "800", color: "#1f3136" },
  summaryLabel: { fontSize: 12, color: "#4c5f65", fontWeight: "600" },
  listContainer: { paddingHorizontal: 14, paddingBottom: 24, gap: 10 },
  emptyContainer: { flexGrow: 1, padding: 16, justifyContent: "center" },
  emptyCard: { borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 16, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#1f3136" },
  emptyBody: { fontSize: 14, color: "#4c5f65" },
  error: { fontSize: 13, color: "#b91c1c" },
  card: { borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 14, gap: 6 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  guestName: { fontSize: 15, fontWeight: "700", color: "#1f3136", flex: 1 },
  propertyName: { fontSize: 13, color: "#587078" },
  datesRow: { flexDirection: "row", gap: 16 },
  dateText: { fontSize: 13, color: "#4c5f65" },
  dateHighlight: { color: "#1b6f65", fontWeight: "700" },
  metaRow: { flexDirection: "row", gap: 12, marginTop: 2 },
  meta: { fontSize: 12, color: "#587078" },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: "700", color: "#1b2c30" },
  chipSuccess: { backgroundColor: "#d8f2e2" },
  chipWarning: { backgroundColor: "#fce7c5" },
  chipDanger: { backgroundColor: "#f8d4d4" },
  chipInfo: { backgroundColor: "#dbe8f6" },
});
