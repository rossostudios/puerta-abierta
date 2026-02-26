export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3001"
  );
}

export function getAdminUrl(): string {
  return process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3000";
}
