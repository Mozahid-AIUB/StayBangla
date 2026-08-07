## Context

The API is 61 endpoints, tested, deployed to nothing yet. The web app is one
static landing page whose Search button is inert and whose sixteen district
cards link nowhere. Neither has ever spoken to the other.

Facts that constrain everything below, all read from the code rather than
assumed:

- **URI versioning is on.** `configure-app.ts` sets
  `VersioningType.URI, defaultVersion: "1"`. Every endpoint is under `/v1`
  except three marked `VERSION_NEUTRAL`: `/health`,
  `/payments/sslcommerz/ipn`, `/internal/bookings/sweep`.
- **The payment return path is already fixed.**
  `SslcommerzPaymentProviderService` sends the gateway
  `{FRONTEND_URL}/bookings/{id}/payment-result?status=…`.
- **Money is in minor units.** `pricePerNightMinor`, `totalAmountMinor`, all
  `Int`, currency alongside.
- **Availability is raw SQL** with a Postgres range overlap
  (`b.date_range && daterange(...)`) and an enum bound as
  `${city}::"District"`. Two exclusion constraints on `bookings` are what
  actually prevent double-booking.
- **`output: "export"`.** There is no server. Every page is a static file and
  every API call happens in the visitor's browser.
- **The site is deployed by hand** — `wrangler deploy`, not a Git integration.
- **Vehicles have no photographs** anywhere in the schema, but are fully
  bookable: `bookableType: "ROOM" | "VEHICLE"`, and `Booking` carries both
  `roomId` and `vehicleId`.

## Goals / Non-Goals

**Goals:**

- A visitor can search, open a hotel or a vehicle, book it, pay, come back
  from the gateway, and find the booking again later.
- The four API gaps that block that path are closed.
- One API client, so the version prefix, the token and refresh are decided
  once.
- Every page has a defined empty state and a defined failure state. "No rooms
  in Sylhet next week" and "the API is down" must not render identically.

**Non-Goals:**

- Vehicle photographs. No `VehiclePhoto` model exists; adding one means a
  migration, an upload path and a vendor screen. Decided with the owner:
  vehicles get a typographic card and vendors upload later.
- The vendor dashboard and the admin panel. Both APIs are complete; both are
  their own changes.
- Server-side rendering. Nothing here needs it, and `output: "export"` is a
  door that stays open.
- Payment gateway credentials. `SSLCOMMERZ_STORE_ID` and password are still
  empty in production, so live payment cannot be exercised end to end yet.

## Decisions

### The API base URL is committed in code, not set in a dashboard

Same shape as `NEXT_PUBLIC_MEDIA_BASE_URL`: read from the environment, with a
committed default.

This has already gone wrong once. `NEXT_PUBLIC_MEDIA_BASE_URL` was never set
anywhere, so the base resolved to the empty string, the browser asked the site
for `/videos/hero-1-720.mp4`, all four renditions 404'd, and the hero fell back
to its still image — which looks deliberate. Nobody noticed for a day.

A dashboard build variable is absent from `pnpm build` on a laptop, absent from
CI, and invisible to anyone reading the repository. An API origin is not a
credential. Committing it makes the wiring answerable from the code.

**Alternative considered:** a build variable in the Cloudflare project. Rejected
for the reason above — three ways to reproduce the same silent failure.

### The version prefix belongs to the client, not to call sites

Callers pass `/bookings`; the client emits `/v1/bookings`.

A path written by hand in a component would 404, and a 404 from a list endpoint
looks like "no data" rather than "wrong URL". Putting the prefix in one place
means it can only be wrong once. The three version-neutral paths are not
reachable from the browser at all, so the client does not need an escape hatch.

### The result page asks the API what happened

`?status=success` is a hint about which state to render first. The answer comes
from `GET /v1/bookings/:id/payment-status`.

The query string is attacker-controlled: anyone can open the success URL for
any booking id. Rendering "paid" from it would state something the platform has
not verified, on the one page where being wrong costs money. The API returns
404 for a booking that is not the caller's, which also handles someone opening
another traveller's result page.

**Alternative considered:** trusting the redirect and reconciling later via
IPN. Rejected: the visitor is looking at the page now, and the IPN may arrive
after they have left.

### Dates become optional rather than defaulted

Making `checkIn`/`checkOut` optional in the DTOs, not filling them in with
"today + 1".

A default date silently changes what the visitor is looking at and, worse,
makes an empty result mean two different things. Optional dates keep the two
questions — where, and when — separable, which is the order people actually
answer them in. A half-specified range (one date without the other) stays a
400: it has no meaning.

The raw SQL keeps its `::"District"` cast. That cast is load-bearing: without
it Postgres cannot compare a text parameter to the enum column, and the query
fails at runtime rather than at build time.

### One cover image per search result, resolved server-side

`RoomAvailability` gains a nullable cover key: the room's first photograph,
else the hotel's, else null.

Doing it in the browser would mean a request per result. Doing it in a second
API round trip would mean the page renders twice. The availability query
already joins `hotels`; a lateral join for one photograph is the cheapest
place.

Null is a supported state, not a defect — the card falls back to its painted
tone, exactly as the district cards do for districts without a photograph.

### Refresh once, then give up

On 401: refresh, retry the original request, and if the refresh also fails,
clear the session.

Retrying more than once turns an expired refresh token into a loop against the
auth endpoint, which is rate-limited and would lock the visitor out of signing
in again.

### The hold is a countdown, never a date

`holdExpiresAt` is displayed as remaining time and never converted to
Asia/Dhaka.

Check-in dates are calendar days in Dhaka; a fifteen-minute hold is a
stopwatch. Applying the timezone to the second would shift every hold by six
hours. This distinction has already caused a defect in this codebase and is
recorded as a recurring one.

### Money is formatted in one place

Minor units to taka happens in a single helper, tested, alongside the existing
date helpers.

`350000` rendering as ৳350,000 rather than ৳3,500 is both plausible-looking and
a hundredfold error.

## Risks / Trade-offs

**A page reads a field the API does not return** → The API's return types are
exported interfaces (`RoomAvailability`, `HotelDetailResult`, `BookingRecord`).
The web app takes its types from those rather than redeclaring them, so a
mismatch fails `pnpm typecheck` instead of rendering `undefined`.

**Making dates optional weakens the availability filter** → The existing
overlap test stays and a test for the no-dates path is added beside it. The
database's exclusion constraints remain the real guarantee; the query is a
filter, not the safety net.

**Removing inactive rooms from hotel detail breaks its current test** → The
test asserts the defect. It is rewritten in the same commit, not deleted, and
the rewrite asserts the new behaviour.

**Live payment cannot be tested** → `SSLCOMMERZ_STORE_ID` and password are
empty in production. The flow is built and tested against the stub provider;
the first live payment is a manual check once credentials exist. Called out
rather than discovered at launch.

**CORS blocks everything from the browser** → `CORS_ORIGINS` must contain the
site's origin. It currently does. A custom domain later means updating it, or
every request fails with no useful message in the browser.

**The site deploys only by hand** → Frontend work is not live until
`wrangler deploy` runs. Recorded so a green CI is not mistaken for a release.

## Migration Plan

No schema change, so no database migration. The API changes are additive except
one: hotel detail stops returning inactive rooms, which nothing consumes today
because nothing consumes the API at all.

Order matters — the API changes ship first, because pages written against the
old shapes would have to be rewritten:

1. API gaps, each with tests: `GET /v1/bookings`, `GET /v1/bookings/:id`,
   optional dates, cover image, inactive rooms.
2. The API client and the shared types it imports.
3. Search, then hotel and vehicle detail — read-only, so they can be verified
   against real data before anything writes.
4. Auth, then the booking flow, then the payment result page, then `/trips`.
5. `wrangler deploy`, then walk the whole path against the deployed API.

**Rollback:** the API changes are additive; reverting the web commits returns
the site to the landing page. Because the deploy is a manual upload, rolling
back is redeploying a previous build rather than reverting a pipeline.

## Open Questions

- **Does the landing page's district card go to `/search?city=…`, or to a
  district page?** The proposal assumes search. A district page would want
  copy per district that does not exist yet.
- **Where does a vendor land after registering?** The vendor dashboard is not
  in this change, so registration currently ends on a page that says approval
  is pending. Acceptable for now; it becomes the dashboard's entry later.
- **Is `/trips` the right name?** It is the traveller's own bookings. The API
  calls them bookings; the landing page's language is trips.
