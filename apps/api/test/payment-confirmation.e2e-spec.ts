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
      .post("/v1/bookings")
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
      .post(`/v1/bookings/${bookingId}/confirm-payment`)
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
      .post(`/v1/bookings/${bookingId}/initiate-payment`)
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
      .post(`/v1/bookings/${bookingId}/initiate-payment`)
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
      .get(`/v1/bookings/${bookingId}/payment-status`)
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

  it("IPN webhook confirms the booking when the validated storeId matches the configured store", async () => {
    // Every other fixture in this file passes storeId: null, which takes the
    // `validation.storeId !== null` early-exit in confirmIfValid and never
    // actually compares against SSLCOMMERZ_STORE_ID. This test exercises the
    // real comparison branch end-to-end using the store id configured for
    // the test environment (apps/api/.env.test: SSLCOMMERZ_STORE_ID=test-store-id).
    const { bookingId, travelerToken } = await createHeldBooking();
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-e2e-store-match",
    });
    await request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);

    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: "test-store-id",
      valId: "val-e2e-store-match",
    });

    const ipnRes = await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({
        tran_id: "tran-e2e-store-match",
        val_id: "val-e2e-store-match",
        status: "VALID",
      });
    expect(ipnRes.status).toBe(201);

    const statusRes = await request(app.getHttpServer())
      .get(`/v1/bookings/${bookingId}/payment-status`)
      .set("Authorization", `Bearer ${travelerToken}`);
    expect(statusRes.body.paymentStatus).toBe("PAID");
  });

  it("IPN webhook does NOT confirm the booking when the validated storeId does not match the configured store", async () => {
    const { bookingId, travelerToken } = await createHeldBooking();
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-e2e-store-mismatch",
    });
    await request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);

    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: "some-other-store",
      valId: "val-e2e-store-mismatch",
    });

    const ipnRes = await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({
        tran_id: "tran-e2e-store-mismatch",
        val_id: "val-e2e-store-mismatch",
        status: "VALID",
      });
    expect(ipnRes.status).toBe(201);

    const statusRes = await request(app.getHttpServer())
      .get(`/v1/bookings/${bookingId}/payment-status`)
      .set("Authorization", `Bearer ${travelerToken}`);
    expect(statusRes.body.paymentStatus).toBe("PENDING");

    const ledgerEntries = await testPrisma.ledgerEntry.findMany({
      where: { bookingId },
    });
    expect(ledgerEntries).toHaveLength(0);
  });

  it("IPN webhook does NOT confirm the booking when validation reports invalid", async () => {
    const { bookingId, travelerToken } = await createHeldBooking();
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-e2e-3",
    });
    await request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);

    fakeProvider.validateTransaction.mockResolvedValue({
      valid: false,
      amountMinor: 0,
      currency: "",
      storeId: null,
      valId: null,
    });

    await request(app.getHttpServer()).post("/payments/sslcommerz/ipn").send({
      tran_id: "tran-e2e-3",
      val_id: "fake-val-id",
      status: "INVALID",
    });

    const statusRes = await request(app.getHttpServer())
      .get(`/v1/bookings/${bookingId}/payment-status`)
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
      .post(`/v1/bookings/${bookingId}/initiate-payment`)
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

  it("the database itself rejects a second GROSS_PAYMENT row for the same booking (PAY-2)", async () => {
    // Bypasses confirmIfValid's guarded updateMany entirely and writes
    // directly against the real Postgres test database via testPrisma, to
    // prove the (booking_id, type) unique constraint — not just the
    // application-level guard — is what makes a duplicate impossible. If
    // some future code path ever forgets to replicate the updateMany guard,
    // this is the backstop that turns a silent double-credit into a hard
    // database error instead.
    const { bookingId } = await createHeldBooking();

    await testPrisma.ledgerEntry.create({
      data: {
        bookingId,
        type: "GROSS_PAYMENT",
        amountMinor: 500000,
        ratePercentApplied: 10,
      },
    });

    await expect(
      testPrisma.ledgerEntry.create({
        data: {
          bookingId,
          type: "GROSS_PAYMENT",
          amountMinor: 500000,
          ratePercentApplied: 10,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);

    const ledgerEntries = await testPrisma.ledgerEntry.findMany({
      where: { bookingId },
    });
    expect(ledgerEntries).toHaveLength(1);
  });
});
