# Putting the site online — Cloudflare Pages

The landing page has no server side. No route handlers, no middleware, no
server actions, and until `/search` is wired, no API calls either. So it builds
to plain HTML, CSS and JavaScript and can be served from a CDN edge rather than
from a machine somewhere that has to stay awake.

For a Bangladeshi audience that matters more than it sounds: Cloudflare has a
presence in Dhaka, so the pages are served from inside the country instead of
from Singapore.

Free, and Cloudflare's free tier permits commercial use — which Vercel's Hobby
plan does not, a detail worth knowing before building a business on it.

---

## What you do

### 1. Push the repo to GitHub

Private is fine.

### 2. Create the project

[dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
**Create** → **Pages** → **Connect to Git** → pick the repository.

### 3. Build settings

| Field                  | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Framework preset       | `Next.js (Static HTML Export)`                                     |
| Build command          | `pnpm install && pnpm --filter @staybangla/web build`              |
| Build output directory | `apps/web/out`                                                     |
| Root directory         | _(leave empty — this is a monorepo, the build runs from the root)_ |

### 4. Environment variables

| Name                   | Value                              |
| ---------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-project>.pages.dev` |
| `NODE_VERSION`         | `22`                               |

`NEXT_PUBLIC_SITE_URL` is not decoration. Open Graph images and the canonical
URL have to be absolute, and without it they are generated against
`http://localhost:3000` — so every link shared to Facebook or WhatsApp would
point a stranger's browser at their own machine.

Set it again, to the real domain, the day a domain is added.

### 5. Deploy

The first build takes two or three minutes. After that every push to the
default branch rebuilds automatically, and pull requests get their own preview
URL.

---

## What you get

- `https://<project>.pages.dev`, HTTPS included
- Served from Cloudflare's edge, Dhaka included
- Rebuilt on every push

A domain is not needed to start. `staybangla.com` is roughly 1,200 BDT a year
and can be pointed at the same project later without rebuilding anything —
**Custom domains** in the project settings, one DNS record.

---

## Security headers

`apps/web/public/_headers` is copied into the export and read by Cloudflare.

It is the only place headers can be set on a static site — there is no server
to add them. It carries the clickjacking and MIME-sniffing protections, a
referrer policy so a visitor's search terms do not leak to third parties, and a
Content Security Policy.

Two notes on that CSP, both deliberate:

- `script-src` allows `'unsafe-inline'` because the splash gate is a blocking
  inline script and has to be — it decides whether the overlay is opaque
  before the first frame paints. A nonce would need a server to generate one
  per request, which a static export does not have.
- `img-src` and `media-src` allow `https:` so the photography and the hero
  clips can move to R2 without this file changing first.

---

## Known limits of this setup

**The export is 9.6 MB, and 7.9 MB of that is two video files.** They are in
git, which is the wrong place for them: git keeps every version of a binary
forever, so the repository only gets heavier. Moving them to R2 is the next
step, and doing it while the history is still small is much cheaper than doing
it later.

**`output: "export"` turns off image optimisation, ISR, route handlers and
middleware.** None are in use. The day `/search` needs a server, deleting that
one line in `next.config.ts` puts Next back on a server and the rest keeps
working — Cloudflare Pages runs Next.js in server mode too.

---

## Still to come

The API, Postgres and Redis are not covered here. They are blocked on one code
change: booking expiry and payment reconciliation are BullMQ delayed jobs,
which need a process that never sleeps, and no free tier offers one.

Moving that deadline into a database column with a cron sweep removes the
requirement — and fixes a real weakness while it is at it. Today, if Redis is
ever wiped, every HELD booking stays held forever and nothing notices.

Once that lands: Google Cloud Run (Singapore) for the API, Neon for Postgres,
Upstash for Redis, Cloudflare Workers for the cron. All free.
