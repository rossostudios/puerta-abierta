type ClerkTokenGetter = () => Promise<string | null>;

let clerkTokenGetter: ClerkTokenGetter | null = null;

export function registerClerkClientTokenGetter(getter: ClerkTokenGetter | null) {
  clerkTokenGetter = getter;
}

export async function getClerkClientAccessToken(): Promise<string | null> {
  if (!clerkTokenGetter) return null;
  try {
    return (await clerkTokenGetter()) ?? null;
  } catch {
    return null;
  }
}

