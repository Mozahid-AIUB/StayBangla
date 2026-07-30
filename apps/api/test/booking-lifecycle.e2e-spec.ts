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

describe("Booking lifecycle (e2e)", () => {
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

  async function confirmViaPayment(
    bookingId: string,
    travelerToken: string,
    tranId: string,
    valId: string,
    amountMinor: number,
  ): Promise<void> {
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId,
    });
    await request(app.getHttpServer())
      .post(`/v1/bookings/${bookingId}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);
    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor,
      currency: "BDT",
      storeId: null,
      valId,
    });
    await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({ tran_id: tranId, val_id: valId, status: "VALID" });
  }

  it("full happy path: create -> confirm via IPN -> checkout", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "lifecycle-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "lifecycle-traveler@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-01",
        checkOut: "2026-12-03",
        guestCount: 2,
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("HELD");
    expect(created.body.totalAmountMinor).toBe(1000000);

    await confirmViaPayment(
      created.body.id as string,
      travelerToken,
      "tran-lifecycle-1",
      "val-lifecycle-1",
      1000000,
    );

    const statusRes = await request(app.getHttpServer())
      .get(`/v1/bookings/${created.body.id}/payment-status`)
      .set("Authorization", `Bearer ${travelerToken}`);
    expect(statusRes.body.paymentStatus).toBe("PAID");

    const checkedOut = await request(app.getHttpServer())
      .post(`/v1/bookings/${created.body.id}/checkout`)
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(checkedOut.status).toBe(201);
    expect(checkedOut.body.status).toBe("COMPLETED");
  });

  it("a duplicate/retried IPN for an already-confirmed booking is idempotent", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "idempotent-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "idempotent-traveler@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-05",
        checkOut: "2026-12-06",
      });

    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-idempotent-1",
    });
    await request(app.getHttpServer())
      .post(`/v1/bookings/${created.body.id}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);
    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
      valId: "val-idempotent-1",
    });

    const first = await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({
        tran_id: "tran-idempotent-1",
        val_id: "val-idempotent-1",
        status: "VALID",
      });
    const second = await request(app.getHttpServer())
      .post("/payments/sslcommerz/ipn")
      .send({
        tran_id: "tran-idempotent-1",
        val_id: "val-idempotent-1",
        status: "VALID",
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const statusRes = await request(app.getHttpServer())
      .get(`/v1/bookings/${created.body.id}/payment-status`)
      .set("Authorization", `Bearer ${travelerToken}`);
    expect(statusRes.body.paymentStatus).toBe("PAID");
  });

  it("rejects booking a room beyond its capacity", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "capacity-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken, {
      capacity: 2,
    });
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "capacity-traveler@example.com",
    );

    const res = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-10",
        checkOut: "2026-12-11",
        guestCount: 5,
      });

    expect(res.status).toBe(400);
  });

  it("rejects a checkIn date that is not before checkOut", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "date-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "date-traveler@example.com",
    );

    const res = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-15",
        checkOut: "2026-12-15",
      });

    expect(res.status).toBe(400);
  });

  it("vendor blackout block also blocks a customer booking for the same dates", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "block-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "block-traveler@example.com",
    );

    const block = await request(app.getHttpServer())
      .post("/v1/vendor/blocks")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        startDate: "2026-12-20",
        endDate: "2026-12-22",
      });
    expect(block.status).toBe(201);

    const attempt = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-21",
        checkOut: "2026-12-23",
      });
    expect(attempt.status).toBe(409);
  });
});
