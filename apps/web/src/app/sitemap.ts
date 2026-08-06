import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * One page for now, and that is the honest answer.
 *
 * The file exists so the district and listing routes have somewhere to be added
 * as they land, rather than a sitemap being remembered afterwards — which is
 * when a site ends up with half its pages never crawled.
 *
 * lastModified is deliberately not `new Date()`: a sitemap that claims every
 * page changed at build time teaches crawlers the field is meaningless, and
 * they start ignoring it on the pages where it matters.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
