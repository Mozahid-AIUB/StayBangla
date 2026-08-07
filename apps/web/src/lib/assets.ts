/**
 * Where the photography and video are served from.
 *
 * The reason this exists: 7.9 MB of video was committed to git, and git keeps
 * every version of a binary forever — the repository only ever gets heavier,
 * and no amount of deleting the file later takes it back out of the history.
 * Media belongs in object storage. Cloudflare R2 in particular charges nothing
 * for bandwidth out, which for a site that is mostly photographs is the
 * difference between a free tier and a bill.
 *
 * A build-time variable, so it is inlined and there is no runtime lookup on
 * the critical path. Changing it needs a rebuild, which is correct — the
 * hostname your images come from is not something to switch mid-session.
 */

/**
 * The R2 bucket, as a committed default rather than a deployment setting.
 *
 * This used to default to the empty string, which resolved every path against
 * the site's own origin. That is how the hero video came to be broken in
 * production without anyone noticing: the clips had been split into 720p and
 * 1080p renditions and uploaded to R2, but with no base URL the browser asked
 * the site itself for `/videos/hero-1-720.mp4`, which only ever existed in the
 * bucket. All four renditions returned 404, the `onLoadedData` that reveals
 * the layer never fired, and the hero fell back to its still image — which
 * looks entirely deliberate. A missing video is invisible; that is precisely
 * why the value cannot live somewhere a build might not have it.
 *
 * So it is not a build variable in a dashboard. A dashboard setting is absent
 * from `pnpm build` on a laptop, absent from CI, and invisible to anyone
 * reading this repository — three ways to rebuild the same silent failure.
 * The value is a public CDN hostname, not a credential, so committing it costs
 * nothing and makes the wiring answerable from the code alone.
 *
 * The environment still wins when it is set, which is what a custom domain
 * will use: r2.dev is rate-limited and has no Cloudflare caching in front of
 * it, so it is right for now and wrong at volume.
 */
const DEFAULT_MEDIA_BASE =
  "https://pub-fd18f9f3d13f46e18a7b9808ce67e05f.r2.dev";

const MEDIA_BASE = (
  process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? DEFAULT_MEDIA_BASE
).replace(/\/+$/, "");

/**
 * Resolves a media path against wherever media is being served from.
 *
 * Always call this rather than writing `/videos/hero-1.mp4` inline. A path
 * that skips it works locally and 404s the moment media moves, and it does so
 * silently — a missing background image leaves a coloured panel that looks
 * deliberate.
 *
 * @param path Absolute path from the media root, e.g. `/videos/hero-1.mp4`.
 */
export function mediaUrl(path: string): string {
  const normalised = path.startsWith("/") ? path : `/${path}`;
  return `${MEDIA_BASE}${normalised}`;
}
