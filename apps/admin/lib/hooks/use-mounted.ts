import { useSyncExternalStore } from "react";

/**
 * Returns `true` after the component has mounted on the client.
 * Uses `useSyncExternalStore` so the React Compiler can optimize it
 * (avoids the `useState` + `useEffect` → `setMounted(true)` pattern).
 */
const emptySubscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useMounted(): boolean {
  return useSyncExternalStore(emptySubscribe, getSnapshot, getServerSnapshot);
}
