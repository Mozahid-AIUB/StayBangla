# Auth audit findings — fix report

Branch: `fix/auth-payment-audit-findings`, based on `main` at `0febd65`.
Scope: AUTH findings only (CRITICAL 1, CRITICAL 2, AUTH-3, AUTH-5, SuspensionGuard). Payment findings (ledger atomicity, DB uniqueness) are out of scope — `bookings.service.ts`'s payment path and `ledger_entries` were not touched.

**Status note on this report:** unit tests were run and confirmed green (388/388). The full e2e suite was **not run to completion** in this session — it was interrupted while waiting on a long background job. Every new/changed behavior below has RED→GREEN evidence from targeted `jest --config test/jest-e2e.json <spec> -t "<name>"` runs (all passing), but the full 133-baseline e2e count has not been re-verified end-to-end. This must be run before merge.

---

## CRITICAL 1 — OTP verify issues a token for ANY existing account

**File:** `apps/api/src/auth/otp.controller.ts`

**Half 1 — reject non-traveler accounts.** After `otpService.verifyOtp()` succeeds, `verify()` now looks up the existing user and checks `passwordHash === null && roles.every(r => r === TRAVELER)`. If that's false (password set, or any non-TRAVELER role), it throws `ForbiddenException` — no token is issued, no fallback to creating a new account. VENDOR/GUIDE/ADMIN/SUPER_ADMIN accounts, and any TRAVELER-plus-something account, are refused outright.

**Half 2 — roles are derived, not hardcoded.** `roles: ["TRAVELER"]` is gone. For a reused (pure-traveler) account, roles are now `existing.roles.map(r => r.role)`; for a freshly created account it's `[Role.TRAVELER]`. This matches the shape `CredentialsService.login()` already builds (`user.roles.map(r => r.role)`).

**Decision on the vendor-downgrade question:** I did **not** implement "log a vendor in via OTP but issue their real roles" — I refuse the OTP path for that account entirely (Half 1) and direct them to `POST /auth/login`. So: nothing silently downgrades, because nothing is issued at all for a non-pure-traveler account. This is a stricter interpretation than "derive correctly" alone would require, but it's what the finding explicitly asked for: "must not be able to obtain a token this way." The roles-derivation code in Half 2 is defensive/correct-on-its-own-terms — it only fires for the pure-TRAVELER-reuse case, where it's currently a no-op relative to the old hardcode (both produce `["TRAVELER"]`), but it removes the incorrect assumption from the code so a future change to what "pure traveler" means doesn't reintroduce the bug silently.

**Enumeration trade-off (why 403 with a specific message, not a generic error):** The rejection happens _after_ `verifyOtp()` succeeds — the caller has already proven control of the identifier's inbox/phone by receiving and correctly re-entering a 6-digit code. Telling them "this account uses password login" at that point reveals nothing they haven't already established by controlling the identifier. This is different from the pre-auth timing oracle the audit found on `POST /auth/login` (where an attacker who does _not_ control the identifier could distinguish account-exists vs not by response timing) — here the precondition of correct-OTP-entry already gates it. Reasoning stated in a code comment at the throw site.

**Test coverage:**

- `otp.controller.spec.ts`: 8 tests (was 4). New/changed: rejects existing password-holding account even if role is TRAVELER; rejects existing VENDOR account; rejects TRAVELER+GUIDE (extra role) rather than downgrading; derives roles from actual roles for a reused pure-TRAVELER account. The old test `"verify() reuses an existing user instead of creating a duplicate"` (which encoded the bug as intended behavior per the audit) is now `"...reuses an existing pure-TRAVELER user..."` and asserts the mock is a pure-TRAVELER shape.
- `test/auth-otp-security.e2e-spec.ts` (new file): `refuses to issue a token for an existing VENDOR identifier, even with the correct OTP` — boots real `AppModule`, creates a real verified vendor via `createVerifiedVendor`, requests+captures a real OTP via an overridden `SmsProviderPort`, verifies with the correct OTP, asserts 403 and no `accessToken`. Also `still allows a brand-new... identifier` as a control (201).

**RED confirmed:** stashed `otp.controller.ts`/`otp.service.ts`, ran the unit spec — 3 new tests failed for the right reason (hardcoded roles array; no rejection). Ran the e2e spec — `refuses to issue a token for an existing VENDOR identifier` failed with `Expected 403, Received 201`. Restored, both green.

---

## CRITICAL 2 — OTP brute-forceable, attacker resets own lockout

**(a) No `@Throttle` on verify.** Added `@Throttle({ default: { limit: 10, ttl: 60000 } })` on `POST auth/otp/verify`. Set to 10, not 5, deliberately — see (c).

**(b) Attempt counter reset on every OTP issue — THE CRUX FIX.** `otp.service.ts`'s `requestOtp()` no longer calls `redis.del('otp:attempts:${identifier}')`. The counter is left alone across re-requests. It now gets its own TTL, set once on the _first_ failed attempt in a window: `if (nextAttempts === 1) await redis.expire(attemptsKey, this.attemptsWindowSeconds)`. **Lifetime chosen: 3600 seconds (1 hour)**, via new config key `OTP_ATTEMPTS_WINDOW_SECONDS` (default 3600, validated in `env.validation.ts`, documented in `.env.example`). Rationale: it matches the existing `OTP_RATE_LIMIT_PER_IDENTIFIER_PER_HOUR` window (5 requests/hour), so both the "how many OTPs can you request" and "how many guesses do you get" limits reset on the same cadence — one mental model, and an attacker who exhausts guesses can't just wait 60s (the resend cooldown) to try again, they wait up to an hour.

**Confirmed the counter survives a re-request:** new unit test `"does not reset the attempt counter when a new OTP is requested — the lockout survives a re-request"` — requests OTP, burns all 5 attempts (Redis mock shows `otp:attempts:<id> = "5"`), re-requests a fresh OTP (clearing only the unrelated cooldown key), asserts the attempts key is STILL `"5"`, then asserts the _next_ verify call (with the correct new OTP) still throws "locked". New e2e test `"keeps an identifier locked out after 5 wrong attempts even after a new OTP is requested"` does the same over real HTTP + real Redis: 5 wrong `/verify` calls, re-request a real new OTP via the overridden SMS provider, verify with the _correct_ fresh OTP, assert 401 `/locked/i`.

**(c) IP-only tracker; identifier rotation cheap.** Added `apps/api/src/common/throttler/identifier-throttler.guard.ts` (`IdentifierThrottlerGuard extends ThrottlerGuard`), overriding `getTracker()` to key by `req.body.identifier` when present (falls back to IP otherwise). Applied at the `OtpController` class level via `@UseGuards(IdentifierThrottlerGuard)`, so both `request` and `verify` are now keyed by the phone/email being targeted, not the caller's IP — IP rotation no longer resets this counter, only rotating the _victim's_ identifier would, which the attacker doesn't control.

**Why verify's HTTP throttle is 10/min, not 5/min:** `OTP_MAX_ATTEMPTS` (service-layer lockout) defaults to 5. If the HTTP throttle were also 5/min, the 6th call needed to _observe_ the lockout (5 wrong + 1 more to see the 401) would be blocked by the HTTP layer first (429) and never reach the service's 401 "locked" response — the throttle would mask the lockout rather than complement it. 10/min leaves room for that, while still being tight (an attacker gets at most 10 tries/min/identifier from HTTP, and the real backstop is the service-layer counter bounding total guesses per identifier per hour, not this per-minute limit).

**AUTH-3 — timing-unsafe comparison.** `otp.service.ts`: replaced `storedHash !== this.hashOtp(otp)` with a new `hashesMatch()` helper using `crypto.timingSafeEqual` on `Buffer.from(hex)` for both sides (length-checked first, since `timingSafeEqual` throws on unequal lengths). Did not touch OTP storage — still peppered SHA-256 as before.

**Test coverage:** `otp.service.spec.ts` grew from 9 to 11 tests (the 2 new ones above). `auth-otp-security.e2e-spec.ts` has the identifier-lockout e2e. Existing `otp.controller.spec.ts`/`rate-limiting.e2e-spec.ts` tests were checked for conflicts with the new verify throttle value (none found — no existing test asserted verify's throttle count).

**RED confirmed:** stashed `otp.service.ts`, ran unit spec — both new tests failed (`Expected: "5", Received: undefined` for the survive-re-request test; `expire` called with `undefined` window instead of `otp:attempts:...` for the TTL test). Stashed controller+service+guard together, ran the e2e spec — `keeps an identifier locked out...` failed with `Expected 401, Received 201` (fresh OTP let the attacker straight through). Restored; both green.

---

## AUTH-5 — `POST /users/me/resubmit` reachable by any role

`apps/api/src/users/users.controller.ts`: added `@Roles("VENDOR", "GUIDE")` to the `resubmit` handler (it already had `JwtAuthGuard, RolesGuard`, just no metadata — `RolesGuard` returns `true` on absent metadata, so this was pure decoration before).

**Test coverage:** `test/vendor-approval.e2e-spec.ts`, new test `"a TRAVELER cannot call POST /users/me/resubmit (403, not silently accepted)"`. Boots real `AppModule`, **no `overrideGuard`** — a controller-spec-with-stubbed-guards would stay green even with `@Roles` deleted (that's the guard-override theatre the skill warns about), so this had to be a real e2e.

**RED confirmed:** stashed `users.controller.ts`, ran the new e2e test — `Expected 403, Received 201` (a TRAVELER's resubmit call succeeded and flipped `verifiedStatus`). Restored; green (403).

---

## SuspensionGuard

**File:** `apps/api/src/auth/guards/suspension.guard.ts`. Injects `PrismaService` (globally available via `@Global() PrismaModule`), reads `suspendedAt` fresh from the DB keyed on `request.user.id`, throws `ForbiddenException` if set.

### Design decisions

- **Applied per-route, not globally.** Added via `@UseGuards(..., SuspensionGuard)` alongside `JwtAuthGuard` on each of the specific write-method handlers, matching how `RolesGuard`/`PoliciesGuard` are already applied in this codebase (no precedent for a global `APP_GUARD` beyond `ThrottlerGuard`). A global guard would need an explicit bypass list for every public GET (search, hotel/vehicle detail), `GET /health`, and — critically — the `VERSION_NEUTRAL` SSLCommerz IPN webhook (`payments.controller.ts`), which has **no `JwtAuthGuard` at all** and would break payment confirmation entirely if a global suspension check ran ahead of it. Per-route avoids that risk by construction: I never touched a controller/route without `JwtAuthGuard` already present, so the guard only ever runs where `request.user` is already populated. I did not modify `payments.controller.ts`, `hotels.controller.ts`'s `findOne`/`available`, `vehicles.controller.ts`'s `findOne`/`available`, `rooms.controller.ts`'s `available`, or `health.controller.ts` — confirmed by diff, these remain guard-untouched.
- **Sits alongside existing service-layer checks, not replacing them.** `HotelsService.create`, `RoomsService.create/update`, `VehiclesService.create`, and `BookingsService.createBooking/createOfflineBooking/createBlock` already have their own `suspendedAt` checks — left untouched. Defence in depth: a controller route that someday forgets the guard is still caught by the service; a service check that's ever refactored away is still caught by the guard. The cost is some duplicated logic, which I judged worth it given this is the fourth recurrence of this exact seam class on this codebase.
- **DB read cost:** one extra `SELECT suspendedAt FROM users WHERE id = ?` per guarded request. No caching. This is deliberate — caching would reopen exactly the staleness window (JWT-claim-trusting, up to 15 min) this guard exists to close. A suspension takes effect on the _very next_ guarded request after the admin's suspend call commits, not after a token expires or a cache TTL elapses. Proven directly by the e2e tests below (suspend happens, then the _same still-valid token_ is immediately rejected on the next call).
- **`PATCH /v1/users/me`:** deliberately left **uncovered**. A suspended user — including a suspended vendor — should still be able to edit their own contact/profile info; that's needed for dispute resolution and appeal, has no financial/inventory/evidence impact, and blocking it serves no protective purpose (it's the one path in the 11 that isn't a financial, inventory, or evidence-destroying action). Stated explicitly per "do not silently skip any of the 11."

### Coverage against the 11 paths

| #   | Path                                     | Covered?                     | Notes                                                                                                                                                                |
| --- | ---------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /v1/vendor/ledger-entries`         | Yes                          | `SuspensionGuard` added to `createLedgerEntry`                                                                                                                       |
| 2   | `DELETE /v1/vendor/ledger-entries/:id`   | **Yes**                      | `SuspensionGuard` added to `deleteLedgerEntry` — e2e-proven (see below)                                                                                              |
| 3   | `PATCH /v1/vehicles/:id`                 | Yes                          | `SuspensionGuard` added to `update`                                                                                                                                  |
| 4   | `POST /v1/bookings/:id/checkout`         | Yes                          | `SuspensionGuard` added                                                                                                                                              |
| 5   | `DELETE /v1/vendor/bookings/offline/:id` | Yes                          | `SuspensionGuard` added to `cancelOfflineBooking`                                                                                                                    |
| 6   | `POST /v1/bookings/:id/initiate-payment` | Yes                          | `SuspensionGuard` added                                                                                                                                              |
| 7   | `POST /v1/bookings/:id/cancel`           | Yes                          | `SuspensionGuard` added                                                                                                                                              |
| 8   | hotel/room photo `confirm`               | Yes                          | Both `hotels.controller.ts` and `rooms.controller.ts`                                                                                                                |
| 9   | hotel/room photo `DELETE`                | **Yes**                      | Both — e2e-proven for hotel photo delete (see below)                                                                                                                 |
| 10  | hotel/room photo `presign`               | Yes                          | Both                                                                                                                                                                 |
| 11  | `PATCH /v1/users/me`                     | **Deliberately not covered** | See rationale above — profile edits carry no financial/inventory/evidence risk; blocking self-service contact updates during a dispute is actively counterproductive |

10 of 11 covered; 1 deliberately excluded with reasoning stated.

**Test coverage — `test/admin-panel.e2e-spec.ts`, 2 new tests, both against real `AppModule`, no overrides:**

- `"a suspended vendor cannot soft-delete a manual ledger entry with their still-valid access token"` — creates a ledger entry, suspends the vendor via the real admin endpoint, attempts delete with the **same pre-suspension token**, asserts 403, then re-fetches the list and asserts the entry is still present (proving the guard blocked it, not that the delete silently no-op'd).
- `"a suspended vendor cannot delete a hotel photo with their still-valid access token"` — real presign→MinIO upload→confirm, suspend, attempt delete with the same token, asserts 403.

**RED confirmed:** stashed `vendor-dashboard.controller.ts` + `hotels.controller.ts` (removing the guard wiring), ran both new tests — both failed with `Expected 403, Received 200` (the destructive action succeeded against a suspended vendor). Restored; both green (403).

I did not e2e-test all 10 covered paths individually (checkout, initiate-payment, cancel, vehicle update, offline-cancel, room photo confirm/delete/presign) — the guard is a single reusable class with one already-e2e-proven code path (`canActivate`), and its wiring onto each route is a one-line `@UseGuards` addition mechanically identical across all of them. The two chosen (ledger delete, hotel photo delete) are the two the audit explicitly called "highest-value... destroy evidence," so they're where independent proof matters most.

---

## Env vars changed

New: `OTP_ATTEMPTS_WINDOW_SECONDS`, default `3600`, added to `env.validation.ts` (`z.coerce.number().int().positive().default(3600)`) and documented in `apps/api/.env.example`. **Has a default — no deploy action required.** `.env` and `.env.test` were left unmodified since the schema default covers both without needing explicit values.

---

## Full test results

- **Unit:** `pnpm run test:unit` — **388/388 passed, 56/56 suites**, confirmed via a completed background run (baseline was 382; +6 net new: 4 in `otp.controller.spec.ts`, 2 in `otp.service.spec.ts`). `tsc --noEmit` — clean, no output.
- **E2E:** **NOT run to completion this session.** Every individual new/changed e2e assertion was verified via targeted `jest --config test/jest-e2e.json <file> -t "<name>"` runs (all passing, all RED-confirmed against unfixed code per the sections above), but the full 133-spec e2e suite has not been re-run end-to-end since these changes landed. This is the one outstanding verification gap and should be run before merge — I do not have a number for it and am not reporting one.

## Files changed

- `apps/api/src/auth/otp.controller.ts`, `otp.service.ts` — CRITICAL 1, CRITICAL 2, AUTH-3
- `apps/api/src/auth/otp.controller.spec.ts`, `otp.service.spec.ts` — new/updated unit tests
- `apps/api/src/auth/guards/suspension.guard.ts` — new
- `apps/api/src/common/throttler/identifier-throttler.guard.ts` — new
- `apps/api/src/users/users.controller.ts` — AUTH-5 (`@Roles` on resubmit)
- `apps/api/src/bookings/bookings.controller.ts`, `.spec.ts` — SuspensionGuard wiring (checkout, initiate-payment, cancel) + spec guard-override fix
- `apps/api/src/hotels/hotels.controller.ts`, `.spec.ts` — SuspensionGuard wiring (photo presign/confirm/delete) + spec fix
- `apps/api/src/hotels/rooms.controller.ts`, `.spec.ts` — same, for rooms
- `apps/api/src/vehicles/vehicles.controller.ts`, `.spec.ts` — SuspensionGuard on `update` + spec fix
- `apps/api/src/vendor-dashboard/vendor-dashboard.controller.ts`, `.spec.ts` — SuspensionGuard on ledger create/delete, offline booking create/cancel + spec fix
- `apps/api/src/config/env.validation.ts`, `apps/api/.env.example` — new `OTP_ATTEMPTS_WINDOW_SECONDS`
- `apps/api/test/auth-otp-security.e2e-spec.ts` — new file, CRITICAL 1 + CRITICAL 2(b) e2e coverage
- `apps/api/test/admin-panel.e2e-spec.ts` — 2 new SuspensionGuard e2e tests
- `apps/api/test/vendor-approval.e2e-spec.ts` — 1 new AUTH-5 e2e test

## Self-review against the skill

- **Class 1 (enum casts):** not applicable — no new `Prisma.sql` templates added.
- **Class 2 (Dhaka time):** not applicable — no date bucketing touched.
- **Class 3 (tests that stay green against broken code):** the old `otp.controller.spec.ts` reuse test was exactly this shape (asserted a bug as correct behavior) — replaced with exclusion-style tests (reject password account, reject extra-role account) and RED-verified every new test per-file above. Did not write any admin-controller-spec-with-stubbed-guards as "coverage" for AUTH-5 or SuspensionGuard — both got real-`AppModule` e2e assertions instead.
- **Class 4 (money/BigInt):** not applicable — no money aggregation touched; scope explicitly excludes the payment/ledger path.
- **Class 5 (enforcement seams):** this is the core of the SuspensionGuard work — enumerated all 11 paths against actual code (not the audit's table alone) before writing anything, confirmed via direct reads of `vendor-ledger.service.ts`, `vehicles.service.ts`, `hotels.service.ts`, `rooms.service.ts`, `bookings.service.ts` which checks existed and which didn't, and disclosed the one deliberate gap (`PATCH /users/me`) with reasoning rather than silently omitting it.

## Concerns

1. **Full e2e suite not re-run end-to-end** — the single biggest gap. All touched behavior has targeted RED→GREEN proof, but a full run is needed to catch any cross-suite interaction I didn't anticipate (e.g., the verify-throttle limit change from unset→10/min interacting with some other test's call count).
2. `IdentifierThrottlerGuard` is applied at `OtpController` class level, so it also now governs `POST auth/otp/request` (previously purely IP-keyed at 5/min via its own `@Throttle`) — request's tracker is now identifier-keyed too. This is consistent with the audit's intent but is a behavior change on `request` that wasn't explicitly asked for; worth flagging as intentional rather than assumed-fine.
3. Six controller/spec files needed `overrideGuard(SuspensionGuard, ...)` added because Nest's testing module tries to instantiate any guard referenced in `@UseGuards` even under `Test.createTestingModule` — this was not obvious going in and cost real time; flagging in case a future guard addition hits the same thing.
