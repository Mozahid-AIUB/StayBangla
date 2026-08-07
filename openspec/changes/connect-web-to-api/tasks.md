## 1. API — a traveller can reach their own bookings

- [ ] 1.1 Add `TravelerBookingsService.listForTraveler(travelerId)` returning
      bookings ordered by `checkIn` descending, each with the hotel name, city
      and room type for a room booking, or the category, model and city for a
      vehicle booking. Export the row type so the web app can import it.
- [ ] 1.2 Add `TravelerBookingsService.findOwnedOrThrow(travelerId, id)`
      throwing `NotFoundException` — not `ForbiddenException` — when the
      booking belongs to someone else, so the endpoint cannot be used to probe
      which ids exist.
- [ ] 1.3 Add `GET /v1/bookings` and `GET /v1/bookings/:id` on a controller
      guarded with `JwtAuthGuard, RolesGuard` and `@Roles("TRAVELER")`,
      following the decorator order already used in `bookings.controller.ts`.
- [ ] 1.4 Unit tests: only the caller's bookings come back; a vendor gets 403;
      no token gets 401; a traveller with none gets an empty array and 200;
      another traveller's id and an unknown id both return 404 with the same
      body.
- [ ] 1.5 e2e test walking create → list → fetch by id, asserting that a
      second traveller sees none of the first traveller's bookings.

## 2. API — search without dates, and with a photograph

- [ ] 2.1 Make `checkIn`/`checkOut` optional in `SearchAvailableRoomsDto` and
      `startDate`/`endDate` optional in the vehicle equivalent. Reject one
      without the other with a 400 that names the missing field.
- [ ] 2.2 Rewrite `searchAvailableRooms` so the overlap clause is applied only
      when both dates are present. Keep the `${city}::"District"` cast — without
      it Postgres cannot compare the parameter to the enum column and the query
      fails at runtime.
- [ ] 2.3 Same for `searchAvailableVehicles`.
- [ ] 2.4 Add a nullable cover image key to `RoomAvailability`: the room's first
      photograph, else its hotel's, else null. Resolve it in the same query
      rather than in a second round trip.
- [ ] 2.5 Tests: district only; no parameters at all; dates still exclude an
      overlapping `CONFIRMED` booking; reversed range still 400; one date
      without the other 400; a suspended vendor's rooms stay hidden with and
      without dates.
- [ ] 2.6 Tests for the cover: room photograph wins over hotel's; hotel's is
      the fallback; null when neither has one.

## 3. API — the hotel page stops offering rooms that cannot be booked

- [ ] 3.1 Filter `isActive: true` on the rooms include in
      `findPublicDetailOrThrow`.
- [ ] 3.2 Rewrite the existing test that asserts inactive rooms are returned —
      it locks in the defect. Assert instead that a hotel with two active rooms
      and one deactivated returns two, and that a hotel whose rooms are all
      deactivated returns 200 with an empty list rather than 404.

## 4. Web — the API client

- [ ] 4.1 `lib/api.ts`: base URL from `NEXT_PUBLIC_API_BASE_URL` with a
      committed production default, `/v1` added by the client, callers pass
      unversioned paths.
- [ ] 4.2 Typed error carrying HTTP status and the API's message, so a page can
      tell an empty result from an unreachable API from an ended session.
- [ ] 4.3 Session storage for the access token and current user, surviving a
      reload, cleared on sign-out.
- [ ] 4.4 On 401: refresh once via `POST /auth/refresh`, retry the original
      request, and on a second failure clear the session and surface an
      unauthenticated error. Never more than one refresh per request.
- [ ] 4.5 Tests: the prefix is added; a 401 refreshes and retries transparently;
      a failed refresh clears the session; refresh is called exactly once.
- [ ] 4.6 `lib/money.ts`: minor units to taka, tested. `350000` must read as
      ৳3,500 — the hundredfold error is the plausible-looking one.

## 5. Web — search

- [ ] 5.1 `/search` reading `city`, `checkIn`, `checkOut` from the URL so a
      result page can be shared and bookmarked.
- [ ] 5.2 Result cards for rooms and vehicles as separate groups with counts.
      Rooms use the cover image with the painted fallback when it is null;
      vehicles are typographic by design, with no image placeholder.
- [ ] 5.3 Empty state that names what was searched and offers to clear the
      dates; failure state that says the search could not run and offers a
      retry. These must not look the same.
- [ ] 5.4 Wire the landing page's search form to `/search`, and the sixteen
      district cards to `/search?city=<district>` — the cards become links
      rather than articles.
- [ ] 5.5 Verify at 360px and on desktop that cards, empty state and failure
      state all hold up, and that the type over any cover image clears WCAG
      the way the district cards do.

## 6. Web — hotel and vehicle detail

- [ ] 6.1 `/hotels/[id]`: name, district, photographs, and each bookable room
      with type, capacity, nightly price and photograph.
- [ ] 6.2 Carry dates through from search: show nights and a total per room
      when dates are present, and ask for dates before booking when they are
      not.
- [ ] 6.3 Not-found state with a way back to search, for an id that does not
      exist or a hotel that is inactive.
- [ ] 6.4 `/vehicles/[id]`: category, model, district, capacity, daily price.
      No image placeholder — the schema has no vehicle photographs and this is
      a deliberate treatment.

## 7. Web — auth

- [ ] 7.1 `/signin` against `POST /auth/login`, storing the session and
      returning the visitor to where they were headed.
- [ ] 7.2 `/register` against `POST /auth/register`, letting the visitor choose
      to travel or to list a property, and telling a vendor that approval is
      needed before listings appear.
- [ ] 7.3 OTP request and verify after sign-in, since both endpoints need a
      session. Show the resend cooldown as a disabled button with time
      remaining, and state plainly when the attempt limit is reached — including
      that a new code will not clear the lockout.
- [ ] 7.4 Header reflects the session: sign in when signed out; name, bookings
      and sign out when signed in.
- [ ] 7.5 Suspension is explained rather than shown as a generic failure.

## 8. Web — booking and payment

- [ ] 8.1 Booking creation from a room or a vehicle: signed-out visitors go to
      sign in and come back to the same choice with the same dates.
- [ ] 8.2 Show the hold countdown from `holdExpiresAt`, as remaining time —
      never converted to a timezone. A hold is a stopwatch; a check-in date is
      a Dhaka calendar day.
- [ ] 8.3 When the countdown reaches zero, say the hold expired and offer to
      start again rather than sending the visitor to the gateway.
- [ ] 8.4 Payment initiation: navigate to the `gatewayUrl` the API returns.
      Never construct a gateway URL in the browser.
- [ ] 8.5 `/bookings/[id]/payment-result` — this exact path, because
      `SslcommerzPaymentProviderService` already sends the gateway
      `{FRONTEND_URL}/bookings/{id}/payment-result?status=…`. Any other path
      means every real payment ends on a 404 after money has moved.
- [ ] 8.6 The page determines the outcome from
      `GET /bookings/:id/payment-status` and treats `?status=` only as a hint.
      Verify that opening `?status=success` on an unpaid booking does not claim
      payment.
- [ ] 8.7 Pending state that refreshes while the gateway is still confirming,
      rather than guessing.
- [ ] 8.8 `/trips`: the traveller's bookings newest first, with cancellation
      where the API allows it, an invitation to search when there are none, and
      a redirect to sign-in that returns to `/trips`.

## 9. Verify and ship

- [ ] 9.1 `pnpm typecheck`, `pnpm lint` and the full test suite green across
      both apps.
- [ ] 9.2 Confirm `CORS_ORIGINS` on the API includes the site's origin — every
      browser request fails without it, with nothing useful in the console.
- [ ] 9.3 Walk the whole path against the deployed API: search → hotel →
      book → pay → return → `/trips` → cancel.
- [ ] 9.4 Check the same path at 360px.
- [ ] 9.5 `wrangler deploy` — the site is published by hand, not by pushing.
      A green CI is not a release.
- [ ] 9.6 Record in ROADMAP.md that the frontend has started; its Frontend
      section still says no real page exists.
