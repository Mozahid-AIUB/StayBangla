# Payment + Auth audit — 2026-08-05

Both subsystems audited independently for the first time, on `main` at `0febd65`, using `.claude/skills/staybangla-review`. Neither had ever been reviewed.

## Auth — VERDICT: NOT SAFE AS-IS. Two Critical.

**AUTH-1 (Critical) — OTP verify issues a token for ANY existing account.**
`otp.controller.ts:73-85`. `verify()` looks up by `findByIdentifier` (matches email OR phone, no role filter), reuses the row if found, and issues a token pair bound to that user's id. Password-based accounts (VENDOR/GUIDE/ADMIN) are reachable by the passwordless flow. Blast radius is limited by `roles: ["TRAVELER"]` being HARDCODED at :84 — role-guarded routes still reject — but the token carries `sub: <victim id>`, so every identity-guarded route is reachable: `GET /users/me`, `PATCH /users/me`, `POST /users/me/resubmit`.

The same hardcode is ALSO a live bug in the other direction: a legitimate VENDOR logging in via OTP is silently downgraded to TRAVELER. Same shape as the previously-fixed login-roles bug, and untested. CONTROLLER-VERIFIED by reading `otp.controller.ts:66-85`.

**AUTH-2 (Critical) — OTP is brute-forceable; the attacker resets their own lockout.**
Three compounding weaknesses:

- (a) `POST auth/otp/verify` has NO `@Throttle` (request/login/register all do), so it falls back to the global default of 100/60s. CONTROLLER-VERIFIED: no decorator at :66.
- (b) `otp.service.ts:103` DELETES `otp:attempts:${identifier}` on every new OTP issue, so the 5-attempt cap at :119 is self-service resettable. CONTROLLER-VERIFIED.
- (c) The `@Throttle` on `request` is keyed by IP (no `getTracker` override anywhere), so only OtpService's own Redis counter is per-identifier.

Net: ~50 guesses/hour/IP against a 6-digit space, and IP rotation is cheap. Each success yields AUTH-1's token.

**AUTH-3 (Important)** — OTP compared with `!==` on hex strings (`otp.service.ts:136`), not `timingSafeEqual`. Weaker than raw-value comparison would be, since both sides are peppered SHA-256 digests the attacker cannot steer — hence Important not Critical. Positive: OTP is stored hashed with a peppered SHA-256, `OTP_PEPPER` min 16 chars, no default.

**AUTH-4 (Important) — 11 authenticated write paths carry no suspension check.** Class 5 recurring for the FOURTH time. 7 paths check, 18 need it. Full enumeration below.

**AUTH-5 (Important)** — `POST /v1/users/me/resubmit` has `RolesGuard` but NO `@Roles`, and `roles.guard.ts:20-22` returns true when metadata is absent. So the guard is decoration that LOOKS like coverage. Any TRAVELER can flip their own `verifiedStatus` to PENDING and inject a bogus row into the admin approval queue. Needs `@Roles("VENDOR","GUIDE")` plus a suspension check.

Minor: CASL policy on `PATCH /users/me` is tautological (F6); refresh has no route throttle (F7); IPN body is an untyped interface so ValidationPipe has nothing to act on (F8); `GET /health/db` is public + unthrottled and hits the DB (F9); `JWT_REFRESH_SECRET`, `THROTTLE_OTP_LIMIT` and `THROTTLE_AUTH_LIMIT` are validated but NEVER READ — an operator rotating the refresh secret during an incident would believe they had invalidated sessions when they had not (F10).

**DEPLOYMENT LANDMINE (not a current defect):** `ConsoleSmsProviderService` / `ConsoleEmailProviderService` log the full OTP in plaintext and are the ONLY providers wired in `providers.module.ts:9-10`, with no environment branch.

### Clean in auth (verified, worth knowing)

- ALL 18 admin routes carry `JwtAuthGuard` + `RolesGuard` + `@Roles("ADMIN","SUPER_ADMIN")` at class level. The unguarded-admin-route failure mode did NOT occur.
- Refresh rotation is genuinely well built: single-use, family-wide revoke on replay, SHA-256 hashed at rest, `randomBytes(48)`, bound to `existing.userId` from the DB not client input. The e2e at `auth-refresh.e2e-spec.ts:45-64` proves it discriminatingly.
- No `passwordHash` leak on any path. Argon2id 19456 KiB / t=2 matches OWASP exactly.
- CASL tag field `__caslSubjectType__` is correct; no fail-open; no cross-vendor path found.
- JWT alg not pinned but passport-jwt defaults to HS256 with a string key, so alg-confusion is unreachable.

### The 15-minute window's real blast radius (11 paths, suspension unchecked)

FINANCIAL/INVENTORY: vendor-ledger create (:28) and soft-delete (:87) — the latter DESTROYS the evidence a fraud suspension exists to preserve; `PATCH /vehicles/:id` (:59); booking checkout (:285) which drives the terminal payout-eligible state; offline-booking cancel (:504); `initiate-payment` which launders a payment past the suspension; traveler cancel (:305).

NON-FINANCIAL: hotel/room photo confirm + DELETE (irreversible MinIO object deletion) and presign (mints URLs that OUTLIVE the token, extending the window past 15 min); `PATCH /users/me`; `users/me/resubmit`.

The accepted-risk framing understates this: soft-delete and MinIO delete are DESTRUCTIVE and cannot be reconciled after the fact.

## Payment — VERDICT: safe to keep taking money, with one Important caveat.

**PAY-1 (Important) — the ledger write is not atomic with the state transition.**
`bookings.service.ts:227-264`. The guarded `updateMany` commits CONFIRMED+PAID at :227, then `ledgerEntry.createMany` runs as a SEPARATE statement at :243. The file's only `$transaction` is at :456 (offline bookings). CONTROLLER-VERIFIED by reading both lines and grepping `$transaction`.

If the process dies between them, the booking is permanently PAID with ZERO ledger rows, and nothing ever revisits it — reconciliation only picks up `status: "HELD"` (`payment-reconciliation.processor.ts:26`) and this one is CONFIRMED. Every payout/earnings read goes through LedgerEntry, so the vendor is owed money the payout system cannot see. `createMany` is itself atomic so a partial 1-of-3 ledger is impossible; all-or-nothing is.

**PAY-2 (Important) — no DB-level uniqueness on `ledger_entries`.** EMPIRICALLY CONFIRMED: `pg_constraint` returns only the PK and the booking FK. Append-only is convention, not structure. The guarded `updateMany` is currently the SOLE thing preventing duplicate GROSS_PAYMENT rows. Any future path that writes a ledger entry without replicating that guard doubles a vendor's revenue silently. `ON DELETE RESTRICT` does prevent deletion via booking removal, and no `ledgerEntry.update`/`delete` call exists anywhere in src.

**PAY-3 (Important)** — `confirmIfValid` (:195) does NOT check vendor suspension, while `createBooking` checks at :77/:98/:119 and `createOfflineBooking`/`createBlock` at :351/:425. A vendor suspended for fraud AFTER a traveler holds a booking still gets CONFIRMED plus a VENDOR_OWED row when the IPN lands. Arguably correct (the traveler genuinely paid) but it is an undisclosed asymmetry in the same seam class, and payout eligibility for a fraud-suspended vendor should be a deliberate decision.

Minor: rounding uses `Math.floor` on the fee with the remainder to the vendor, so `GROSS = PLATFORM_FEE + VENDOR_OWED` holds EXACTLY by construction (vendorOwed is a subtraction, not independently rounded) — the platform absorbs the sub-paisa. NOTE a product limitation: `commissionRatePercent` is `Int` in the schema and `@IsInt()` in the DTO, so fractional rates like 12.5% are NOT REPRESENTABLE AT ALL.

### Clean in payment (verified, and the biggest fear is resolved)

- **FORGED IPN IS NOT EXPLOITABLE.** `confirmIfValid` ignores the body's `status` entirely, independently calls SSLCommerz's validation API with the store password, then re-checks `amountMinor`, `currency` and `storeId` against the booking (:203-216). Amount is re-verified server-side. Correct design.
- Duplicate/retried IPN is safe; reconciliation racing a live webhook resolves the same way.
- Class 4 (int32/BigInt) clean: admin-analytics uses BOTH `::bigint` and `Number()`.
- Class 1 (enum casts) clean in the payment path.
- No-refund policy correctly gated on CONFIRMED+PAID+`!acknowledgeNoRefund`.

### The three parked fast-follows

1. **Placeholder customer fields — STILL PRESENT.** `sslcommerz-payment-provider.service.ts:73-76` sends literal "StayBangla Traveler" / `traveler@staybangla.example` / `01700000000` on EVERY transaction; `createSession` only receives `(bookingId, amountMinor, currency)` so the real user data is not even in scope. MATTERS MORE THAN WHEN PARKED: SSLCommerz uses `cus_phone` / `cus_email` for fraud scoring and dispute resolution.
2. **Commission-rate race — still present** but bounded and low-impact: the window is milliseconds and the rate IS snapshotted into `ratePercentApplied` on every ledger row, so already-written rows are never retroactively altered.
3. **Commission-endpoint 404 gap — FIXED** in `223c3d2`, which also added the audit-log write. Residual: the endpoint validates the user exists but not that they are a VENDOR.

## Test adequacy (both audits agree)

LOAD-BEARING: auth-refresh e2e replay test (asserts the ROTATED token also fails — the discriminating assertion); rbac-casl e2e login→JWT→RolesGuard; the `passwordHash` exclusion assertion on the serialized body; the four admin-panel suspension e2e tests; rate-limiting e2e 429s; payment-confirmation duplicate-IPN test asserting `toHaveLength(3)` with an explicit "not 6" comment — the single best test in the payment subsystem.

DECORATION: all 10 admin controller specs (guard-override theatre — 6 of the 10 controllers have NO e2e 403 test at all); `jwt-access.strategy.spec` asserts `validate()` echoes its input; `otp.controller.spec.ts:110-129` ENCODES AUTH-1 AS INTENDED BEHAVIOUR and would need to become an exclusion test to be worth anything; `casl-ability.factory.spec` tests Hotel/Vehicle rules NO ROUTE USES; auth-otp e2e has no test for single-use, lockout, lockout-surviving-re-request, or vendor-identifier refusal; the `storeId` check is effectively untested e2e (every fixture passes `storeId: null`, taking the early-exit); reconciliation's 60s grace period is `expect.any(Date)` so setting it to 0 keeps it green, and there is NO e2e reconciliation test at all.

## STRUCTURAL RECOMMENDATION (both audits independently reached it)

A `SuspensionGuard` applied alongside `JwtAuthGuard` on every non-GET authenticated route — one DB read on `request.user.id`, reject if `suspendedAt` — would make all 11 unchecked paths structurally impossible AND close the 15-minute window entirely, since it re-reads the DB rather than trusting the JWT claim. Subsumes AUTH-4, most of AUTH-5's impact, and PAY-3.

For payment: `UNIQUE (booking_id, type)` on `ledger_entries` plus wrapping :227-264 in `$transaction` makes double-counting and partial ledgers impossible at the DB level.

## What neither audit could verify

Both databases are EMPTY (0 users, 0 ledger_entries), so all invariant queries returned vacuously. Every finding is reasoning from code, with schema shape as the only empirical input. No exploit was attempted. Real SSLCommerz behaviour (whether the live validation API populates `store_id`, which decides whether the store check ever executes in production) is unknown — all tests mock the provider. Whether the BullMQ reconciliation repeat key actually exists in Redis was not inspected.
