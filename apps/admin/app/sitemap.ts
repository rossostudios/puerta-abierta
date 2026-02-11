import type { MetadataRoute } from "next";

import { fetchPublicMarketplaceListings } from "@/lib/api";

const TRAILING_SLASHES_REGEX = /\/+$/;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(TRAILING_SLASHES_REGEX, "") ||
    "http://localhost:3000";
  const defaultOrgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID?.trim();

  const entries: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1.0 },
    { url: `${siteUrl}/marketplace`, changeFrequency: "daily", priority: 0.9 },
  ];

  try {
    const response = await fetchPublicMarketplaceListings({
      orgId: defaultOrgId || undefined,
      limit: 200,
    });
    const rows = response.data ?? [];
    for (const row of rows) {
      const slug = typeof row.public_slug === "string" ? row.public_slug : "";
      if (!slug) continue;
      entries.push({
        url: `${siteUrl}/marketplace/${encodeURIComponent(slug)}`,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }
  } catch {
    // keep base sitemap entries
  }

  return entries;
}
