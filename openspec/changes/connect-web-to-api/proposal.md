## Why

The API has 61 working endpoints and the site has one page. Nothing a visitor
can do on staybangla.com reaches the backend: the Search button on the landing
page does nothing, there is no way to see a hotel, and no way to book one. The
product is a marketing page in front of a finished engine.

Connecting them also forces four gaps into the open, each of which is cheaper
to fix now than after pages are written against it:

- **A traveller cannot retrieve their own bookings.** There is no
  `GET /v1/bookings` and no `GET /v1/bookings/:id`. Once payment redirects
  away, the booking is unreachable — for the traveller it has vanished. This
  blocks any account area at all.
- **The payment gateway already redirects to a page that does not exist.**
  SSLCommerz is configured with
  `{FRONTEND_URL}/bookings/{id}/payment-result?status=…`. Every real payment
  today would land on a 404 with money taken.
- **Availability search returns no photograph**, so a results page can only be
  a list of names and prices.
- **Availability search requires dates**, so the sixteen district cards on the
  landing page — which invite browsing — have nowhere to send anyone.

## What Changes

**API — the four gaps**

- Add `GET /v1/bookings` (TRAVELER): the caller's own bookings, newest first,
  with the hotel/room or vehicle they refer to.
- Add `GET /v1/bookings/:id` (TRAVELER): one booking, owned by the caller.
  404 rather than 403 for someone else's, so the endpoint cannot be used to
  probe which booking ids exist.
- `GET /v1/rooms/available` returns a cover photograph per room and makes
  `checkIn`/`checkOut` optional. **BREAKING** for the response shape (a field
  is added, which existing consumers ignore) — the parameter change is
  backwards compatible.
- `GET /v1/vehicles/available` likewise makes `startDate`/`endDate` optional.
- `GET /v1/hotels/:id` stops returning rooms with `isActive = false`. Its
  current test asserts the opposite and is replaced.

**Web — the traveller's path, end to end**

- `/search` — results for rooms and vehicles, filtered by district and
  optionally dates. The landing page's Search button and district cards both
  lead here.
- `/hotels/[id]` — the hotel, its photographs and its bookable rooms.
- `/vehicles/[id]` — the vehicle. Vehicles are fully bookable already:
  `CreateBookingDto` takes `bookableType: "ROOM" | "VEHICLE"` and `Booking`
  carries both `roomId` and `vehicleId`, so a vehicle goes through the same
  booking and payment path as a room and needs no separate flow. What it has
  no schema support for is photographs, so the page is a typographic card by
  design rather than a broken image.
- `/bookings/[id]/payment-result` — the path SSLCommerz already redirects to.
- `/trips` — the traveller's bookings, and cancelling one.
- `/signin`, `/register` — including the OTP step, since `POST /auth/otp/*`
  requires a session and the flow is otherwise unreachable.
- An API client that knows about the `/v1` prefix, carries the access token,
  and refreshes it once on a 401.

**Deliberately not in this change**

- Vehicle photographs. There is no `VehiclePhoto` model and adding one means a
  migration, an upload path and a vendor screen. Vehicles get a typographic
  card until vendors can upload; the owner asked for this explicitly.
- The vendor dashboard and the admin panel. Both have complete APIs and both
  are their own changes.

## Capabilities

### New Capabilities

- `traveler-bookings`: a traveller can list and retrieve their own bookings
- `web-api-client`: how the browser reaches the API — base URL, versioning,
  tokens, refresh, and how failures surface
- `web-search`: finding a room or a vehicle by district and dates, including
  browsing without dates
- `web-hotel-detail`: a hotel's public page and its bookable rooms
- `web-booking-flow`: creating a booking, paying, and returning from the
  gateway
- `web-auth`: register, sign in, OTP, and what a signed-in browser holds

### Modified Capabilities

<!-- openspec/specs/ is empty; nothing existing to amend. The API changes to
     rooms/available, vehicles/available and hotels/:id are described in the
     new capabilities that consume them. -->

## Impact

**API** — `apps/api/src/bookings/` (new controller and service methods),
`apps/api/src/hotels/` (availability query, hotel detail), `apps/api/src/
vehicles/`. The availability queries are raw SQL and bind a `District` enum;
that cast (`::"District"`) has to survive the edit. No schema change, so no
migration.

**Web** — `apps/web/src/app/` gains six routes and `apps/web/src/lib/` gains
the API client. The landing page's search form and district cards stop being
inert. `output: "export"` in `next.config.ts` stays: every new page reads the
API from the browser, so none of them needs a server.

**Configuration** — the web build needs the API's base URL, which is currently
not set anywhere. It follows `NEXT_PUBLIC_MEDIA_BASE_URL`: a committed default
in code rather than a dashboard setting, because a missing build variable
produced a silently broken hero video once already.

**CORS** — `CORS_ORIGINS` in the API's production environment must list the
site's origin, or every request from the browser is blocked. It currently does.

**Risk** — money moves through `/bookings/[id]/payment-result`. It reads
`GET /v1/bookings/:id/payment-status` rather than trusting the `status` query
parameter, which is attacker-controlled: anyone can open the success URL.
