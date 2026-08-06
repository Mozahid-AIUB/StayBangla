import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Static export.
   *
   * The landing page has no server actions, no route handlers, no middleware
   * and — until /search is wired — no API calls. Every route already builds as
   * prerendered static content, so a Node server would spend its life handing
   * back files it never changes.
   *
   * Exporting means the whole site is HTML, CSS and JS in a folder. That runs
   * on any static host, costs nothing, and puts the pages on a CDN edge rather
   * than behind a single origin — which for a Bangladeshi audience means
   * Cloudflare's Dhaka presence serves them instead of a machine in Singapore.
   *
   * This is not a one-way door. The moment a route needs a server — the search
   * results page reading the API, or auth — deleting this line puts Next back
   * on a server and everything else keeps working.
   *
   * What it disables, and why none of it is in use: the built-in image
   * optimiser (all photography here is CSS background-image, see below),
   * ISR/revalidation, route handlers, and middleware.
   */
  output: "export",

  /**
   * Required by `output: export` — there is no server to resize images on
   * request. Nothing uses next/image yet, so this changes nothing today; it is
   * the line that will have to be dealt with when the district photographs get
   * moved onto next/image, either by pre-generating sizes at build time or by
   * pointing a custom loader at whatever CDN ends up holding them.
   */
  images: { unoptimized: true },

  /**
   * Emits `/about/index.html` rather than `/about.html`, which is what static
   * hosts expect when serving a clean URL without a redirect.
   */
  trailingSlash: true,
};

export default nextConfig;
