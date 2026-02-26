import { fetchMe, type MePayload } from "@/lib/api";

type AppUserRecord = Record<string, unknown> & {
  id?: unknown;
};

export async function getServerCurrentAppUserId(): Promise<string | null> {
  try {
    const me = (await fetchMe()) as MePayload;
    const user = (me.user ?? null) as AppUserRecord | null;
    return typeof user?.id === "string" && user.id.trim()
      ? user.id.trim()
      : null;
  } catch {
    return null;
  }
}
