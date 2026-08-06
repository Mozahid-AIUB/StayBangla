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
**Create** → **Import a repository** → pick the repository.

Cloudflare's Create flow now produces a **Worker**, not a Pages project. Pages
still exists but is no longer the default path, and the Worker screens have
different fields — there is no "Framework preset" and no "Build output
directory". If a guide mentions those, it predates the change.

For a folder of static files the two are equivalent. The Workers free tier is
100,000 requests a day.

### 3. Build settings

| Field          | Value                                                 |
| -------------- | ----------------------------------------------------- |
| Build command  | `pnpm install && pnpm --filter @staybangla/web build` |
| Deploy command | `npx wrangler deploy`                                 |
| Root directory | _(leave empty — the repository root)_                 |

`wrangler.jsonc` at the repository root is what makes this work. Pointed at a
pnpm workspace with no config to read, `wrangler deploy` inspects the tree,
finds several packages and stops with _"application detection logic has been
run in the root of a workspace instead of targeting a specific project"_. It is
not guessing wrong; it is refusing to guess. The config names the asset
directory so there is nothing to guess about.

Verify it before pushing, from the repository root:

```
npx wrangler deploy --dry-run
```

It should report reading the files from `apps/web/out` without deploying
anything.

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

## How the frontend will reach the API

A static export has no server, so it cannot call the API during rendering —
every request goes out from the visitor's browser.

Two consequences, neither of them blocking:

- **The API needs CORS.** It has to allow the deployed origin explicitly.
  `https://<project>.workers.dev` today, the real domain later.
- **Search results will not be server-rendered.** Google can still index them
  (it runs JavaScript), but they arrive a beat later than markup would. If
  search pages ever need to rank on their own, that is the point to drop
  `output: "export"` and let Next render them on a server.

Neither changes anything about the landing page, which has no data to fetch.

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
