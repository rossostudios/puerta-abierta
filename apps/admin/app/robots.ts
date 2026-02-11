import type { MetadataRoute } from "next";

const TRAILING_SLASHES_REGEX = /\/+$/;

export default function robots(): MetadataRoute.Robots {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(TRAILING_SLASHES_REGEX, "") ||
    "http://localhost:3000";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/marketplace", "/marketplace/"],
        disallow: ["/marketplace/apply/", "/module/", "/setup", "/app"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
