## ADDED Requirements

### Requirement: Booking requires a signed-in traveller and returns to where it started

`POST /v1/bookings` is restricted to the `TRAVELER` role. When an unauthenticated
visitor chooses a room or a vehicle, the site SHALL send them to sign in and
return them to the same choice afterwards, with the dates they had picked.

Losing the selection at the sign-in step is where a booking is abandoned.

#### Scenario: Signed out, then signed in

- **WHEN** a signed-out visitor chooses a room with dates and signs in
- **THEN** they return to that room with the same dates still selected

#### Scenario: A vendor cannot book

- **WHEN** a signed-in vendor tries to book
- **THEN** the site says the account cannot make bookings, rather than showing
  the API's 403

### Requirement: A held booking states its deadline

`POST /v1/bookings` creates a booking in `HELD` state with a `holdExpiresAt`.
The site SHALL show the remaining time and SHALL warn when it passes rather
than leaving a dead page.

The hold is a stopwatch — `BOOKING_HOLD_MINUTES` from creation — not a
calendar deadline, so it is displayed as a countdown and never converted to a
timezone.

#### Scenario: The hold is visible

- **WHEN** a booking is created
- **THEN** the page shows how long remains before it expires

#### Scenario: The hold runs out before payment

- **WHEN** the countdown reaches zero on an unpaid booking
- **THEN** the page says the hold expired and offers to start again, and does
  not send the visitor to the gateway

### Requirement: Payment is initiated by the API, never by the browser

`POST /v1/bookings/:id/initiate-payment` returns `{ gatewayUrl }`. The site
SHALL send the visitor to that URL and SHALL NOT construct any gateway URL of
its own.

Store credentials live only on the API. A browser that assembled a gateway
request would either expose them or be trivially rewritten.

#### Scenario: The visitor reaches the gateway

- **WHEN** a traveller pays for a held booking
- **THEN** the browser navigates to the `gatewayUrl` the API returned

#### Scenario: Initiation fails

- **WHEN** the API rejects the request
- **THEN** the page shows the reason and keeps the booking, so payment can be
  retried

### Requirement: The payment result page lives at the path the gateway already uses

The site SHALL serve `/bookings/[id]/payment-result`.

This is not a free choice. `SslcommerzPaymentProviderService` is configured
with `{FRONTEND_URL}/bookings/{bookingId}/payment-result?status=…` for
success, failure and cancellation. Any other path means every real payment
ends on a 404 after money has moved.

#### Scenario: The gateway's three outcomes all land somewhere

- **WHEN** the gateway redirects with `status=success`, `status=fail` or
  `status=cancel`
- **THEN** the page renders for each, with wording matching the outcome

### Requirement: The result page trusts the API, not the query string

The page SHALL determine what happened from
`GET /v1/bookings/:id/payment-status` and SHALL treat `?status=` only as a hint
for what to show first.

The query string is attacker-controlled — anyone can open the success URL —
so telling a visitor their booking is paid because the URL says so would be
telling them something the platform has not verified.

#### Scenario: A forged success URL does not claim payment

- **WHEN** someone opens `?status=success` for a booking the API reports
  unpaid
- **THEN** the page shows the booking as unpaid

#### Scenario: The gateway is still confirming

- **WHEN** the API reports a payment status that is neither settled nor failed
- **THEN** the page says confirmation is pending and refreshes, rather than
  guessing

#### Scenario: Someone else's booking

- **WHEN** a traveller opens a result page for a booking that is not theirs
- **THEN** the page shows not-found, because the API returns 404

### Requirement: A traveller can see and cancel their bookings

`/trips` SHALL list the traveller's bookings from `GET /v1/bookings`, newest
first, showing what was booked, the dates, the status and the amount, and SHALL
offer cancellation where the API allows it.

#### Scenario: Bookings are listed

- **WHEN** a signed-in traveller opens `/trips`
- **THEN** their bookings are shown newest first

#### Scenario: No bookings yet

- **WHEN** a traveller has never booked
- **THEN** the page invites them to search, rather than showing an empty list

#### Scenario: Cancelling

- **WHEN** a traveller cancels a booking and the API accepts
- **THEN** the row updates to cancelled without a reload

#### Scenario: Cancelling is refused

- **WHEN** the API refuses the cancellation
- **THEN** the page shows the API's reason and leaves the booking as it was

#### Scenario: Signed out

- **WHEN** a signed-out visitor opens `/trips`
- **THEN** they are sent to sign in and returned to `/trips` afterwards
