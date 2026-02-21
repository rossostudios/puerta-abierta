import { Stack } from "expo-router";

export default function ReservationsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Reservations" }} />
    </Stack>
  );
}
