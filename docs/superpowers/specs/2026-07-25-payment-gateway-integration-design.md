# Payment Gateway Integration — Design

**Status:** Approved for planning
**Scope:** Backend only (`apps/api`). No frontend/UI in this change — the frontend redirect target is an env-configured URL, consumed later.
**Depends on:** `add-hotel-vehicle-booking-core` (merged — booking lifecycle, `PaymentProviderPort` abstraction), `add-rate-limiting` (merged — new webhook route inherits the global default throttle).

## Problem

Booking confirmation currently works like this: the traveler calls `POST /bookings/:id/confirm-payment` themselves, and the backend immediately calls `StubPaymentProviderService.charge()`, which always returns `{ success: true }`. There is no real payment gateway, no actual money movement, and — critically — **the traveler is trusted to self-report that they paid**. `confirm-payment` has no `@Roles` restriction; any authenticated user who knows a booking ID they own can mark it CONFIRMED without any real charge occurring.

This module replaces the stub with SSLCommerz (Bangladesh's largest payment aggregator — supports bKash, Nagad, Rocket, and cards behind one integration), and fixes the trust model: only a **cryptographically-verified webhook from SSLCommerz itself** may confirm a booking. It also adds refund-on-cancellation and per-vendor commission tracking, since real money now moves through the platform.

## Architecture

```
Traveler                Backend                   SSLCommerz          (super-admin, manual)
   │                       │                          │
   │ POST /bookings/:id/   │                          │
   │   initiate-payment    │                          │
   │──────────────────────▶│ create session ─────────▶│
   │                       │ (store tran_id on booking)│
   │◀──────────────────────│ { gatewayUrl }            │
   │  { gatewayUrl }       │                          │
   │                                                   │
   │  browser redirects to gatewayUrl                  │
   │───────────────────────────────────────────────────▶│
   │      customer pays via card/bKash/Nagad/Rocket      │
   │                                                   │
   │                       │◀── IPN webhook ───────────│
   │                       │  POST /payments/           │
   │                       │    sslcommerz/ipn          │
   │                       │  → Order Validation API ──▶│
   │                       │    (confirm genuine,        │
   │                       │     amount matches) ◀───────│
   │                       │  booking HELD → CONFIRMED   │
   │                       │  vendor-owed amount stored  │
   │                       │                          │
   │  browser redirects to FRONTEND_URL/.../success      │
   │◀──────────────────────────────────────────────────│
                                                          │
                            (super-admin later reviews vendor-owed
                             ledger, sends bKash/bank transfer
                             manually — no automated payout in
                             this module)
```

This module touches the existing `Booking` lifecycle only at the CONFIRMED transition (unchanged states/guards otherwise) and adds one new public route (the webhook). It does not change the booking-creation, checkout, or auto-cancel-timer logic from `add-hotel-vehicle-booking-core`. A second, independent path also reaches the same CONFIRMED transition: a scheduled `PaymentReconciliationProcessor` job polls SSLCommerz directly for any booking whose IPN may have been lost — see "Reconciliation" below. The diagram above shows only the happy-path IPN flow; the reconciliation path is a fallback that runs continuously in the background regardless of whether any given IPN succeeds or fails to arrive.

### Why redirect + webhook, not a synchronous server-to-server charge

SSLCommerz (like virtually all Bangladeshi aggregators) is fundamentally a hosted-checkout gateway: the customer is redirected to SSLCommerz's own payment page to enter card/mobile-banking details, and SSLCommerz — not this backend — talks to the actual banks/bKash/Nagad. The backend never sees card numbers or OTPs. Confirmation therefore can only arrive asynchronously, after the customer completes payment on SSLCommerz's page, via their IPN (Instant Payment Notification) webhook. Modeling this any other way (e.g., pretending it's synchronous) would not match how the gateway actually operates.

### Why the webhook must independently re-validate with SSLCommerz, not just trust the IPN payload

An IPN POST body alone is not proof of a genuine payment — anyone who guesses/observes the URL shape could POST a fabricated "success" body. SSLCommerz's own recommended integration pattern (documented in their API) is: on receiving an IPN, call their server-to-server **Order Validation API** with the `val_id` from the IPN payload, and only trust the result of _that_ call (which confirms the transaction is genuine, unmodified, and for the expected amount) — never the IPN body's claims directly. This module follows that pattern exactly.

## Data Model (Prisma changes)

```prisma
enum PaymentStatus {
  PENDING     // session created, awaiting customer to complete checkout
  PAID        // IPN validated, booking CONFIRMED
  FAILED      // customer abandoned/failed at gateway, or validation failed
}
// No REFUNDED value — this module never issues a refund (see "Refund on
// Cancellation" below). Add it in the future module that introduces a real
// refund policy, alongside the code that actually sets it; an unused enum
// value today would be dead, untestable code.

model User {
  // ...existing fields unchanged...
  commissionRatePercent Int @default(10) @map("commission_rate_percent")
  // Integer percent (0-100), not a float — avoids floating-point rounding
  // issues when computing vendor-owed amounts against integer minor-unit
  // totals. Super-admin sets this per-vendor via a new admin endpoint;
  // applies uniformly across all of that vendor's hotels/vehicles.
}

model Booking {
  // ...existing fields unchanged...
  paymentStatus     PaymentStatus @default(PENDING) @map("payment_status")
  gatewayTranId     String?       @unique @map("gateway_tran_id")
  // SSLCommerz's own transaction id, generated by this backend when the
  // session is created (tran_id parameter sent TO SSLCommerz) — this is
  // the join key used to match an incoming IPN back to a Booking row, AND
  // the key used by the reconciliation job's Transaction Query API calls
  // (see "Reconciliation" below). Generated via randomUUID() — high-entropy,
  // not sequential/guessable (a predictable tran_id would let an attacker
  // enumerate other customers' transaction ids).
  gatewayValId      String?       @map("gateway_val_id")
  // SSLCommerz's val_id, present only after their IPN fires (or after the
  // reconciliation job independently discovers a PAID transaction) — passed
  // back to their Order Validation API to independently re-confirm the
  // payment.
  vendorOwedMinor   Int?          @map("vendor_owed_minor")
  // Denormalized cache of the same amount recorded in LedgerEntry below —
  // convenient for quick reads (e.g. "how much do I owe this vendor right
  // now"), but LedgerEntry is the source of truth for anything
  // audit-sensitive. Computed once, at confirmation time, using whatever
  // commissionRatePercent the vendor has at that instant — frozen, NOT
  // recomputed if the vendor's rate changes later.

  ledgerEntries LedgerEntry[]
}
// No refundedAt field — this module never sets a refund timestamp (see
// PaymentStatus note above). Add it alongside REFUNDED in the future
// refund-policy module.

enum LedgerEntryType {
  GROSS_PAYMENT   // the full amount the customer paid (totalAmountMinor)
  PLATFORM_FEE    // the commission StayBangla retains
  VENDOR_OWED     // what the vendor is owed (GROSS_PAYMENT - PLATFORM_FEE)
}

model LedgerEntry {
  id                String          @id @default(uuid())
  bookingId         String          @map("booking_id")
  type              LedgerEntryType
  amountMinor       Int             @map("amount_minor")
  ratePercentApplied Int            @map("rate_percent_applied")
  // The commissionRatePercent value that was in effect when this entry was
  // written — recorded even on the GROSS_PAYMENT row (where it's not used
  // for that row's own amount) so every entry is independently
  // self-describing without needing to join back to the vendor's
  // (possibly since-changed) current rate.
  createdAt         DateTime        @default(now()) @map("created_at")

  booking Booking @relation(fields: [bookingId], references: [id])

  @@index([bookingId])
  @@map("ledger_entries")
}
```

Every successful payment confirmation writes exactly three `LedgerEntry` rows in the same database transaction as the booking's HELD→CONFIRMED update: one `GROSS_PAYMENT` (the full `totalAmountMinor`), one `PLATFORM_FEE` (the commission amount), one `VENDOR_OWED` (the remainder). This is an append-only, immutable audit trail — no `LedgerEntry` row is ever updated or deleted by this module. It exists specifically so "how much money moved, when, at what rate, for which booking" is always independently reconstructable without trusting a single mutable column — the same reasoning any real marketplace (Stripe Connect included) applies to money movement. `add-earnings-analytics-dashboard` (ROADMAP 2.3) reads from this table later; this module only writes to it.

Raw-SQL migration note: `gatewayTranId`'s `@unique` constraint is expressible natively in Prisma (no raw SQL needed this time) — unlike the booking-core module's `daterange`/`EXCLUDE` constraints, this is an ordinary unique index.

### Rounding

`PLATFORM_FEE = floor(totalAmountMinor * commissionRatePercent / 100)`, `VENDOR_OWED = totalAmountMinor - PLATFORM_FEE` (computed by subtraction, not by its own separate floor/round, so the two entries always sum exactly to `GROSS_PAYMENT` with no unaccounted minor-unit remainder). Integer floor division rounds any fractional minor-unit remainder in the platform's favor (e.g. 10% of 999 minor units = 99.9 → floors to 99, vendor gets 900) — this is a deliberate, documented choice, not an accident.

## Endpoints

```
POST /bookings/:id/initiate-payment      (traveler, own booking, HELD only)
  → creates the SSLCommerz session (session_key, tran_id), persists
    gatewayTranId on the booking, returns { gatewayUrl: string }

POST /payments/sslcommerz/ipn            (PUBLIC — no auth, SSLCommerz calls this directly)
  → receives SSLCommerz's IPN body, extracts val_id, calls the shared
    confirmIfValid(bookingId, valId) path described under "Confirmation
    logic" below
  → always responds 200 to SSLCommerz regardless of internal outcome
    (SSLCommerz retries on non-200; a 200 with internal logging on a
    validation failure is the correct way to stop pointless retries for
    a permanently-invalid transaction — this mirrors SSLCommerz's own
    documented IPN-handling guidance)

GET /bookings/:id/payment-status         (traveler, own booking)
  → read-only: { paymentStatus, gatewayTranId } — lets the
    eventually-built frontend poll/display current status without
    re-triggering anything; NOT a replacement for the old confirm-payment
    (does not mutate booking state)
```

### Removed

`POST /bookings/:id/confirm-payment` is deleted entirely. No caller — traveler or otherwise — can transition a booking from HELD to CONFIRMED except the validated confirmation path below (triggered by either the IPN webhook or the reconciliation job — never a plain user request).

### Confirmation logic (shared by both the webhook and reconciliation — see below)

A single service method, `confirmIfValid(bookingId, valId)`, is the only code path that can move a booking from HELD to CONFIRMED. Both `POST /payments/sslcommerz/ipn` and the reconciliation job (below) call this same method — there is exactly one place this logic is written, not two copies that could drift:

1. Look up the booking by `bookingId`; if not found or not `HELD`, return early (idempotent no-op — covers both "already confirmed by the other path" and "unrelated/garbage id").
2. Call `PaymentProviderPort.validateTransaction(valId)` (the real SSLCommerz Order Validation API call).
3. Reject (no state change) unless ALL of: `valid === true`, returned `amountMinor === booking.totalAmountMinor`, returned `currency === booking.currency` (guards against a cross-currency/cross-amount spoofing attempt, not just amount alone), and (if SSLCommerz's response includes it) the returned `store_id` matches this app's configured `SSLCOMMERZ_STORE_ID` (guards against a transaction validated against a _different_ SSLCommerz store somehow being replayed here).
4. Guarded update: `booking HELD → CONFIRMED` via the existing `updateMany`-with-count-check race-safety pattern.
5. If the guarded update's count was 0 (lost the race — e.g. reconciliation and the IPN fired at almost the same moment, or the hold already expired), stop — no ledger entries written, no double-processing.
6. If the guarded update succeeded: in the same database transaction, set `paymentStatus=PAID`, `gatewayValId`, `vendorOwedMinor`, write the three `LedgerEntry` rows (GROSS_PAYMENT/PLATFORM_FEE/VENDOR_OWED), and cancel the auto-expiry BullMQ job.

### Reconciliation (closes the "IPN never arrives" gap)

SSLCommerz's IPN delivery is at-least-once but **not guaranteed** — network issues or an outage on either side can drop it silently. Without a fallback, a customer who genuinely paid on SSLCommerz's page but whose IPN never arrives would have their booking auto-cancelled by the existing BullMQ expiry timer (`add-hotel-vehicle-booking-core`) while the platform keeps their money — an unacceptable failure mode for a real payments integration.

A new scheduled job, `PaymentReconciliationProcessor`, runs on a BullMQ repeatable schedule (every 2 minutes) and:

1. Queries for every `Booking` where `status = 'HELD'`, `paymentStatus = 'PENDING'`, `gatewayTranId IS NOT NULL`, and `createdAt` is older than 1 minute (a short grace period — avoids racing a same-second legitimate in-flight IPN) but still before that booking's own hold-expiry deadline.
2. For each, calls SSLCommerz's **Transaction Query API** (`GET /validator/api/merchantTransIDvalidationAPI.php` by `tran_id`) — a different SSLCommerz endpoint than the IPN-triggered Order Validation API, but serving the same purpose: ask SSLCommerz directly "what actually happened to this transaction," independent of whether their IPN successfully reached us.
3. If SSLCommerz reports the transaction as validly paid, extracts its `val_id` and calls the same shared `confirmIfValid(bookingId, valId)` path used by the webhook — so a payment SSLCommerz successfully processed is confirmed here even if their IPN was lost, using the exact same validation/idempotency logic, not a separate weaker path.
4. Bookings SSLCommerz reports as failed/cancelled are left as-is (the existing auto-expiry timer will correctly cancel them on schedule — this job does not need to do anything for the failure case, since a HELD booking cancelling itself is already correct behavior when payment genuinely never completed).

This means the auto-expiry timer's cancellation and this job's confirmation are racing toward the same booking by design — the guarded update in step 4 of "Confirmation logic" above is exactly what makes that safe (whichever reaches the database first wins atomically; the loser's `updateMany` affects zero rows).

## Refund on Cancellation

`POST /bookings/:id/cancel`'s body gains one new optional field: `{ acknowledgeNoRefund?: boolean }`. Existing callers cancelling a HELD booking are entirely unaffected (the field is ignored for HELD bookings — see below); only cancelling a CONFIRMED+PAID booking requires it.

**Explicit policy (approved during brainstorming): HELD cancellation is a full refund (trivially — no charge ever completed); CONFIRMED cancellation gets no refund at all.** This is the simplest possible policy and is a deliberate starting point — a tiered/time-based refund policy (e.g. % refund by days-before-checkin) is explicitly deferred to a future module, not built here.

- Booking in `HELD` + `paymentStatus=PENDING`: cancel as today (status → CANCELLED). No refund call — no charge ever completed, so there is nothing to refund.
- Booking in `CONFIRMED` + `paymentStatus=PAID`: cancel is **not allowed to silently succeed with no refund and no trace** — the traveler must still be told clearly that cancelling a confirmed, paid booking forfeits the payment. `POST /bookings/:id/cancel` on a CONFIRMED booking now requires the caller to pass `{ acknowledgeNoRefund: true }` in the request body; omitting it returns `400 Bad Request` with a message stating no refund will be issued. When acknowledged, the booking transitions to CANCELLED and `paymentStatus` stays `PAID` (money was genuinely kept, not refunded). No SSLCommerz refund API call is made in this module at all.

### Accepted business risk — flagged, not silently shipped

A flat 100%-forfeit-on-cancellation policy carries real dispute/chargeback exposure: a customer who cancels and loses their full payment may dispute the charge through bKash/their card issuer, and "the API required a boolean flag to be true" is thin evidence in a real dispute compared to a graduated, clearly-communicated cancellation policy. This is a **business-policy decision, not an engineering one** — this module implements the simplest possible version (matching what was approved) but explicitly surfaces the risk here rather than letting it go unnoticed: **the tiered/time-based refund policy deferred below should be prioritized soon after this module ships**, not treated as an open-ended "maybe eventually" item.

## Vendor Commission Tracking (not payout)

```
PATCH /admin/vendors/:id/commission       (ADMIN, SUPER_ADMIN)
  body: { commissionRatePercent: number }  (0-100, validated)
  → updates User.commissionRatePercent for that vendor
```

`vendorOwedMinor` and the corresponding `LedgerEntry` rows are computed and frozen the moment `confirmIfValid` confirms payment (using whatever `commissionRatePercent` the vendor has _at that instant_) — not recalculated later. This means changing a vendor's commission rate only affects future bookings, never retroactively alters money already reported as owed for a completed transaction. No payout/disbursement endpoint exists in this module — an admin (today, manually) reads the `VENDOR_OWED` ledger entries (or the denormalized `vendorOwedMinor` cache) for confirmed bookings and wires/bKashes the vendor directly. Building an actual payout/ledger-dashboard UI is explicitly deferred to `add-earnings-analytics-dashboard` (ROADMAP 2.3) — this module's `LedgerEntry` table is the data foundation that dashboard will read from.

## `PaymentProviderPort` — New Interface

The existing abstraction is too narrow (`charge` only) for a real, session-based, webhook-driven gateway. It's extended, not replaced:

```typescript
export interface ChargeResult {
  success: boolean;
}

export interface PaymentSession {
  gatewayUrl: string;
  tranId: string;
}

export interface ValidationResult {
  valid: boolean;
  amountMinor: number;
  currency: string;
  storeId: string | null;
  // SSLCommerz's own store_id from the validation response, when present —
  // cross-checked against this app's configured SSLCOMMERZ_STORE_ID in
  // confirmIfValid() (see "Confirmation logic"). null is treated as "cannot
  // verify this dimension" rather than a hard rejection, since not every
  // SSLCommerz response shape is guaranteed to include it — but when
  // present and mismatched, it's an automatic rejection.
}

export abstract class PaymentProviderPort {
  abstract createSession(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<PaymentSession>;

  abstract validateTransaction(valId: string): Promise<ValidationResult>;
}
```

No `refund()` method — this module's approved cancellation policy never calls SSLCommerz's Refund API (see "Refund on Cancellation" above), so adding it now would be an unused abstraction (YAGNI). A future module that introduces a real refund policy adds it to this interface then, alongside the code that actually calls it.

`StubPaymentProviderService` (still used in unit tests, mirroring the existing pattern) implements both methods with fixed successful fakes. The real implementation, `SslcommerzPaymentProviderService`, wraps SSLCommerz's REST API (session-init endpoint, Order Validation endpoint) using plain `fetch`/`axios`-equivalent calls — no SSLCommerz SDK dependency is required; their API is plain REST+form-encoded.

## New Environment Variables

```
SSLCOMMERZ_STORE_ID=...
SSLCOMMERZ_STORE_PASSWORD=...
SSLCOMMERZ_SANDBOX=true          # z.enum(["true","false"]).transform(...) —
                                  # same literal-string pattern already fixed
                                  # for MINIO_USE_SSL, not z.coerce.boolean()
FRONTEND_URL=http://localhost:3000
```

`FRONTEND_URL` is used to build SSLCommerz's required `success_url`/`fail_url`/`cancel_url` parameters (e.g. `${FRONTEND_URL}/bookings/:id/payment-result`) — the frontend doesn't exist yet, but the backend's session-creation call must supply _some_ URL for SSLCommerz to redirect to, so this is the correct seam: swap the env value later when the frontend ships, zero backend code change needed.

## RBAC / CASL

- `POST /bookings/:id/initiate-payment`: `@Roles("TRAVELER")`, plus service-layer ownership check (`booking.userId === callerId`), matching the existing `create`/`cancel` pattern.
- `POST /payments/sslcommerz/ipn`: intentionally **no guard at all** (public) — SSLCommerz cannot present a JWT. Trust is established entirely by the Order Validation API round-trip inside the handler, not by any route-level guard. This is the same public-endpoint shape already used by `GET /rooms/available`/`GET /hotels/:id`, just for a different reason (external system caller vs. anonymous browsing). Defense-in-depth (not the primary trust mechanism, since the Validation API round-trip alone is already sufficient): the implementation task should check whether SSLCommerz publishes a stable, documented set of IPN source IP ranges and, if so, add an IP-allowlist check ahead of the validation call — a cheap extra layer, not a replacement for validating.
- `GET /bookings/:id/payment-status`: `@Roles("TRAVELER")` + ownership check.
- `PATCH /admin/vendors/:id/commission`: `@Roles("ADMIN", "SUPER_ADMIN")`, mirroring the existing `vendor-verification` admin routes' guard style.

## Testing Strategy

TDD throughout, matching prior modules' discipline. Key risk areas:

- **IPN validation is the single most security-critical path in this module** — tests must prove that an unvalidated/fabricated IPN body (i.e., the mocked `PaymentProviderPort.validateTransaction` returning `valid: false`, or a `val_id` that doesn't correspond to any booking's `gatewayTranId`) never transitions a booking to CONFIRMED.
- **Amount-mismatch detection**: a validation result whose `amountMinor` doesn't match the booking's `totalAmountMinor` must be treated as invalid (protects against a customer somehow paying a different amount than what was requested).
- **Guarded-update race safety** for the IPN handler, exactly as already proven for `confirmPayment`/`checkout`: a duplicate/retried IPN for an already-CONFIRMED booking must be a safe, idempotent no-op (SSLCommerz's own IPN delivery is documented as at-least-once, so duplicates are expected, not exceptional).
- **CONFIRMED-cancellation acknowledgement gate**: an e2e test asserting `POST /bookings/:id/cancel` on a CONFIRMED+PAID booking without `{ acknowledgeNoRefund: true }` returns 400 and leaves the booking untouched (still CONFIRMED); a second test with the flag set confirms it transitions to CANCELLED with `paymentStatus` remaining `PAID`.
- **Commission freezing**: a test that confirms a booking's `vendorOwedMinor` does NOT change if the vendor's `commissionRatePercent` is updated _after_ that booking was already confirmed.
- **`POST /bookings/:id/confirm-payment` no longer exists**: an e2e test asserting the old route now 404s, guarding against an accidental regression that re-adds a traveler-triggerable confirm path.
- **Ledger correctness**: a test confirming that a successful confirmation writes exactly three `LedgerEntry` rows (GROSS_PAYMENT, PLATFORM_FEE, VENDOR_OWED) whose amounts sum exactly to `totalAmountMinor` with no remainder lost or double-counted, and that `PLATFORM_FEE + VENDOR_OWED === GROSS_PAYMENT` holds for a rate that doesn't divide evenly (e.g. a `totalAmountMinor` not a multiple of 10, to actually exercise the floor-rounding path documented above).
- **`confirmIfValid` idempotency across BOTH callers**: a test proving that if the webhook confirms a booking first, a subsequent reconciliation-job pass over the same (now non-HELD) booking is a safe no-op — and the reverse (reconciliation confirms first, a late-arriving IPN for the same booking is a safe no-op) — since both paths share the one method, this is really testing that method's guard once, not two separate implementations.
- **Reconciliation job's grace period**: a test confirming a booking created less than 1 minute ago is NOT yet picked up by the reconciliation query (avoids racing a legitimate in-flight IPN that just hasn't arrived yet), and one created past the grace period but still before hold-expiry IS picked up.

## Explicitly deferred (not scope-creep, tracked for later modules)

| Concern                                                                                                                                                                                                                                | Deferred to                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Automated vendor payout (bank/bKash disbursement API, payout scheduling) — this module tracks what's owed via `LedgerEntry`, not how it gets paid out                                                                                  | `add-earnings-analytics-dashboard` (ROADMAP 2.3)                                                                  |
| Tiered/time-based cancellation refund policy (e.g. % refund by days-before-checkin), and the SSLCommerz Refund API call it would require — flagged above as an accepted, should-revisit-soon business risk, not an indefinite deferral | Should be prioritized as the next follow-up after this module ships                                               |
| bKash direct integration (in addition to/instead of SSLCommerz)                                                                                                                                                                        | Not currently planned; `PaymentProviderPort` abstraction makes this additive later without touching booking logic |
| Per-listing (rather than per-vendor) commission rates                                                                                                                                                                                  | Not requested; explicit decision this module only supports per-vendor granularity                                 |
| Multi-currency payment (SSLCommerz is BDT-only in practice for this market)                                                                                                                                                            | Out of scope — matches existing single-currency assumption noted in architecture decisions                        |
