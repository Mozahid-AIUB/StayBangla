# Payment Gateway Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub payment provider with a real SSLCommerz redirect+webhook integration, remove the self-reported `confirm-payment` trust gap, add a reconciliation job for lost webhooks, an append-only commission ledger, and a no-refund-on-CONFIRMED cancellation policy.

**Architecture:** New `PaymentProviderPort` interface (`createSession`/`validateTransaction`) with a real `SslcommerzPaymentProviderService` implementation. A single shared `confirmIfValid(bookingId, valId)` method in `BookingsService` is the only code path that can move a booking HELD→CONFIRMED, called by both the public IPN webhook controller and a new BullMQ repeatable reconciliation job. Commission tracking via a new append-only `LedgerEntry` table, written in the same transaction as confirmation.

**Tech Stack:** NestJS, Prisma 6, BullMQ (existing `@nestjs/bullmq`, using its native `repeat` option — no new dependency), plain `fetch` for SSLCommerz's REST API (no SDK dependency, per design doc).

## Global Constraints

- `POST /bookings/:id/confirm-payment` is deleted entirely — no caller can self-report payment.
- Only `confirmIfValid(bookingId, valId)` may transition a booking HELD → CONFIRMED; both the IPN handler and the reconciliation job call this one method, never duplicate the logic.
- `confirmIfValid` rejects unless ALL of: `valid === true`, `amountMinor === booking.totalAmountMinor`, `currency === booking.currency`, and (if present) `storeId === SSLCOMMERZ_STORE_ID`.
- Guarded-update race safety: `updateMany({ where: { id, status: "HELD" }, data: { status: "CONFIRMED" } })`, checking `count === 1` before writing ledger entries — exact pattern already used by `checkout`/`cancel` in this file.
- `commissionRatePercent` is an integer (0-100), never a float.
- `PLATFORM_FEE = floor(totalAmountMinor * commissionRatePercent / 100)`; `VENDOR_OWED = totalAmountMinor - PLATFORM_FEE` (by subtraction, so the two always sum exactly to `GROSS_PAYMENT`).
- No `refund()` method on `PaymentProviderPort` — this module never calls a refund API (YAGNI, per design).
- No `PaymentStatus.REFUNDED` value and no `Booking.refundedAt` field — never set in this module (YAGNI, per design).
- `SSLCOMMERZ_SANDBOX` env var parses as `z.enum(["true", "false"]).transform((v) => v === "true")` — NOT `z.coerce.boolean()` (that coerces the literal string `"false"` to `true`, the exact bug already fixed once for `MINIO_USE_SSL`).
- `gatewayTranId` generated via `randomUUID()` — high-entropy, not sequential.
- Reconciliation job polls every 2 minutes, with a 1-minute grace period after a booking's `createdAt` before it's eligible (avoids racing a legitimate in-flight IPN).

---

## File Structure

```
apps/api/prisma/
├── schema.prisma                                    [MODIFY: +PaymentStatus enum,
│                                                      +User.commissionRatePercent,
│                                                      +Booking.paymentStatus/gatewayTranId/
│                                                      gatewayValId/vendorOwedMinor,
│                                                      +LedgerEntryType enum, +LedgerEntry model]
└── migrations/<ts>_add_payment_gateway/              [NEW]

apps/api/src/
├── config/
│   ├── env.validation.ts                             [MODIFY: +SSLCOMMERZ_*, +FRONTEND_URL]
│   └── env.validation.spec.ts                        [MODIFY: +tests]
├── common/payments/
│   ├── payment-provider.port.ts                       [MODIFY: new interface shape]
│   ├── stub-payment-provider.service.ts                [MODIFY: implement new interface]
│   ├── stub-payment-provider.service.spec.ts           [MODIFY: update tests]
│   ├── sslcommerz-payment-provider.service.ts           [NEW]
│   ├── sslcommerz-payment-provider.service.spec.ts      [NEW]
│   └── payments.module.ts                              [MODIFY: real provider wiring]
├── bookings/
│   ├── bookings.service.ts                             [MODIFY: +initiatePayment,
│   │                                                     +confirmIfValid, +cancel policy change,
│   │                                                     removed confirmPayment]
│   ├── bookings.service.spec.ts                        [MODIFY]
│   ├── bookings.controller.ts                          [MODIFY: +initiate-payment,
│   │                                                     +payment-status, removed confirm-payment]
│   ├── bookings.controller.spec.ts                     [MODIFY]
│   ├── bookings.types.ts                               [MODIFY: +paymentStatus field]
│   ├── dto/cancel-booking.dto.ts                       [NEW]
│   ├── payments.controller.ts                          [NEW — IPN webhook, separate
│   │                                                     controller since it's public/unauthenticated
│   │                                                     and belongs conceptually with payments]
│   ├── payments.controller.spec.ts                     [NEW]
│   ├── bookings.module.ts                              [MODIFY: wire new controller/queue]
│   └── queue/
│       ├── payment-reconciliation-queue.service.ts      [NEW]
│       └── payment-reconciliation.processor.ts          [NEW]
├── admin/
│   ├── commission.controller.ts                        [NEW]
│   ├── commission.controller.spec.ts                   [NEW]
│   ├── dto/update-commission.dto.ts                    [NEW]
│   └── admin.module.ts                                 [MODIFY: wire new controller]
└── .env / .env.example / .env.test                      [MODIFY: +SSLCOMMERZ_*, +FRONTEND_URL]

apps/api/test/
├── helpers/test-fixtures.ts                            [MODIFY: +createHeldBooking helper if needed]
├── payment-confirmation.e2e-spec.ts                    [NEW]
├── payment-reconciliation.e2e-spec.ts                  [NEW]
├── booking-cancellation-policy.e2e-spec.ts             [NEW]
└── admin-commission.e2e-spec.ts                        [NEW]
```

---

## Task 1: Prisma schema — PaymentStatus, LedgerEntry, Booking/User fields

**Files:**

- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**

- Produces: `PaymentStatus` enum (`PENDING`, `PAID`, `FAILED`), `LedgerEntryType` enum (`GROSS_PAYMENT`, `PLATFORM_FEE`, `VENDOR_OWED`), `LedgerEntry` model, `User.commissionRatePercent: Int`, `Booking.paymentStatus/gatewayTranId/gatewayValId/vendorOwedMinor` — consumed by every later task.

- [ ] **Step 1: Add the new enums and fields**

Read the current `apps/api/prisma/schema.prisma` first to find the exact `User` and `Booking` model blocks (they currently end right before the closing `}` — insert new fields as the last fields before that closing brace, after the existing fields, so the diff is additive-only).

Add these two new enums directly after the existing `enum BookingStatus { ... }` block:

```prisma
enum PaymentStatus {
  PENDING
  PAID
  FAILED
}

enum LedgerEntryType {
  GROSS_PAYMENT
  PLATFORM_FEE
  VENDOR_OWED
}
```

Add this field to the `User` model (as the last field before its closing `}`):

```prisma
  commissionRatePercent Int @default(10) @map("commission_rate_percent")
```

Add these four fields to the `Booking` model (as the last fields before its closing `}`), plus the new relation:

```prisma
  paymentStatus   PaymentStatus @default(PENDING) @map("payment_status")
  gatewayTranId   String?       @unique @map("gateway_tran_id")
  gatewayValId    String?       @map("gateway_val_id")
  vendorOwedMinor Int?          @map("vendor_owed_minor")

  ledgerEntries LedgerEntry[]
```

Add the new `LedgerEntry` model at the end of the file:

```prisma
model LedgerEntry {
  id                 String          @id @default(uuid())
  bookingId          String          @map("booking_id")
  type               LedgerEntryType
  amountMinor        Int             @map("amount_minor")
  ratePercentApplied Int             @map("rate_percent_applied")
  createdAt          DateTime        @default(now()) @map("created_at")

  booking Booking @relation(fields: [bookingId], references: [id])

  @@index([bookingId])
  @@map("ledger_entries")
}
```

- [ ] **Step 2: Generate the migration**

Run:

```bash
pnpm --filter @staybangla/api exec prisma migrate dev --name add_payment_gateway
```

Expected: creates `apps/api/prisma/migrations/<timestamp>_add_payment_gateway/migration.sql`, applies it to the dev database, regenerates the Prisma client. No manual SQL edits needed this time (unlike prior modules) — every new construct here (enums, a unique index, a foreign key, a plain table) is natively expressible in Prisma's schema language.

- [ ] **Step 3: Verify the migration applied cleanly**

Run:

```bash
docker compose -f infra/docker/docker-compose.yml exec postgres psql -U staybangla -d staybangla -c "\d ledger_entries"
```

Expected: output shows the `ledger_entries` table with columns `id, booking_id, type, amount_minor, rate_percent_applied, created_at` and a foreign key to `bookings`.

- [ ] **Step 4: Apply the same migration to the test database**

Run:

```bash
pnpm --filter @staybangla/api exec dotenv -e .env.test -- prisma migrate deploy
```

Expected: the same migration applied to `staybangla_test`.

- [ ] **Step 5: Confirm the full existing test suite still passes with the new schema**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS — this migration is purely additive (new optional fields, new tables), so no existing test's fixtures should break. If any existing test constructs a `Booking`/`User` object literal that TypeScript now flags as missing a required field, that's unexpected — the new fields all have defaults or are nullable, so this should not happen; if it does, stop and report BLOCKED rather than guessing why.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add PaymentStatus/LedgerEntry schema for payment gateway integration"
```

---

## Task 2: Env schema — SSLCommerz + frontend URL config

**Files:**

- Modify: `apps/api/src/config/env.validation.ts`
- Modify: `apps/api/src/config/env.validation.spec.ts`
- Modify: `apps/api/.env`, `.env.example`, `.env.test`

**Interfaces:**

- Produces: `EnvConfig.SSLCOMMERZ_STORE_ID: string`, `EnvConfig.SSLCOMMERZ_STORE_PASSWORD: string`, `EnvConfig.SSLCOMMERZ_SANDBOX: boolean`, `EnvConfig.FRONTEND_URL: string` — consumed by Task 4 (`SslcommerzPaymentProviderService`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/config/env.validation.spec.ts` (matching the existing `REQUIRED_BASE`/`it(...)` style — read the file first to place these correctly, likely needing `SSLCOMMERZ_STORE_ID`/`SSLCOMMERZ_STORE_PASSWORD` added to `REQUIRED_BASE` since they'll be required, non-defaulted fields):

```ts
it("applies SSLCommerz/frontend defaults when not provided", () => {
  const result = validateEnv({
    ...REQUIRED_BASE,
    SSLCOMMERZ_STORE_ID: "test-store",
    SSLCOMMERZ_STORE_PASSWORD: "test-password",
  });
  expect(result.SSLCOMMERZ_SANDBOX).toBe(true);
  expect(result.FRONTEND_URL).toBe("http://localhost:3000");
});

it("throws when SSLCOMMERZ_STORE_ID is missing", () => {
  const { SSLCOMMERZ_STORE_ID: _omit, ...withoutId } = {
    ...REQUIRED_BASE,
    SSLCOMMERZ_STORE_ID: "x",
    SSLCOMMERZ_STORE_PASSWORD: "y",
  };
  expect(() => validateEnv(withoutId)).toThrow(/SSLCOMMERZ_STORE_ID/);
});

it('parses the literal string "false" as boolean false for SSLCOMMERZ_SANDBOX', () => {
  // Same regression class already fixed for MINIO_USE_SSL:
  // z.coerce.boolean() coerces ANY non-empty string (including "false")
  // to true via Boolean(str). Must use the enum+transform pattern instead.
  const result = validateEnv({
    ...REQUIRED_BASE,
    SSLCOMMERZ_STORE_ID: "test-store",
    SSLCOMMERZ_STORE_PASSWORD: "test-password",
    SSLCOMMERZ_SANDBOX: "false",
  });
  expect(result.SSLCOMMERZ_SANDBOX).toBe(false);
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- env.validation`
Expected: FAIL — the new fields don't exist on `EnvConfig` yet.

- [ ] **Step 3: Implement — extend the schema**

In `apps/api/src/config/env.validation.ts`, add these four lines to the `envSchema` object, directly after the existing `THROTTLE_AUTH_LIMIT` field (the last field added by the rate-limiting module):

```ts
  SSLCOMMERZ_STORE_ID: z.string().min(1),
  SSLCOMMERZ_STORE_PASSWORD: z.string().min(1),
  SSLCOMMERZ_SANDBOX: z
    .enum(["true", "false"])
    .default("true")
    .transform((val) => val === "true"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- env.validation`
Expected: PASS.

- [ ] **Step 5: Update the three env files**

Append to `apps/api/.env`:

```
SSLCOMMERZ_STORE_ID=your-sandbox-store-id
SSLCOMMERZ_STORE_PASSWORD=your-sandbox-store-password
SSLCOMMERZ_SANDBOX=true
FRONTEND_URL=http://localhost:3000
```

Append to `apps/api/.env.example`:

```
# SSLCommerz (sandbox credentials from https://developer.sslcommerz.com/registration/)
SSLCOMMERZ_STORE_ID=change-me
SSLCOMMERZ_STORE_PASSWORD=change-me
SSLCOMMERZ_SANDBOX=true
FRONTEND_URL=http://localhost:3000
```

Append to `apps/api/.env.test`:

```
SSLCOMMERZ_STORE_ID=test-store-id
SSLCOMMERZ_STORE_PASSWORD=test-store-password
SSLCOMMERZ_SANDBOX=true
FRONTEND_URL=http://localhost:3000
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.validation.ts apps/api/src/config/env.validation.spec.ts apps/api/.env.example
git commit -m "feat(api): add SSLCOMMERZ_*/FRONTEND_URL env vars"
```

---

## Task 3: New `PaymentProviderPort` interface + updated stub

**Files:**

- Modify: `apps/api/src/common/payments/payment-provider.port.ts`
- Modify: `apps/api/src/common/payments/stub-payment-provider.service.ts`
- Modify: `apps/api/src/common/payments/stub-payment-provider.service.spec.ts`

**Interfaces:**

- Produces: `PaymentSession { gatewayUrl: string; tranId: string }`, `ValidationResult { valid: boolean; amountMinor: number; currency: string; storeId: string | null }`, `PaymentProviderPort.createSession(bookingId, amountMinor, currency): Promise<PaymentSession>`, `PaymentProviderPort.validateTransaction(valId): Promise<ValidationResult>` — consumed by Task 4 (real implementation) and Task 6 (`BookingsService`).
- Removes: `PaymentProviderPort.charge()`, `ChargeResult` (no longer used anywhere after this task).

- [ ] **Step 1: Write the failing test for the stub**

Replace the full contents of `apps/api/src/common/payments/stub-payment-provider.service.spec.ts`:

```ts
import { StubPaymentProviderService } from "./stub-payment-provider.service";

describe("StubPaymentProviderService", () => {
  let service: StubPaymentProviderService;

  beforeEach(() => {
    service = new StubPaymentProviderService();
  });

  it("createSession returns a fake gatewayUrl and a random tranId", async () => {
    const result = await service.createSession("booking-1", 500000, "BDT");
    expect(result.gatewayUrl).toEqual(expect.stringContaining("booking-1"));
    expect(result.tranId).toEqual(expect.any(String));
  });

  it("createSession generates a different tranId on each call", async () => {
    const first = await service.createSession("booking-1", 500000, "BDT");
    const second = await service.createSession("booking-2", 500000, "BDT");
    expect(first.tranId).not.toBe(second.tranId);
  });

  it("validateTransaction always returns a valid result", async () => {
    const result = await service.validateTransaction("fake-val-id");
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- stub-payment-provider`
Expected: FAIL — `service.createSession`/`validateTransaction` don't exist yet (the old `charge()` method is still there).

- [ ] **Step 3: Implement the new port interface**

Replace the full contents of `apps/api/src/common/payments/payment-provider.port.ts`:

```ts
export interface PaymentSession {
  gatewayUrl: string;
  tranId: string;
}

export interface ValidationResult {
  valid: boolean;
  amountMinor: number;
  currency: string;
  storeId: string | null;
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

- [ ] **Step 4: Implement the updated stub**

Replace the full contents of `apps/api/src/common/payments/stub-payment-provider.service.ts`:

```ts
import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  PaymentProviderPort,
  PaymentSession,
  ValidationResult,
} from "./payment-provider.port";

@Injectable()
export class StubPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(StubPaymentProviderService.name);

  async createSession(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<PaymentSession> {
    const tranId = randomUUID();
    this.logger.log(
      `[stub payment] createSession booking=${bookingId} amount=${amountMinor} ${currency} tranId=${tranId}`,
    );
    return {
      gatewayUrl: `https://stub-gateway.example.com/pay/${bookingId}`,
      tranId,
    };
  }

  async validateTransaction(valId: string): Promise<ValidationResult> {
    this.logger.log(
      `[stub payment] validateTransaction valId=${valId} -> valid`,
    );
    return {
      valid: true,
      amountMinor: 0,
      currency: "BDT",
      storeId: null,
    };
  }
}
```

Note: the stub's `validateTransaction` returning a fixed `amountMinor: 0` is intentional — this stub is only used in unit tests that mock the caller's expectations directly (see Task 6/7), never in an e2e test that needs a real amount match. If a future test needs the stub to echo back a specific amount, that test should construct its own richer fake rather than changing this shared stub's fixed behavior.

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- stub-payment-provider`
Expected: PASS.

- [ ] **Step 6: Full unit suite check**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: likely FAIL now in `bookings.service.spec.ts` (which currently mocks `paymentProvider.charge`) — this is expected and will be fixed in Task 6, which rewrites that file. Confirm the failures are ONLY in `bookings.service.spec.ts`/`bookings.controller.spec.ts` (files Task 6/7 will rewrite) and nowhere else; if any other file fails, stop and report.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/payments/payment-provider.port.ts apps/api/src/common/payments/stub-payment-provider.service.ts apps/api/src/common/payments/stub-payment-provider.service.spec.ts
git commit -m "feat(api): replace PaymentProviderPort.charge with createSession/validateTransaction"
```

---

## Task 4: `SslcommerzPaymentProviderService` (real implementation)

**Files:**

- Create: `apps/api/src/common/payments/sslcommerz-payment-provider.service.ts`
- Create: `apps/api/src/common/payments/sslcommerz-payment-provider.service.spec.ts`
- Modify: `apps/api/src/common/payments/payments.module.ts`

**Interfaces:**

- Consumes: `PaymentProviderPort`, `PaymentSession`, `ValidationResult` (Task 3), `ConfigService` (existing, for `SSLCOMMERZ_STORE_ID`/`SSLCOMMERZ_STORE_PASSWORD`/`SSLCOMMERZ_SANDBOX`/`FRONTEND_URL`).
- Produces: `SslcommerzPaymentProviderService implements PaymentProviderPort` — real class, injected in place of the stub in non-test environments (Task 4 Step 6 wires this).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/common/payments/sslcommerz-payment-provider.service.spec.ts`:

```ts
import { ConfigService } from "@nestjs/config";
import { SslcommerzPaymentProviderService } from "./sslcommerz-payment-provider.service";

function makeConfig(): ConfigService {
  const values: Record<string, string | boolean> = {
    SSLCOMMERZ_STORE_ID: "test-store",
    SSLCOMMERZ_STORE_PASSWORD: "test-password",
    SSLCOMMERZ_SANDBOX: true,
    FRONTEND_URL: "http://localhost:3000",
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("SslcommerzPaymentProviderService", () => {
  let service: SslcommerzPaymentProviderService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new SslcommerzPaymentProviderService(makeConfig());
  });

  describe("createSession", () => {
    it("posts to the sandbox session-init endpoint and returns the GatewayPageURL + tran_id", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "SUCCESS",
          GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/abc123",
        }),
      });

      const result = await service.createSession("booking-1", 500000, "BDT");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("sandbox.sslcommerz.com"),
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.gatewayUrl).toBe(
        "https://sandbox.sslcommerz.com/EasyCheckOut/abc123",
      );
      expect(result.tranId).toEqual(expect.any(String));
    });

    it("throws when SSLCommerz's session-init response has status !== SUCCESS", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "FAILED",
          failedreason: "Invalid store credentials",
        }),
      });

      await expect(
        service.createSession("booking-1", 500000, "BDT"),
      ).rejects.toThrow(/Invalid store credentials/);
    });

    it("sends amount as a decimal major-unit string, not minor units", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "SUCCESS",
          GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/abc123",
        }),
      });

      await service.createSession("booking-1", 500000, "BDT");

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = options.body as URLSearchParams;
      expect(body.get("total_amount")).toBe("5000.00");
    });
  });

  describe("validateTransaction", () => {
    it("calls the Order Validation API and returns a valid result on VALID status", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "VALID",
          amount: "5000.00",
          currency: "BDT",
          store_id: "test-store",
        }),
      });

      const result = await service.validateTransaction("val-id-123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("val_id=val-id-123"),
      );
      expect(result).toEqual({
        valid: true,
        amountMinor: 500000,
        currency: "BDT",
        storeId: "test-store",
      });
    });

    it("returns valid:false when SSLCommerz reports a non-VALID status", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "INVALID_TRANSACTION" }),
      });

      const result = await service.validateTransaction("val-id-123");

      expect(result.valid).toBe(false);
    });

    it("returns valid:false (not a thrown error) if the HTTP call itself fails", async () => {
      fetchMock.mockRejectedValue(new Error("network error"));

      const result = await service.validateTransaction("val-id-123");

      expect(result.valid).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- sslcommerz-payment-provider`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

`apps/api/src/common/payments/sslcommerz-payment-provider.service.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PaymentProviderPort,
  PaymentSession,
  ValidationResult,
} from "./payment-provider.port";

interface SessionInitResponse {
  status: string;
  GatewayPageURL?: string;
  failedreason?: string;
}

interface ValidationApiResponse {
  status: string;
  amount?: string;
  currency?: string;
  store_id?: string;
}

@Injectable()
export class SslcommerzPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(SslcommerzPaymentProviderService.name);
  private readonly storeId: string;
  private readonly storePassword: string;
  private readonly baseUrl: string;
  private readonly frontendUrl: string;

  constructor(config: ConfigService) {
    this.storeId = config.get<string>("SSLCOMMERZ_STORE_ID", "");
    this.storePassword = config.get<string>("SSLCOMMERZ_STORE_PASSWORD", "");
    const sandbox = config.get<boolean>("SSLCOMMERZ_SANDBOX", true);
    this.baseUrl = sandbox
      ? "https://sandbox.sslcommerz.com"
      : "https://securepay.sslcommerz.com";
    this.frontendUrl = config.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
  }

  async createSession(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<PaymentSession> {
    const tranId = randomUUID();
    const amountMajor = (amountMinor / 100).toFixed(2);

    const body = new URLSearchParams({
      store_id: this.storeId,
      store_passwd: this.storePassword,
      total_amount: amountMajor,
      currency,
      tran_id: tranId,
      success_url: `${this.frontendUrl}/bookings/${bookingId}/payment-result?status=success`,
      fail_url: `${this.frontendUrl}/bookings/${bookingId}/payment-result?status=fail`,
      cancel_url: `${this.frontendUrl}/bookings/${bookingId}/payment-result?status=cancel`,
      ipn_url: `${this.frontendUrl}/payments/sslcommerz/ipn`,
      cus_name: "StayBangla Traveler",
      cus_email: "traveler@staybangla.example",
      cus_add1: "Dhaka",
      cus_phone: "01700000000",
      shipping_method: "NO",
      product_name: "StayBangla Booking",
      product_category: "Travel",
      product_profile: "general",
    });

    const response = await fetch(`${this.baseUrl}/gwprocess/v4/api.php`, {
      method: "POST",
      body,
    });
    const data = (await response.json()) as SessionInitResponse;

    if (data.status !== "SUCCESS" || !data.GatewayPageURL) {
      throw new InternalServerErrorException(
        `SSLCommerz session creation failed: ${data.failedreason ?? "unknown reason"}`,
      );
    }

    return { gatewayUrl: data.GatewayPageURL, tranId };
  }

  async validateTransaction(valId: string): Promise<ValidationResult> {
    try {
      const query = new URLSearchParams({
        val_id: valId,
        store_id: this.storeId,
        store_passwd: this.storePassword,
        format: "json",
      });
      const response = await fetch(
        `${this.baseUrl}/validator/api/validationserverAPI.php?${query.toString()}`,
      );
      const data = (await response.json()) as ValidationApiResponse;

      if (data.status !== "VALID" && data.status !== "VALIDATED") {
        return { valid: false, amountMinor: 0, currency: "", storeId: null };
      }

      const amountMinor = Math.round(parseFloat(data.amount ?? "0") * 100);
      return {
        valid: true,
        amountMinor,
        currency: data.currency ?? "",
        storeId: data.store_id ?? null,
      };
    } catch (error) {
      this.logger.error(
        `SSLCommerz validation API call failed for valId=${valId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { valid: false, amountMinor: 0, currency: "", storeId: null };
    }
  }
}
```

Note: `validateTransaction` never throws — a network failure talking to SSLCommerz is treated as "cannot confirm this payment is valid," which is the safe default (reject, don't confirm), not an unhandled exception that would crash the IPN handler or reconciliation job.

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- sslcommerz-payment-provider`
Expected: PASS.

- [ ] **Step 5: Wire the real provider (non-test) and keep the stub for tests**

Replace the full contents of `apps/api/src/common/payments/payments.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PaymentProviderPort } from "./payment-provider.port";
import { SslcommerzPaymentProviderService } from "./sslcommerz-payment-provider.service";

@Module({
  providers: [
    {
      provide: PaymentProviderPort,
      useClass: SslcommerzPaymentProviderService,
    },
  ],
  exports: [PaymentProviderPort],
})
export class PaymentsModule {}
```

Note: `StubPaymentProviderService` remains in the codebase (Task 3) for direct unit-test use (constructed directly in `bookings.service.spec.ts`, not via this module's DI) — it is simply no longer wired into the real `PaymentsModule`. This mirrors how the design doc describes both classes coexisting, one for real traffic, one for fast unit tests.

- [ ] **Step 6: Full unit suite + typecheck**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: PASS — confirms `PaymentsModule`'s new wiring compiles.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/payments/sslcommerz-payment-provider.service.ts apps/api/src/common/payments/sslcommerz-payment-provider.service.spec.ts apps/api/src/common/payments/payments.module.ts
git commit -m "feat(api): add SslcommerzPaymentProviderService, wire as the real PaymentProviderPort"
```

---

## Task 5: `bookings.types.ts` — add `paymentStatus`

**Files:**

- Modify: `apps/api/src/bookings/bookings.types.ts`

**Interfaces:**

- Produces: `BookingRecord.paymentStatus: string` — consumed by Task 6 (`toBookingRecord`) and Task 7 (controller responses).

- [ ] **Step 1: Add the field**

Read the current `apps/api/src/bookings/bookings.types.ts` first (it's a small file). Add `paymentStatus: string;` as a new field on the `BookingRecord` interface, directly after the existing `status: string;` field.

- [ ] **Step 2: Confirm compile**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: this alone will likely now show errors in `bookings.service.ts` wherever `BookingRecord` object literals are constructed without `paymentStatus` — that's expected; Task 6 fixes `bookings.service.ts` itself. Confirm the only new errors are in `bookings.service.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bookings/bookings.types.ts
git commit -m "feat(api): add paymentStatus to BookingRecord"
```

---

## Task 6: `BookingsService` — `initiatePayment`, `confirmIfValid`, cancel policy, remove `confirmPayment`

**Files:**

- Modify: `apps/api/src/bookings/bookings.service.ts`
- Modify: `apps/api/src/bookings/bookings.service.spec.ts`
- Create: `apps/api/src/bookings/dto/cancel-booking.dto.ts`

**Interfaces:**

- Consumes: `PaymentProviderPort.createSession`/`validateTransaction` (Task 3/4), `BookingRecord.paymentStatus` (Task 5), `PrismaService` (existing).
- Produces: `BookingsService.initiatePayment(callerId, bookingId): Promise<{ gatewayUrl: string }>`, `BookingsService.confirmIfValid(bookingId, valId): Promise<void>`, `BookingsService.cancel(callerId, bookingId, acknowledgeNoRefund?: boolean): Promise<BookingRecord>` (signature changed — new third parameter), `BookingsService.getPaymentStatus(callerId, bookingId): Promise<{ paymentStatus: string; gatewayTranId: string | null }>` — all consumed by Task 7 (`BookingsController`) and Task 8 (`PaymentsController`/reconciliation).
- Removes: `BookingsService.confirmPayment` (deleted).

- [ ] **Step 1: Write the failing tests**

Read `apps/api/src/bookings/bookings.service.spec.ts` first to see its exact current mock-setup style (it currently mocks `paymentProvider.charge` — that mock needs replacing, not just adding to). Replace the entire `describe("confirmPayment", ...)` block and the `paymentProvider` mock's shape, and add new test blocks. The file's existing `prisma` mock object needs `booking: { findUnique: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() }` plus a new `ledgerEntry: { createMany: jest.fn() }` and `user: { findUnique: jest.fn() }` (for reading `commissionRatePercent`) — read the current mock object first and extend it, don't guess at what's already there.

```ts
describe("initiatePayment", () => {
  it("creates a payment session for a HELD booking owned by the caller", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      status: "HELD",
      totalAmountMinor: 500000,
      currency: "BDT",
    });
    paymentProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-1",
    });
    prisma.booking.update.mockResolvedValue({});

    const result = await service.initiatePayment("u1", "b1");

    expect(paymentProvider.createSession).toHaveBeenCalledWith(
      "b1",
      500000,
      "BDT",
    );
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { gatewayTranId: "tran-1" },
    });
    expect(result).toEqual({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
    });
  });

  it("throws NotFoundException when the booking does not exist", async () => {
    prisma.booking.findUnique.mockResolvedValue(null);
    await expect(service.initiatePayment("u1", "missing")).rejects.toThrow(
      "Booking not found",
    );
  });

  it("throws ForbiddenException when the caller does not own the booking", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "someone-else",
      status: "HELD",
    });
    await expect(service.initiatePayment("u1", "b1")).rejects.toThrow(
      "You do not own this booking",
    );
  });

  it("throws ConflictException when the booking is not HELD", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      status: "CONFIRMED",
    });
    await expect(service.initiatePayment("u1", "b1")).rejects.toThrow(/HELD/);
  });
});

describe("confirmIfValid", () => {
  const heldBooking = {
    id: "b1",
    userId: "u1",
    status: "HELD",
    resourceOwnerId: "vendor1",
    totalAmountMinor: 500000,
    currency: "BDT",
  };

  it("confirms a booking when validation succeeds with matching amount and currency", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ commissionRatePercent: 10 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      ...heldBooking,
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", status: "HELD" },
      data: expect.objectContaining({
        status: "CONFIRMED",
        paymentStatus: "PAID",
        gatewayValId: "val-123",
        vendorOwedMinor: 450000,
      }),
    });
    expect(prisma.ledgerEntry.createMany).toHaveBeenCalledWith({
      data: [
        {
          bookingId: "b1",
          type: "GROSS_PAYMENT",
          amountMinor: 500000,
          ratePercentApplied: 10,
        },
        {
          bookingId: "b1",
          type: "PLATFORM_FEE",
          amountMinor: 50000,
          ratePercentApplied: 10,
        },
        {
          bookingId: "b1",
          type: "VENDOR_OWED",
          amountMinor: 450000,
          ratePercentApplied: 10,
        },
      ],
    });
    expect(expiryQueue.cancelExpiry).toHaveBeenCalledWith("b1");
  });

  it("does nothing when the booking is not found", async () => {
    prisma.booking.findUnique.mockResolvedValue(null);
    await service.confirmIfValid("missing", "val-123");
    expect(paymentProvider.validateTransaction).not.toHaveBeenCalled();
  });

  it("does nothing when the booking is not HELD (already confirmed by the other path)", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      ...heldBooking,
      status: "CONFIRMED",
    });
    await service.confirmIfValid("b1", "val-123");
    expect(paymentProvider.validateTransaction).not.toHaveBeenCalled();
  });

  it("rejects and makes no state change when validation reports invalid", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: false,
      amountMinor: 0,
      currency: "",
      storeId: null,
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the validated amount does not match the booking's total", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 400000,
      currency: "BDT",
      storeId: null,
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the validated currency does not match the booking's currency", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "USD",
      storeId: null,
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when a returned storeId does not match the configured store", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: "some-other-store",
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("is a safe no-op if the guarded update loses the race (count 0)", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it("computes correct ledger amounts with floor rounding for a non-evenly-divisible total", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      ...heldBooking,
      totalAmountMinor: 999,
    });
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 999,
      currency: "BDT",
      storeId: null,
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ commissionRatePercent: 10 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      ...heldBooking,
      status: "CONFIRMED",
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.ledgerEntry.createMany).toHaveBeenCalledWith({
      data: [
        {
          bookingId: "b1",
          type: "GROSS_PAYMENT",
          amountMinor: 999,
          ratePercentApplied: 10,
        },
        {
          bookingId: "b1",
          type: "PLATFORM_FEE",
          amountMinor: 99,
          ratePercentApplied: 10,
        },
        {
          bookingId: "b1",
          type: "VENDOR_OWED",
          amountMinor: 900,
          ratePercentApplied: 10,
        },
      ],
    });
  });
});

describe("cancel with payment-status policy", () => {
  it("cancels a HELD booking with no acknowledgement required", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      status: "CANCELLED",
      paymentStatus: "PENDING",
    });
    const result = await service.cancel("u1", "b1");
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", userId: "u1", status: { in: ["HELD", "CONFIRMED"] } },
      data: { status: "CANCELLED" },
    });
    expect(result.status).toBe("CANCELLED");
  });

  it("rejects cancelling a CONFIRMED+PAID booking without acknowledgeNoRefund", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
    await expect(service.cancel("u1", "b1", false)).rejects.toThrow(
      /no refund/i,
    );
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("cancels a CONFIRMED+PAID booking when acknowledgeNoRefund is true, keeping paymentStatus PAID", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      status: "CANCELLED",
      paymentStatus: "PAID",
    });

    const result = await service.cancel("u1", "b1", true);

    expect(result.status).toBe("CANCELLED");
    expect(result.paymentStatus).toBe("PAID");
  });
});

describe("getPaymentStatus", () => {
  it("returns the booking's payment status for its own caller", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      paymentStatus: "PAID",
      gatewayTranId: "tran-1",
    });
    const result = await service.getPaymentStatus("u1", "b1");
    expect(result).toEqual({ paymentStatus: "PAID", gatewayTranId: "tran-1" });
  });

  it("throws ForbiddenException for a non-owner caller", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "someone-else",
      paymentStatus: "PENDING",
      gatewayTranId: null,
    });
    await expect(service.getPaymentStatus("u1", "b1")).rejects.toThrow(
      "You do not own this booking",
    );
  });
});
```

Also delete the existing `describe("confirmPayment", ...)` block entirely (it tests a method this task removes).

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.service`
Expected: FAIL — `initiatePayment`/`confirmIfValid`/`getPaymentStatus` don't exist, `cancel`'s signature doesn't accept a third parameter, `confirmPayment` test references a method about to be removed.

- [ ] **Step 3: Implement**

In `apps/api/src/bookings/bookings.service.ts`:

Add `BadRequestException` is already imported; add `ForbiddenException` is already imported. Add this import for the ledger:

```ts
import { LedgerEntryType } from "@prisma/client";
```

Delete the entire existing `confirmPayment` method.

Add these new methods (place them where `confirmPayment` used to be):

```ts
  async initiatePayment(
    callerId: string,
    bookingId: string,
  ): Promise<{ gatewayUrl: string }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException("Booking not found");
    if (booking.userId !== callerId) {
      throw new ForbiddenException("You do not own this booking");
    }
    if (booking.status !== "HELD") {
      throw new ConflictException(
        `Booking is ${booking.status}, must be HELD to initiate payment`,
      );
    }

    const session = await this.paymentProvider.createSession(
      bookingId,
      booking.totalAmountMinor,
      booking.currency,
    );
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { gatewayTranId: session.tranId },
    });

    return { gatewayUrl: session.gatewayUrl };
  }

  async confirmIfValid(bookingId: string, valId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || booking.status !== "HELD") {
      return;
    }

    const validation = await this.paymentProvider.validateTransaction(valId);
    if (
      !validation.valid ||
      validation.amountMinor !== booking.totalAmountMinor ||
      validation.currency !== booking.currency
    ) {
      return;
    }
    if (
      validation.storeId !== null &&
      validation.storeId !== this.config.get<string>("SSLCOMMERZ_STORE_ID")
    ) {
      return;
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: booking.resourceOwnerId },
    });
    const commissionRatePercent = owner?.commissionRatePercent ?? 10;
    const platformFeeMinor = Math.floor(
      (booking.totalAmountMinor * commissionRatePercent) / 100,
    );
    const vendorOwedMinor = booking.totalAmountMinor - platformFeeMinor;

    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: "HELD" },
      data: {
        status: "CONFIRMED",
        paymentStatus: "PAID",
        gatewayValId: valId,
        vendorOwedMinor,
      },
    });
    if (result.count === 0) {
      // Lost the race to another confirmation path (webhook vs. reconciliation
      // firing near-simultaneously, or the hold expired) between our read and
      // this update.
      return;
    }

    await this.prisma.ledgerEntry.createMany({
      data: [
        {
          bookingId,
          type: LedgerEntryType.GROSS_PAYMENT,
          amountMinor: booking.totalAmountMinor,
          ratePercentApplied: commissionRatePercent,
        },
        {
          bookingId,
          type: LedgerEntryType.PLATFORM_FEE,
          amountMinor: platformFeeMinor,
          ratePercentApplied: commissionRatePercent,
        },
        {
          bookingId,
          type: LedgerEntryType.VENDOR_OWED,
          amountMinor: vendorOwedMinor,
          ratePercentApplied: commissionRatePercent,
        },
      ],
    });
    await this.expiryQueue.cancelExpiry(bookingId);
  }

  async getPaymentStatus(
    callerId: string,
    bookingId: string,
  ): Promise<{ paymentStatus: string; gatewayTranId: string | null }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException("Booking not found");
    if (booking.userId !== callerId) {
      throw new ForbiddenException("You do not own this booking");
    }
    return {
      paymentStatus: booking.paymentStatus,
      gatewayTranId: booking.gatewayTranId,
    };
  }
```

Replace the existing `cancel` method's signature and body:

```ts
  async cancel(
    callerId: string,
    bookingId: string,
    acknowledgeNoRefund?: boolean,
  ): Promise<BookingRecord> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (
      booking &&
      booking.userId === callerId &&
      booking.status === "CONFIRMED" &&
      booking.paymentStatus === "PAID" &&
      !acknowledgeNoRefund
    ) {
      throw new BadRequestException(
        "Cancelling a confirmed, paid booking forfeits the payment — pass acknowledgeNoRefund: true to confirm (no refund)",
      );
    }

    const result = await this.prisma.booking.updateMany({
      where: {
        id: bookingId,
        userId: callerId,
        status: { in: ["HELD", "CONFIRMED"] },
      },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "Booking not found, not yours, or not cancellable",
      );
    }
    const updated = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    return this.toBookingRecord(updated);
  }
```

Update the constructor to also inject `ConfigService` (needed by `confirmIfValid`'s store-id check):

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiryQueue: BookingExpiryQueueService,
    private readonly paymentProvider: PaymentProviderPort,
    private readonly config: ConfigService,
  ) {}
```

Add the import: `import { ConfigService } from "@nestjs/config";` at the top of the file.

Update `toBookingRecord`'s parameter type to include `paymentStatus: string;` in its inline object-shape parameter (matching the new `BookingRecord` field from Task 5), and update its return to spread `paymentStatus` through (it already spreads `...booking`, so as long as the caller passes an object with `paymentStatus`, no further change is needed there — but the type annotation itself needs the field added so TypeScript doesn't complain about an incomplete parameter type).

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.service`
Expected: PASS — all new tests green, no leftover `confirmPayment` tests.

- [ ] **Step 5: Create the cancel-booking DTO**

`apps/api/src/bookings/dto/cancel-booking.dto.ts`:

```ts
import { IsBoolean, IsOptional } from "class-validator";

export class CancelBookingDto {
  @IsOptional()
  @IsBoolean()
  acknowledgeNoRefund?: boolean;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bookings/bookings.service.ts apps/api/src/bookings/bookings.service.spec.ts apps/api/src/bookings/dto/cancel-booking.dto.ts
git commit -m "feat(api): add initiatePayment/confirmIfValid/getPaymentStatus, no-refund cancel policy, remove confirmPayment"
```

---

## Task 7: `BookingsController` — new routes, remove `confirm-payment`

**Files:**

- Modify: `apps/api/src/bookings/bookings.controller.ts`
- Modify: `apps/api/src/bookings/bookings.controller.spec.ts`

**Interfaces:**

- Consumes: `BookingsService.initiatePayment`/`getPaymentStatus`/`cancel` (Task 6), `CancelBookingDto` (Task 6).

- [ ] **Step 1: Write the failing tests**

Read `apps/api/src/bookings/bookings.controller.spec.ts` first to match its exact mock style. Replace the `describe("confirmPayment", ...)` block (delete it — that route no longer exists) and add:

```ts
describe("initiatePayment", () => {
  it("delegates to BookingsService.initiatePayment", async () => {
    bookingsService.initiatePayment.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
    });
    const result = await controller.initiatePayment(
      { id: "u1", roles: ["TRAVELER"] },
      "b1",
    );
    expect(bookingsService.initiatePayment).toHaveBeenCalledWith("u1", "b1");
    expect(result).toEqual({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
    });
  });
});

describe("getPaymentStatus", () => {
  it("delegates to BookingsService.getPaymentStatus", async () => {
    bookingsService.getPaymentStatus.mockResolvedValue({
      paymentStatus: "PAID",
      gatewayTranId: "tran-1",
    });
    const result = await controller.getPaymentStatus(
      { id: "u1", roles: ["TRAVELER"] },
      "b1",
    );
    expect(bookingsService.getPaymentStatus).toHaveBeenCalledWith("u1", "b1");
    expect(result).toEqual({ paymentStatus: "PAID", gatewayTranId: "tran-1" });
  });
});

describe("cancel", () => {
  it("passes acknowledgeNoRefund through to BookingsService.cancel", async () => {
    bookingsService.cancel.mockResolvedValue({ id: "b1", status: "CANCELLED" });
    await controller.cancel({ id: "u1", roles: ["TRAVELER"] }, "b1", {
      acknowledgeNoRefund: true,
    });
    expect(bookingsService.cancel).toHaveBeenCalledWith("u1", "b1", true);
  });

  it("passes undefined when acknowledgeNoRefund is not provided", async () => {
    bookingsService.cancel.mockResolvedValue({ id: "b1", status: "CANCELLED" });
    await controller.cancel({ id: "u1", roles: ["TRAVELER"] }, "b1", {});
    expect(bookingsService.cancel).toHaveBeenCalledWith("u1", "b1", undefined);
  });
});
```

Add `initiatePayment`, `getPaymentStatus`, `cancel` to the mocked `bookingsService` object's type declaration and `beforeEach` initialization (matching however the existing mock is structured — read the file first).

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.controller`
Expected: FAIL — `controller.initiatePayment`/`getPaymentStatus` don't exist, `cancel`'s signature doesn't accept a body parameter yet.

- [ ] **Step 3: Implement**

In `apps/api/src/bookings/bookings.controller.ts`, add the import: `import { CancelBookingDto } from "./dto/cancel-booking.dto";`

Delete the entire `confirmPayment` method.

Add these two new routes (place where `confirmPayment` used to be):

```ts
  @Post("bookings/:id/initiate-payment")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async initiatePayment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<{ gatewayUrl: string }> {
    return this.bookingsService.initiatePayment(user.id, id);
  }

  @Get("bookings/:id/payment-status")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async getPaymentStatus(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<{ paymentStatus: string; gatewayTranId: string | null }> {
    return this.bookingsService.getPaymentStatus(user.id, id);
  }
```

Add `Get` to the existing `@nestjs/common` import list (it currently only imports `Body, Controller, Param, Post, UseGuards`).

Replace the existing `cancel` method:

```ts
  @Post("bookings/:id/cancel")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: CancelBookingDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.cancel(user.id, id, dto.acknowledgeNoRefund);
  }
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.controller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bookings/bookings.controller.ts apps/api/src/bookings/bookings.controller.spec.ts
git commit -m "feat(api): add initiate-payment/payment-status routes, remove confirm-payment route"
```

---

## Task 8: `PaymentsController` — public IPN webhook

**Files:**

- Create: `apps/api/src/bookings/payments.controller.ts`
- Create: `apps/api/src/bookings/payments.controller.spec.ts`
- Modify: `apps/api/src/bookings/bookings.module.ts`

**Interfaces:**

- Consumes: `BookingsService.confirmIfValid` (Task 6).
- Produces: `PaymentsController` with `POST /payments/sslcommerz/ipn` — a new, separate controller (not added to `BookingsController`) since it is public/unauthenticated and conceptually about the payment gateway's callback, not a booking action a client requests.

- [ ] **Step 1: Write the failing test**

`apps/api/src/bookings/payments.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { BookingsService } from "./bookings.service";

describe("PaymentsController", () => {
  let controller: PaymentsController;
  let bookingsService: { confirmIfValid: jest.Mock };

  beforeEach(async () => {
    bookingsService = { confirmIfValid: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: BookingsService, useValue: bookingsService }],
    }).compile();
    controller = moduleRef.get(PaymentsController);
  });

  it("extracts tran_id and val_id from the IPN body and confirms via BookingsService", async () => {
    await controller.handleIpn({
      tran_id: "tran-1",
      val_id: "val-123",
      status: "VALID",
    });

    expect(bookingsService.confirmIfValid).toHaveBeenCalledWith(
      "tran-1",
      "val-123",
    );
  });

  it("does not throw even if confirmIfValid rejects internally (always ack SSLCommerz)", async () => {
    bookingsService.confirmIfValid.mockRejectedValue(new Error("boom"));

    await expect(
      controller.handleIpn({
        tran_id: "tran-1",
        val_id: "val-123",
        status: "VALID",
      }),
    ).resolves.toEqual({ status: "ok" });
  });
});
```

Note: the design doc specifies `bookingId` is looked up by `tran_id`, but `confirmIfValid`'s signature (Task 6) takes `bookingId` directly, not `tranId`. This controller resolves that gap — see Step 2's implementation, which reads the booking by `gatewayTranId` first, before calling `confirmIfValid` with its actual `id`.

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- payments.controller`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`apps/api/src/bookings/payments.controller.ts`:

```ts
import { Body, Controller, Logger, Post } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BookingsService } from "./bookings.service";

interface SslcommerzIpnBody {
  tran_id: string;
  val_id: string;
  status: string;
}

@Controller("payments/sslcommerz")
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("ipn")
  async handleIpn(
    @Body() body: SslcommerzIpnBody,
  ): Promise<{ status: string }> {
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { gatewayTranId: body.tran_id },
      });
      if (booking) {
        await this.bookingsService.confirmIfValid(booking.id, body.val_id);
      } else {
        this.logger.warn(
          `IPN received for unknown tran_id=${body.tran_id} — no matching booking`,
        );
      }
    } catch (error) {
      // Always ack SSLCommerz with 200 regardless of internal outcome — a
      // non-200 causes SSLCommerz to retry indefinitely, which is only
      // useful for a transient failure, not a permanently-invalid IPN. Log
      // and move on; confirmIfValid's own guards mean a rejected/invalid
      // IPN simply doesn't confirm anything, which is the correct outcome.
      this.logger.error(
        `Error processing SSLCommerz IPN for tran_id=${body.tran_id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    return { status: "ok" };
  }
}
```

Update the test's mock: since this controller now also needs `PrismaService`, update `payments.controller.spec.ts`'s test module to provide a mocked `PrismaService` too:

```ts
import { Test } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { BookingsService } from "./bookings.service";
import { PrismaService } from "../prisma/prisma.service";

describe("PaymentsController", () => {
  let controller: PaymentsController;
  let bookingsService: { confirmIfValid: jest.Mock };
  let prisma: { booking: { findUnique: jest.Mock } };

  beforeEach(async () => {
    bookingsService = { confirmIfValid: jest.fn() };
    prisma = { booking: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: BookingsService, useValue: bookingsService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    controller = moduleRef.get(PaymentsController);
  });

  it("looks up the booking by gatewayTranId and confirms via BookingsService", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      gatewayTranId: "tran-1",
    });

    await controller.handleIpn({
      tran_id: "tran-1",
      val_id: "val-123",
      status: "VALID",
    });

    expect(prisma.booking.findUnique).toHaveBeenCalledWith({
      where: { gatewayTranId: "tran-1" },
    });
    expect(bookingsService.confirmIfValid).toHaveBeenCalledWith(
      "b1",
      "val-123",
    );
  });

  it("logs and does nothing (no throw) when tran_id matches no booking", async () => {
    prisma.booking.findUnique.mockResolvedValue(null);

    await expect(
      controller.handleIpn({
        tran_id: "unknown",
        val_id: "val-123",
        status: "VALID",
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(bookingsService.confirmIfValid).not.toHaveBeenCalled();
  });

  it("does not throw even if confirmIfValid rejects internally (always ack SSLCommerz)", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      gatewayTranId: "tran-1",
    });
    bookingsService.confirmIfValid.mockRejectedValue(new Error("boom"));

    await expect(
      controller.handleIpn({
        tran_id: "tran-1",
        val_id: "val-123",
        status: "VALID",
      }),
    ).resolves.toEqual({ status: "ok" });
  });
});
```

(This replaces the Step 1 test file entirely — the Step 1 version was written before the `PrismaService` dependency was discovered as necessary; use this Step 3 version as the final test file.)

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- payments.controller`
Expected: PASS.

- [ ] **Step 5: Wire into `BookingsModule`**

In `apps/api/src/bookings/bookings.module.ts`, add the import `import { PaymentsController } from "./payments.controller";` and add `PaymentsController` to the `controllers` array (alongside the existing `BookingsController`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bookings/payments.controller.ts apps/api/src/bookings/payments.controller.spec.ts apps/api/src/bookings/bookings.module.ts
git commit -m "feat(api): add public SSLCommerz IPN webhook controller"
```

---

## Task 9: Reconciliation job

**Files:**

- Create: `apps/api/src/bookings/queue/payment-reconciliation-queue.service.ts`
- Create: `apps/api/src/bookings/queue/payment-reconciliation.processor.ts`
- Create: `apps/api/src/bookings/queue/payment-reconciliation.processor.spec.ts`
- Modify: `apps/api/src/bookings/bookings.module.ts`

**Interfaces:**

- Consumes: `PaymentProviderPort.validateTransaction` (Task 3/4), `BookingsService.confirmIfValid` (Task 6), `PrismaService` (existing).
- Produces: `PaymentReconciliationQueueService` (schedules the repeatable job at module bootstrap), `PaymentReconciliationProcessor` (the worker that runs the reconciliation query every 2 minutes).

- [ ] **Step 1: Write the failing test**

`apps/api/src/bookings/queue/payment-reconciliation.processor.spec.ts`:

```ts
import { PrismaService } from "../../prisma/prisma.service";
import { BookingsService } from "../bookings.service";
import { PaymentProviderPort } from "../../common/payments/payment-provider.port";
import { PaymentReconciliationProcessor } from "./payment-reconciliation.processor";

describe("PaymentReconciliationProcessor", () => {
  let processor: PaymentReconciliationProcessor;
  let prisma: { booking: { findMany: jest.Mock } };
  let bookingsService: { confirmIfValid: jest.Mock };
  let paymentProvider: { validateTransaction: jest.Mock };

  beforeEach(() => {
    prisma = { booking: { findMany: jest.fn() } };
    bookingsService = { confirmIfValid: jest.fn() };
    paymentProvider = { validateTransaction: jest.fn() };
    processor = new PaymentReconciliationProcessor(
      prisma as unknown as PrismaService,
      bookingsService as unknown as BookingsService,
      paymentProvider as unknown as PaymentProviderPort,
    );
  });

  it("queries for HELD+PENDING bookings older than 1 minute with a gatewayTranId", async () => {
    prisma.booking.findMany.mockResolvedValue([]);

    await processor.process();

    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: {
        status: "HELD",
        paymentStatus: "PENDING",
        gatewayTranId: { not: null },
        createdAt: { lt: expect.any(Date) },
      },
    });
  });

  it("calls validateTransaction and confirmIfValid for each stale booking that SSLCommerz reports as paid", async () => {
    prisma.booking.findMany.mockResolvedValue([
      { id: "b1", gatewayTranId: "tran-1" },
      { id: "b2", gatewayTranId: "tran-2" },
    ]);
    paymentProvider.validateTransaction.mockResolvedValueOnce({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
    });
    paymentProvider.validateTransaction.mockResolvedValueOnce({
      valid: false,
      amountMinor: 0,
      currency: "",
      storeId: null,
    });

    await processor.process();

    expect(bookingsService.confirmIfValid).toHaveBeenCalledTimes(1);
    expect(bookingsService.confirmIfValid).toHaveBeenCalledWith(
      "b1",
      expect.any(String),
    );
  });

  it("does not call confirmIfValid for a booking SSLCommerz reports as not valid", async () => {
    prisma.booking.findMany.mockResolvedValue([
      { id: "b1", gatewayTranId: "tran-1" },
    ]);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: false,
      amountMinor: 0,
      currency: "",
      storeId: null,
    });

    await processor.process();

    expect(bookingsService.confirmIfValid).not.toHaveBeenCalled();
  });
});
```

Note: this test calls `validateTransaction(tranId)` even though the design doc's SSLCommerz Transaction Query API takes a `tran_id`, not a `val_id` — but `PaymentProviderPort.validateTransaction` (Task 3) only accepts one string parameter. Rather than adding a second port method for the reconciliation-specific query API (which would duplicate most of `validateTransaction`'s logic), this processor calls the SAME `validateTransaction` method but passes the booking's `gatewayTranId` as its argument — this only works correctly if `SslcommerzPaymentProviderService.validateTransaction` treats its input as "an identifier to query SSLCommerz with," which the Order Validation API accepts as `val_id` but the reconciliation flow doesn't have (it only knows `tran_id`). **This is a genuine design gap the implementer must resolve, not silently work around**: SSLCommerz's Order Validation API requires `val_id`, not `tran_id` — a `tran_id`-based query needs their separate Transaction Query API, which returns its own `val_id` on success. Resolve this by having `SslcommerzPaymentProviderService` (Task 4) internally try the transaction-query endpoint when given what looks like a `tran_id` context is not how the interface is designed. **Correct resolution:** add a second interface method to `PaymentProviderPort` in this task: `queryByTranId(tranId: string): Promise<ValidationResult>`, implemented in `SslcommerzPaymentProviderService` using their Transaction Query API (`merchantTransIDvalidationAPI.php`), and implemented in `StubPaymentProviderService` returning the same fixed valid result as `validateTransaction`. Update this task's test file and implementation to call `paymentProvider.queryByTranId(booking.gatewayTranId)` instead of `validateTransaction`, and update `confirmIfValid`'s call in this processor to still ultimately call `bookingsService.confirmIfValid(booking.id, result.valId)` — which means `ValidationResult` also needs a `valId: string | null` field added (Task 3/6 must be revisited: add `valId` to `ValidationResult`, populate it from `Order Validation API`'s own echo of `val_id` in `validateTransaction`, and from the Transaction Query API's returned `val_id` in `queryByTranId`). Apply this correction to Tasks 3, 4, and 6 as well before implementing this task — do not implement Task 9 against the original narrower interface.

- [ ] **Step 2: Apply the interface correction to Tasks 3/4/6 first**

Before writing this task's implementation, go back and amend:

In `apps/api/src/common/payments/payment-provider.port.ts`, add `valId: string | null;` to `ValidationResult` and add the new abstract method:

```ts
export interface ValidationResult {
  valid: boolean;
  amountMinor: number;
  currency: string;
  storeId: string | null;
  valId: string | null;
}

export abstract class PaymentProviderPort {
  abstract createSession(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<PaymentSession>;

  abstract validateTransaction(valId: string): Promise<ValidationResult>;

  abstract queryByTranId(tranId: string): Promise<ValidationResult>;
}
```

In `apps/api/src/common/payments/stub-payment-provider.service.ts`, update `validateTransaction` to include `valId` in its returned object (`valId: valId` — echo the input), and add:

```ts
  async queryByTranId(tranId: string): Promise<ValidationResult> {
    this.logger.log(`[stub payment] queryByTranId tranId=${tranId} -> valid`);
    return {
      valid: true,
      amountMinor: 0,
      currency: "BDT",
      storeId: null,
      valId: `stub-val-id-for-${tranId}`,
    };
  }
```

In `apps/api/src/common/payments/sslcommerz-payment-provider.service.ts`: update `validateTransaction`'s return statements to include `valId: valId` (the parameter it was already given — SSLCommerz's Validation API is passed a `val_id` and its response doesn't need to invent a new one, the caller already has it). Add:

```ts
  async queryByTranId(tranId: string): Promise<ValidationResult> {
    try {
      const query = new URLSearchParams({
        tran_id: tranId,
        store_id: this.storeId,
        store_passwd: this.storePassword,
        format: "json",
      });
      const response = await fetch(
        `${this.baseUrl}/validator/api/merchantTransIDvalidationAPI.php?${query.toString()}`,
      );
      const data = (await response.json()) as ValidationApiResponse & {
        val_id?: string;
      };

      if (data.status !== "VALID" && data.status !== "VALIDATED") {
        return { valid: false, amountMinor: 0, currency: "", storeId: null, valId: null };
      }

      const amountMinor = Math.round(parseFloat(data.amount ?? "0") * 100);
      return {
        valid: true,
        amountMinor,
        currency: data.currency ?? "",
        storeId: data.store_id ?? null,
        valId: data.val_id ?? null,
      };
    } catch (error) {
      this.logger.error(
        `SSLCommerz transaction query API call failed for tranId=${tranId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { valid: false, amountMinor: 0, currency: "", storeId: null, valId: null };
    }
  }
```

Update `apps/api/src/common/payments/sslcommerz-payment-provider.service.spec.ts` and `stub-payment-provider.service.spec.ts` to add test coverage for `queryByTranId` (mirroring the existing `validateTransaction` test cases for each file), and update any `validateTransaction`-related assertions that check the full returned object shape to include the new `valId` field.

Run: `pnpm --filter @staybangla/api run test:unit -- payment-provider stub-payment sslcommerz-payment`
Expected: PASS after these amendments — this confirms Tasks 3/4's tests still pass with the widened interface before proceeding to this task's own implementation.

- [ ] **Step 3: Run this task's test to confirm fail**

Update this task's spec (Step 1 above) to call `paymentProvider.queryByTranId` instead of `validateTransaction`, and assert `bookingsService.confirmIfValid` is called with the `valId` from the result (`"stub-val-id-for-tran-1"` in the stub's case, or `expect.any(String)` is fine for a real assertion). Then run:

Run: `pnpm --filter @staybangla/api run test:unit -- payment-reconciliation.processor`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Implement the processor**

`apps/api/src/bookings/queue/payment-reconciliation.processor.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { BookingsService } from "../bookings.service";
import { PaymentProviderPort } from "../../common/payments/payment-provider.port";

const RECONCILIATION_GRACE_PERIOD_MS = 60_000;

@Injectable()
export class PaymentReconciliationProcessor {
  private readonly logger = new Logger(PaymentReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly paymentProvider: PaymentProviderPort,
  ) {}

  async process(): Promise<void> {
    const staleBookings = await this.prisma.booking.findMany({
      where: {
        status: "HELD",
        paymentStatus: "PENDING",
        gatewayTranId: { not: null },
        createdAt: {
          lt: new Date(Date.now() - RECONCILIATION_GRACE_PERIOD_MS),
        },
      },
    });

    for (const booking of staleBookings) {
      if (!booking.gatewayTranId) continue;
      const result = await this.paymentProvider.queryByTranId(
        booking.gatewayTranId,
      );
      if (result.valid && result.valId) {
        this.logger.log(
          `Reconciliation confirming booking=${booking.id} tranId=${booking.gatewayTranId} (IPN likely lost)`,
        );
        await this.bookingsService.confirmIfValid(booking.id, result.valId);
      }
    }
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- payment-reconciliation.processor`
Expected: PASS.

- [ ] **Step 6: Add the BullMQ repeatable-schedule wiring**

`apps/api/src/bookings/queue/payment-reconciliation-queue.service.ts`:

```ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

export const PAYMENT_RECONCILIATION_QUEUE = "payment-reconciliation";
const RECONCILIATION_INTERVAL_MS = 2 * 60 * 1000;

@Injectable()
export class PaymentReconciliationQueueService implements OnModuleInit {
  constructor(
    @InjectQueue(PAYMENT_RECONCILIATION_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Idempotent: BullMQ's repeatable-job scheduler keys on the job name +
    // repeat options, so re-registering the same schedule on every app
    // restart does not create duplicate scheduled runs.
    await this.queue.add(
      "reconcile",
      {},
      {
        repeat: { every: RECONCILIATION_INTERVAL_MS },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
```

This needs a corresponding `WorkerHost`-based processor to actually run the job when BullMQ fires it (the plain class in Step 4 is the testable business logic; this wraps it as the actual BullMQ worker). Add this to the SAME `payment-reconciliation.processor.ts` file, replacing its previous plain-class-only content — read the file you wrote in Step 4 and extend it:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { BookingsService } from "../bookings.service";
import { PaymentProviderPort } from "../../common/payments/payment-provider.port";
import { PAYMENT_RECONCILIATION_QUEUE } from "./payment-reconciliation-queue.service";

const RECONCILIATION_GRACE_PERIOD_MS = 60_000;

@Injectable()
@Processor(PAYMENT_RECONCILIATION_QUEUE)
export class PaymentReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly paymentProvider: PaymentProviderPort,
  ) {
    super();
  }

  async process(): Promise<void> {
    const staleBookings = await this.prisma.booking.findMany({
      where: {
        status: "HELD",
        paymentStatus: "PENDING",
        gatewayTranId: { not: null },
        createdAt: {
          lt: new Date(Date.now() - RECONCILIATION_GRACE_PERIOD_MS),
        },
      },
    });

    for (const booking of staleBookings) {
      if (!booking.gatewayTranId) continue;
      const result = await this.paymentProvider.queryByTranId(
        booking.gatewayTranId,
      );
      if (result.valid && result.valId) {
        this.logger.log(
          `Reconciliation confirming booking=${booking.id} tranId=${booking.gatewayTranId} (IPN likely lost)`,
        );
        await this.bookingsService.confirmIfValid(booking.id, result.valId);
      }
    }
  }
}
```

Note: `@Processor`'s `process()` method signature normally receives a BullMQ `Job` argument (see the existing `BookingExpiryProcessor` for the established pattern) — this job's data is empty (`{}`), so the method can ignore the `Job` parameter entirely; TypeScript allows this since `WorkerHost.process` is typed to accept it optionally in practice, but if `tsc` complains, add `async process(_job: Job): Promise<void>` with `import { Job } from "bullmq";` to match the parameter count `WorkerHost` expects.

- [ ] **Step 7: Run to confirm this file's tests still pass after the WorkerHost wrapping**

Run: `pnpm --filter @staybangla/api run test:unit -- payment-reconciliation.processor`
Expected: PASS — the spec constructs `PaymentReconciliationProcessor` directly (not via Nest DI), so extending it with `WorkerHost`/`@Processor` doesn't change how the unit test instantiates or calls it.

- [ ] **Step 8: Wire into `BookingsModule`**

In `apps/api/src/bookings/bookings.module.ts`, add:

```ts
import {
  PaymentReconciliationQueueService,
  PAYMENT_RECONCILIATION_QUEUE,
} from "./queue/payment-reconciliation-queue.service";
import { PaymentReconciliationProcessor } from "./queue/payment-reconciliation.processor";
```

Add `BullModule.registerQueue({ name: PAYMENT_RECONCILIATION_QUEUE })` to the existing `imports` array (alongside the existing `BullModule.registerQueue({ name: BOOKING_EXPIRY_QUEUE })`).

Add `PaymentReconciliationQueueService, PaymentReconciliationProcessor` to the existing `providers` array.

- [ ] **Step 9: Verify the app boots correctly with the new queue**

Run: `pnpm --filter @staybangla/api run test:e2e -- health`
Expected: PASS — confirms `AppModule` (which imports `BookingsModule`) still compiles and boots with the new BullMQ queue registration, against real Redis.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/common/payments/payment-provider.port.ts apps/api/src/common/payments/stub-payment-provider.service.ts apps/api/src/common/payments/stub-payment-provider.service.spec.ts apps/api/src/common/payments/sslcommerz-payment-provider.service.ts apps/api/src/common/payments/sslcommerz-payment-provider.service.spec.ts apps/api/src/bookings/queue/payment-reconciliation-queue.service.ts apps/api/src/bookings/queue/payment-reconciliation.processor.ts apps/api/src/bookings/queue/payment-reconciliation.processor.spec.ts apps/api/src/bookings/bookings.module.ts
git commit -m "feat(api): add PaymentReconciliationProcessor for lost-IPN recovery"
```

---

## Task 10: Admin commission endpoint

**Files:**

- Create: `apps/api/src/admin/commission.controller.ts`
- Create: `apps/api/src/admin/commission.controller.spec.ts`
- Create: `apps/api/src/admin/dto/update-commission.dto.ts`
- Modify: `apps/api/src/admin/admin.module.ts`

**Interfaces:**

- Produces: `PATCH /admin/vendors/:id/commission` — updates `User.commissionRatePercent`.

- [ ] **Step 1: Create the DTO**

`apps/api/src/admin/dto/update-commission.dto.ts`:

```ts
import { IsInt, Max, Min } from "class-validator";

export class UpdateCommissionDto {
  @IsInt()
  @Min(0)
  @Max(100)
  commissionRatePercent!: number;
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/admin/commission.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { CommissionController } from "./commission.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("CommissionController", () => {
  let controller: CommissionController;
  let prisma: { user: { update: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [CommissionController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(CommissionController);
  });

  it("updates the vendor's commissionRatePercent", async () => {
    prisma.user.update.mockResolvedValue({
      id: "vendor1",
      commissionRatePercent: 15,
    });

    const result = await controller.update("vendor1", {
      commissionRatePercent: 15,
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "vendor1" },
      data: { commissionRatePercent: 15 },
    });
    expect(result).toEqual({ id: "vendor1", commissionRatePercent: 15 });
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- commission.controller`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

`apps/api/src/admin/commission.controller.ts`:

```ts
import { Body, Controller, Param, Patch, UseGuards } from "@nestjs/common";
import { User } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateCommissionDto } from "./dto/update-commission.dto";

@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class CommissionController {
  constructor(private readonly prisma: PrismaService) {}

  @Patch(":id/commission")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateCommissionDto,
  ): Promise<Pick<User, "id" | "commissionRatePercent">> {
    return this.prisma.user.update({
      where: { id },
      data: { commissionRatePercent: dto.commissionRatePercent },
      select: { id: true, commissionRatePercent: true },
    });
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- commission.controller`
Expected: PASS.

- [ ] **Step 6: Wire into `AdminModule`**

In `apps/api/src/admin/admin.module.ts`, add the import `import { CommissionController } from "./commission.controller";` and add `CommissionController` to the existing `controllers` array.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/admin/commission.controller.ts apps/api/src/admin/commission.controller.spec.ts apps/api/src/admin/dto/update-commission.dto.ts apps/api/src/admin/admin.module.ts
git commit -m "feat(api): add PATCH /admin/vendors/:id/commission endpoint"
```

---

## Task 11: E2e coverage

**Files:**

- Create: `apps/api/test/payment-confirmation.e2e-spec.ts`
- Create: `apps/api/test/booking-cancellation-policy.e2e-spec.ts`
- Create: `apps/api/test/admin-commission.e2e-spec.ts`
- Modify: `apps/api/test/helpers/test-db.ts` (if `cleanDatabase` needs a `ledgerEntry.deleteMany()` added — check FK ordering)

**Interfaces:**

- Consumes: `createVerifiedVendor`, `createHotelWithRoom`, `createAdmin` (existing helpers from `test-fixtures.ts`).

Since `PaymentsModule` now wires the REAL `SslcommerzPaymentProviderService` (Task 4 Step 5) rather than the stub, and e2e tests must not make real network calls to SSLCommerz, these e2e tests need a way to override the provider with a controllable fake. Read `apps/api/test/helpers/test-fixtures.ts` and any existing e2e test that overrides a provider (if none exists, this is the first) — the pattern is to build the `Test.createTestingModule({ imports: [AppModule] })` and then call `.overrideProvider(PaymentProviderPort).useValue(fakeProvider)` before `.compile()`, exactly as `.overrideGuard(...)` is already used elsewhere in this codebase's unit tests, just applied to an e2e test's module builder instead.

- [ ] **Step 1: Update `cleanDatabase` for the new table**

Read `apps/api/test/helpers/test-db.ts` first. Add `await testPrisma.ledgerEntry.deleteMany();` to `cleanDatabase()`, placed BEFORE `await testPrisma.booking.deleteMany();` (since `LedgerEntry` has a foreign key to `Booking`, it must be cleared first — same FK-ordering discipline already documented in this file's comments for the other child tables).

- [ ] **Step 2: Write the payment confirmation e2e test**

`apps/api/test/payment-confirmation.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { PaymentProviderPort } from "src/common/payments/payment-provider.port";
import { cleanDatabase, testPrisma } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Payment confirmation (e2e)", () => {
  let app: INestApplication;
  let fakeProvider: {
    createSession: jest.Mock;
    validateTransaction: jest.Mock;
    queryByTranId: jest.Mock;
  };

  beforeAll(async () => {
    fakeProvider = {
      createSession: jest.fn(),
      validateTransaction: jest.fn(),
      queryByTranId: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PaymentProviderPort)
      .useValue(fakeProvider)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    jest.clearAllMocks();
  });

  async function createHeldBooking(): Promise<{
    bookingId: string;
    travelerToken: string;
  }> {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "payment-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken, {
      pricePerNightMinor: 500000,
    });
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "payment-traveler@example.com",
    );
    const booking = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-01",
        checkOut: "2026-09-02",
      });
    return { bookingId: booking.body.id as string, travelerToken };
  }

  it("POST /bookings/:id/confirm-payment no longer exists", async () => {
    const { bookingId, travelerToken } = await createHeldBooking();
    const res = await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/confirm-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);
    expect(res.status).toBe(404);
  });

  it("initiate-payment creates a session and returns a gatewayUrl", async () => {
    const { bookingId, travelerToken } = await createHeldBooking();
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-e2e-1",
    });

    const res = await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);

    expect(res.status).toBe(201);
    expect(res.body.gatewayUrl).toBe("https://sandbox.sslcommerz.com/pay/xyz");
  });

  it("IPN webhook confirms the booking and writes ledger entries when validation succeeds", async () => {
    const { bookingId, travelerToken } = await createHeldBooking();
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-e2e-2",
    });
    await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);

    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
      valId: "val-e2e-2",
    });

    const ipnRes = await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({ tran_id: "tran-e2e-2", val_id: "val-e2e-2", status: "VALID" });
    expect(ipnRes.status).toBe(201);

    const statusRes = await request(app.getHttpServer())
      .get(`/bookings/${bookingId}/payment-status`)
      .set("Authorization", `Bearer ${travelerToken}`);
    expect(statusRes.body.paymentStatus).toBe("PAID");

    const ledgerEntries = await testPrisma.ledgerEntry.findMany({
      where: { bookingId },
    });
    expect(ledgerEntries).toHaveLength(3);
    const total = ledgerEntries
      .filter((e) => e.type !== "GROSS_PAYMENT")
      .reduce((sum, e) => sum + e.amountMinor, 0);
    expect(total).toBe(500000);
  });

  it("IPN webhook does NOT confirm the booking when validation reports invalid", async () => {
    const { bookingId, travelerToken } = await createHeldBooking();
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-e2e-3",
    });
    await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);

    fakeProvider.validateTransaction.mockResolvedValue({
      valid: false,
      amountMinor: 0,
      currency: "",
      storeId: null,
      valId: null,
    });

    await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({
        tran_id: "tran-e2e-3",
        val_id: "fake-val-id",
        status: "INVALID",
      });

    const statusRes = await request(app.getHttpServer())
      .get(`/bookings/${bookingId}/payment-status`)
      .set("Authorization", `Bearer ${travelerToken}`);
    expect(statusRes.body.paymentStatus).toBe("PENDING");
  });

  it("a duplicate/retried IPN for an already-confirmed booking is a safe no-op", async () => {
    const { bookingId, travelerToken } = await createHeldBooking();
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-e2e-4",
    });
    await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);
    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
      valId: "val-e2e-4",
    });

    await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({ tran_id: "tran-e2e-4", val_id: "val-e2e-4", status: "VALID" });
    // Second, duplicate IPN for the same transaction
    const secondIpn = await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({ tran_id: "tran-e2e-4", val_id: "val-e2e-4", status: "VALID" });
    expect(secondIpn.status).toBe(201);

    const ledgerEntries = await testPrisma.ledgerEntry.findMany({
      where: { bookingId },
    });
    expect(ledgerEntries).toHaveLength(3); // not 6 — no duplicate ledger writes
  });
});
```

- [ ] **Step 3: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- payment-confirmation`
Expected: PASS.

- [ ] **Step 4: Write the cancellation-policy e2e test**

`apps/api/test/booking-cancellation-policy.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { PaymentProviderPort } from "src/common/payments/payment-provider.port";
import { cleanDatabase } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Booking cancellation policy (e2e)", () => {
  let app: INestApplication;
  let fakeProvider: {
    createSession: jest.Mock;
    validateTransaction: jest.Mock;
    queryByTranId: jest.Mock;
  };

  beforeAll(async () => {
    fakeProvider = {
      createSession: jest.fn(),
      validateTransaction: jest.fn(),
      queryByTranId: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PaymentProviderPort)
      .useValue(fakeProvider)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    jest.clearAllMocks();
  });

  it("cancelling a HELD booking requires no acknowledgement", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "cancel-vendor1@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "cancel-traveler1@example.com",
    );
    const booking = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-01",
        checkOut: "2026-09-02",
      });

    const res = await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/cancel`)
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("cancelling a CONFIRMED+PAID booking without acknowledgeNoRefund returns 400 and leaves it CONFIRMED", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "cancel-vendor2@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "cancel-traveler2@example.com",
    );
    const booking = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-01",
        checkOut: "2026-09-02",
      });
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://x",
      tranId: "tran-cancel-1",
    });
    await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);
    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
      valId: "val-cancel-1",
    });
    await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({
        tran_id: "tran-cancel-1",
        val_id: "val-cancel-1",
        status: "VALID",
      });

    const res = await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/cancel`)
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({});
    expect(res.status).toBe(400);

    const statusRes = await request(app.getHttpServer())
      .get(`/bookings/${booking.body.id}/payment-status`)
      .set("Authorization", `Bearer ${travelerToken}`);
    expect(statusRes.body.paymentStatus).toBe("PAID");
  });

  it("cancelling a CONFIRMED+PAID booking WITH acknowledgeNoRefund succeeds, keeping paymentStatus PAID", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "cancel-vendor3@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "cancel-traveler3@example.com",
    );
    const booking = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-01",
        checkOut: "2026-09-02",
      });
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://x",
      tranId: "tran-cancel-2",
    });
    await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);
    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
      valId: "val-cancel-2",
    });
    await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({
        tran_id: "tran-cancel-2",
        val_id: "val-cancel-2",
        status: "VALID",
      });

    const res = await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/cancel`)
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({ acknowledgeNoRefund: true });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.paymentStatus).toBe("PAID");
  });
});
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- booking-cancellation-policy`
Expected: PASS.

- [ ] **Step 6: Write the admin commission e2e test**

`apps/api/test/admin-commission.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { createVerifiedVendor, createAdmin } from "./helpers/test-fixtures";

describe("Admin commission (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  it("admin can update a vendor's commissionRatePercent", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "commission-admin@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "commission-vendor@example.com",
    );

    const res = await request(app.getHttpServer())
      .patch(`/admin/vendors/${vendorId}/commission`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionRatePercent: 20 });

    expect(res.status).toBe(200);
    expect(res.body.commissionRatePercent).toBe(20);
  });

  it("a non-admin cannot update commission", async () => {
    const { accessToken: vendorToken, vendorId } = await createVerifiedVendor(
      app,
      "commission-vendor2@example.com",
    );

    const res = await request(app.getHttpServer())
      .patch(`/admin/vendors/${vendorId}/commission`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ commissionRatePercent: 20 });

    expect(res.status).toBe(403);
  });

  it("rejects a commissionRatePercent outside 0-100", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "commission-admin2@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "commission-vendor3@example.com",
    );

    const res = await request(app.getHttpServer())
      .patch(`/admin/vendors/${vendorId}/commission`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionRatePercent: 150 });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 7: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- admin-commission`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/test/payment-confirmation.e2e-spec.ts apps/api/test/booking-cancellation-policy.e2e-spec.ts apps/api/test/admin-commission.e2e-spec.ts apps/api/test/helpers/test-db.ts
git commit -m "test(api): add e2e coverage for payment confirmation, cancellation policy, admin commission"
```

---

## Task 12: Full monorepo verification + PR

**Files:** None (verification only).

- [ ] **Step 1: Full monorepo checks**

Run:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green. Pay special attention to `pnpm test`'s FULL e2e suite run (not just this module's new specs) — the prior `add-rate-limiting` module discovered real cross-suite interference only when the full suite ran together; this module changes `cancel`'s signature and removes a route, both of which could affect other e2e specs that call these endpoints. Check specifically whether any OTHER existing e2e spec (`booking-lifecycle.e2e-spec.ts`, `booking-ownership.e2e-spec.ts`, `booking-availability.e2e-spec.ts`) calls the now-removed `POST /bookings/:id/confirm-payment` or the old two-argument `cancel` — if so, those tests need updating as part of this task, not left broken.

- [ ] **Step 2: Search for and fix any other callers of the removed/changed endpoints**

Run: `grep -rn "confirm-payment" apps/api/test apps/api/src`
Expected: no remaining references outside this module's own new tests (which explicitly assert 404 for it). If any existing e2e spec still calls this route expecting it to work, update that spec to use the new `initiate-payment` + IPN flow instead, following the pattern established in Task 11's `payment-confirmation.e2e-spec.ts`.

- [ ] **Step 3: Push branch and open PR**

```bash
git checkout -b feat/payment-gateway-integration
git push -u origin feat/payment-gateway-integration
gh pr create --title "feat: SSLCommerz payment gateway integration" --body "Implements ROADMAP.md item 1.6. See docs/superpowers/specs/2026-07-25-payment-gateway-integration-design.md for full design."
gh pr checks --watch
```

- [ ] **Step 4: Merge once the `verify` CI check is green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Update ROADMAP.md**

After merge, on a new small branch/PR: change item 1.6's status from `🚧 next` to `✅`, and mark 1.7 (`add-observability`) as `🚧 next`.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc has a corresponding task — schema (Task 1), env (Task 2), port interface (Task 3), real implementation (Task 4), `initiatePayment`/`confirmIfValid`/`getPaymentStatus`/cancel-policy (Task 6), IPN controller (Task 8), reconciliation (Task 9), commission admin endpoint (Task 10), e2e proof of every key risk area from the design's Testing Strategy section (Task 11). ✓
- **Found during self-review and corrected inline (Task 9):** the original task draft called `paymentProvider.validateTransaction(booking.gatewayTranId)` for reconciliation, but `validateTransaction` is designed to take a `val_id` (from an IPN), not a `tran_id` (which is all the reconciliation job has before it queries SSLCommerz). This is a real API-shape mismatch, not a naming nitpick — SSLCommerz's Order Validation API and Transaction Query API are different endpoints with different required parameters. Corrected by adding a second `PaymentProviderPort` method, `queryByTranId`, and widening `ValidationResult` with a `valId` field so the reconciliation path can obtain the `val_id` it needs to then call the SAME `confirmIfValid` used by the webhook — preserving the "one code path confirms bookings" invariant from the design doc rather than letting reconciliation confirm bookings through a different, un-validated route.
- **Type consistency:** `PaymentSession`, `ValidationResult`, `BookingRecord.paymentStatus`, `confirmIfValid`'s signature, and `cancel`'s new third parameter are each defined once (Tasks 3, 5, 6) and referenced identically by every later task that uses them. ✓
- **No placeholders:** every step has complete, real code; the one place a genuine design gap was found (Task 9's interface mismatch), the plan says so explicitly and resolves it in-place rather than leaving a TODO.
