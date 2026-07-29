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
    await request(app.getHttpServer()).post("/payments/sslcommerz/ipn").send({
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
    await request(app.getHttpServer()).post("/payments/sslcommerz/ipn").send({
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
