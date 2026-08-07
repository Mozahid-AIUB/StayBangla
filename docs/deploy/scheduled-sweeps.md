# Scheduled sweeps

Two things used to run inside the API as BullMQ jobs: releasing expired holds
and chasing payments whose callback never arrived. Both are now sweeps over the
database, run by whatever scheduler you point at one endpoint.

## Why they moved

**The deadline was in the wrong place.** A hold's expiry was a delayed job in
Redis. Redis is a cache — flush it, restart it without persistence, or move
hosts, and every outstanding deadline is gone. Those rooms stay reserved
forever, no process ever revisits them, and nothing reports it. The deadline is
now `bookings.hold_expires_at`, on the row it belongs to.

**And it pinned the backend to a paid host.** A delayed job only fires while a
worker is awake; a repeatable job only repeats while something is running. Two
background tasks were therefore requiring a process that never sleeps, which no
free tier offers. With them gone the API can scale to zero.

Redis stays in the application — OTP storage and rate limiting still use it.
What left is only the part that needed something awake.

## The endpoint

```
POST /internal/bookings/sweep
x-cron-secret: <CRON_SECRET>
```

Version-neutral, so a scheduler's URL does not break on an API version bump it
has no stake in. Excluded from the OpenAPI document.

Returns what it did:

```json
{ "expired": 3, "reconciled": 1, "checked": 4 }
```

### Authorisation

Set `CRON_SECRET` to a long random string. Generate one with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Two failure modes, deliberately different:

- **503** — `CRON_SECRET` is not set. A route that cancels bookings must not
  quietly stand open because nobody configured it, so an unset secret is
  treated as a broken deployment rather than as "no auth required".
- **403** — the secret is wrong or missing from the request.

The comparison is `timingSafeEqual`. A plain `===` stops at the first differing
byte, so the time it takes leaks how much of the secret was right and the whole
thing can be rebuilt one character at a time.

## Scheduling it

Every minute. The sweep is cheap — one indexed `updateMany`, plus a capped
query — and a minute is close enough that nobody notices a hold outliving its
deadline.

**Cloudflare Workers** (free, and the recommended option):

```js
export default {
  async scheduled(event, env) {
    await fetch(`${env.API_URL}/internal/bookings/sweep`, {
      method: "POST",
      headers: { "x-cron-secret": env.CRON_SECRET },
    });
  },
};
```

with `"triggers": { "crons": ["* * * * *"] }` in `wrangler.jsonc`.

Anything that can send an authenticated POST on a schedule works — Google Cloud
Scheduler, GitHub Actions on a cron, cron-job.org.

### It also keeps the API warm

On a scale-to-zero host a NestJS container cold-starts in three to six seconds,
and the first visitor after a quiet spell pays for it. A request every minute
means there is almost always a warm instance. That is roughly 43,000 requests a
month against Cloud Run's two million free — not worth measuring.

## What the sweep guarantees

**It only ever touches `HELD` rows.** That predicate is the safety argument: a
booking confirmed a millisecond earlier no longer matches, so two overlapping
sweeps — or a sweep racing an incoming IPN — cannot cancel a paid booking.

**Reconciliation runs before expiry.** If a payment landed but the callback was
lost, that booking has to be confirmed before the expiry pass looks at it.
Reversed, a sweep arriving a minute late cancels a booking the traveller has
already paid for, and the money is gone. There is a test asserting the order,
because the failure is silent and expensive.

**Reconciliation is capped at 50 rows.** After an outage is exactly when an
uncapped sweep would try to resolve an entire backlog at once, on the smallest
instance, at the worst moment. The remainder is taken by the next run.

**The comparison carries no timezone.** `hold_expires_at` and "now" are both
instants, and fifteen minutes is fifteen minutes everywhere. This is the one
place in the codebase where Asia/Dhaka is the wrong answer: applying it would
move every deadline six hours, so holds would either die before the traveller
could pay or keep a room locked long after they walked away. A test asserts the
raw instant survives, so a well-meaning "fix" fails loudly.
