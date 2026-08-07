import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** Same reason as the sitemap: a static export needs this written to a file. */
export const dynamic = "force-static";

/**
 * There was no robots.txt at all, which means every crawler had to guess — and
 * once /search exists, a parameterised route is exactly what a crawler will
 * spend its budget on and index thousands of near-identical pages from.
 *
 * Disallowing it now costs nothing (the route does not exist yet) and means the
 * rule is already in place on the day it does.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/search"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
