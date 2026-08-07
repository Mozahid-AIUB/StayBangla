# Deployment configuration

Two host configs live at the repository root. They do the same job for
different hosts, and neither can carry its own explanation — `vercel.json` is
strict JSON and rejects the file outright if it contains keys it does not
recognise, including `"//"` comments. That is what this file is for.

## Why either file exists

Pointed at a pnpm workspace with no configuration, both hosts inspect the tree,
find several packages, and try to build all of them — so putting a static
landing page online started by compiling the NestJS API, and failing on it.
Cloudflare says so plainly ("application detection logic has been run in the
root of a workspace"); Vercel just runs `nest build` and stops.

Each file names the one build that matters.

## `vercel.json`

| Key               | Why                                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildCommand`    | Builds only `@staybangla/web`. Does the same job as setting Root Directory in the dashboard, with the difference that it lives in git and can be reviewed.                                               |
| `outputDirectory` | `apps/web/out`, where the static export lands.                                                                                                                                                           |
| `framework: null` | Not `"nextjs"`. `next.config.ts` sets `output: "export"`, so the build leaves a folder of files rather than a server. Declaring the framework makes Vercel look for a Next.js server that is not there.  |
| `headers`         | Vercel does not read `_headers` — that is a Cloudflare convention. Without this block the site would deploy with no CSP, no clickjacking protection and no referrer policy, and nothing would report it. |

## `wrangler.jsonc`

Names the asset directory so `wrangler deploy` has nothing to detect. It has no
`main` script: every route is a file, so putting a JavaScript runtime in front
of static assets would cost requests for nothing.

Security headers come from `apps/web/public/_headers`, which Cloudflare reads
automatically from inside the assets directory.

## The duplication is deliberate

The same headers are declared in `vercel.json` and in
`apps/web/public/_headers`, because each host reads only its own format. **They
have to be kept in step.** They exist twice because the site can be hosted in
either place, not because either is optional.

## Production branch

Neither file can set it — it is a dashboard setting on both hosts.

- **Vercel**: Settings → Environments → Production → Branch Tracking
- **Cloudflare**: Settings → Build → Branch control

A push to any other branch still gets its own preview URL, which is enough
until the branch merges.
