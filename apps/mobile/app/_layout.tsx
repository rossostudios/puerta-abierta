import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { AuthProvider, useAuth } from '@/lib/auth';
import {
  configureNotifications,
  registerForPushNotifications,
  addNotificationResponseListener,
} from '@/lib/notifications';
import { resolveActiveOrgId } from '@/lib/api';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Configure push notification handling before any component mounts
configureNotifications();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <PushNotificationRegistrar />
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </AuthProvider>
  );
}

/** Registers push token once the user is authenticated. */
function PushNotificationRegistrar() {
  const { session } = useAuth();
  const registered = useRef(false);

  useEffect(() => {
    if (!session || registered.current) return;
    registered.current = true;

    resolveActiveOrgId()
      .then((orgId) => registerForPushNotifications(orgId))
      .catch((err) =>
        console.warn('Push registration skipped:', err.message)
      );

    const subscription = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data;
      // Future: navigate based on data.link_path
      console.log('Notification tapped:', data);
    });

    return () => subscription.remove();
  }, [session]);

  return null;
}
