/**
 * Client-safe noop for the server access token helper.
 * Resolved via the package.json "imports" field when bundling for client components.
 * The real implementation (server-access-token.ts) is used in RSC / server context.
 */
export async function getServerAccessToken(): Promise<string | null> {
  return null;
}
