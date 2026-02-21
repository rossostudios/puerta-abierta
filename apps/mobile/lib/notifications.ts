import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { getApiBaseUrl } from "@/lib/config";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Configure notification handler defaults.
 * Call once at app startup (e.g., in _layout.tsx).
 */
export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowInForeground: true,
    }),
  });
}

/**
 * Request push notification permissions and register the Expo push token
 * with the Casaora backend.
 */
export async function registerForPushNotifications(
  organizationId: string
): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn("Push notifications require a physical device");
    return null;
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("Push notification permission not granted");
    return null;
  }

  // Android notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF5D46",
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn("EAS project ID not found in app config");
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  // Register token with backend
  await registerTokenWithBackend(organizationId, token);

  return token;
}

/**
 * Send the push token to the Casaora API for storage.
 */
async function registerTokenWithBackend(
  organizationId: string,
  token: string
): Promise<void> {
  if (!isSupabaseConfigured) return;

  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) return;

  try {
    const baseUrl = getApiBaseUrl();
    await fetch(`${baseUrl}/push-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        token,
        platform: Platform.OS === "ios" ? "ios" : "android",
      }),
    });
  } catch (error) {
    console.error("Failed to register push token:", error);
  }
}

/**
 * Deactivate a push token on the backend (e.g., on logout).
 */
export async function deactivatePushToken(token: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) return;

  try {
    const baseUrl = getApiBaseUrl();
    await fetch(`${baseUrl}/push-tokens/deactivate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch (error) {
    console.error("Failed to deactivate push token:", error);
  }
}

/**
 * Add a listener for received notifications (while app is in foreground).
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener(callback);
}

/**
 * Add a listener for notification responses (user tapped a notification).
 */
export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(callback);
}
