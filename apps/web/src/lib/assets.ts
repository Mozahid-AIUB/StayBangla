/**
 * Where the photography and video are served from.
 *
 * Empty by default, which resolves every path to `/videos/...` and
 * `/images/...` — the files as they sit in `public/`. Set
 * `NEXT_PUBLIC_MEDIA_BASE_URL` and the same paths point at object storage
 * instead, with no other change anywhere.
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
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);

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
