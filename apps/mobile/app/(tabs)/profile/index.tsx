import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchMe, resolveActiveOrgId, type MeResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type OrgInfo = {
  id: string;
  name: string;
  role?: string;
};

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [meData, activeOrg] = await Promise.all([
          fetchMe(),
          resolveActiveOrgId(),
        ]);
        if (!cancelled) {
          setMe(meData);
          setOrgId(activeOrg);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSignOut = useCallback(() => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => signOut(),
      },
    ]);
  }, [signOut]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  const user = me?.user;
  const email = user?.email ?? "—";
  const fullName = user?.full_name;

  const orgs: OrgInfo[] = (me?.memberships ?? [])
    .map((m) => ({
      id: m.organization_id,
      name: m.organization_id.slice(0, 8),
      role: m.role,
    }))
    .filter((o) => o.id.length > 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* User card */}
      <View style={styles.card}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>
            {(fullName ?? email)[0]?.toUpperCase() ?? "?"}
          </Text>
        </View>
        {fullName && <Text style={styles.name}>{fullName}</Text>}
        <Text style={styles.email}>{email}</Text>
      </View>

      {/* Organizations */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Organizations</Text>
        {orgs.length === 0 && (
          <Text style={styles.empty}>No organizations found.</Text>
        )}
        {orgs.map((org) => (
          <View
            key={org.id}
            style={[styles.orgRow, org.id === orgId ? styles.orgRowActive : null]}
          >
            <View style={styles.orgInfo}>
              <Text style={styles.orgName}>{org.name}</Text>
              {org.role && <Text style={styles.orgRole}>{org.role}</Text>}
            </View>
            {org.id === orgId && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>Active</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Sign out */}
      <Pressable style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f7f5" },
  content: { padding: 14, gap: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorCard: { borderRadius: 12, backgroundColor: "#fef2f2", padding: 12 },
  errorText: { fontSize: 13, color: "#b91c1c" },
  card: { borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 20, alignItems: "center", gap: 6 },
  avatarCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#1b6f65", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  avatarText: { fontSize: 22, fontWeight: "800", color: "#fff" },
  name: { fontSize: 18, fontWeight: "700", color: "#1f3136" },
  email: { fontSize: 14, color: "#587078" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#587078", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 4 },
  empty: { fontSize: 14, color: "#4c5f65", paddingHorizontal: 4 },
  orgRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#e2e6e6", backgroundColor: "#fff", padding: 14 },
  orgRowActive: { borderColor: "#1b6f65", borderWidth: 2 },
  orgInfo: { flex: 1, gap: 2 },
  orgName: { fontSize: 15, fontWeight: "600", color: "#1f3136" },
  orgRole: { fontSize: 12, color: "#587078" },
  activeBadge: { backgroundColor: "#d8f2e2", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  activeBadgeText: { fontSize: 11, fontWeight: "700", color: "#1b6f65" },
  signOutBtn: { borderRadius: 12, borderWidth: 1, borderColor: "#f8d4d4", backgroundColor: "#fff", padding: 14, alignItems: "center" },
  signOutText: { fontSize: 15, fontWeight: "600", color: "#b91c1c" },
});
