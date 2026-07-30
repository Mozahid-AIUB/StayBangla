import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { PaymentProviderPort } from "src/common/payments/payment-provider.port";
import { cleanDatabase } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";
import {
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Booking ownership (e2e)", () => {
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

  it("vendor B cannot checkout vendor A's booking", async () => {
    const { accessToken: vendorAToken } = await createVerifiedVendor(
      app,
      "ownerA@example.com",
    );
    const { accessToken: vendorBToken } = await createVerifiedVendor(
      app,
      "ownerB@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorAToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "ownership-traveler@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2027-01-01",
        checkOut: "2027-01-03",
      });
    fakeProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-ownership-1",
    });
    await request(app.getHttpServer())
      .post(`/v1/bookings/${created.body.id}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerToken}`);
    fakeProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 1000000,
      currency: "BDT",
      storeId: null,
      valId: "val-ownership-1",
    });
    await request(app.getHttpServer()).post("/payments/sslcommerz/ipn").send({
      tran_id: "tran-ownership-1",
      val_id: "val-ownership-1",
      status: "VALID",
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/bookings/${created.body.id}/checkout`)
      .set("Authorization", `Bearer ${vendorBToken}`);

    expect(res.status).toBe(409);
  });

  it("traveler B cannot cancel traveler A's booking", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "cancel-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerAToken } = await createTraveler(
      app,
      "cancel-a@example.com",
    );
    const { accessToken: travelerBToken } = await createTraveler(
      app,
      "cancel-b@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerAToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2027-01-10",
        checkOut: "2027-01-12",
      });

    const res = await request(app.getHttpServer())
      .post(`/v1/bookings/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${travelerBToken}`);

    expect(res.status).toBe(409);
  });

  it("initiate-payment requires auth and rejects a caller who is not the booking's traveler", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "confirm-owner-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerAToken } = await createTraveler(
      app,
      "confirm-owner-a@example.com",
    );
    const { accessToken: travelerBToken } = await createTraveler(
      app,
      "confirm-owner-b@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerAToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2027-02-01",
        checkOut: "2027-02-03",
      });

    const noAuth = await request(app.getHttpServer()).post(
      `/v1/bookings/${created.body.id}/initiate-payment`,
    );
    expect(noAuth.status).toBe(401);

    const wrongTraveler = await request(app.getHttpServer())
      .post(`/v1/bookings/${created.body.id}/initiate-payment`)
      .set("Authorization", `Bearer ${travelerBToken}`);
    expect(wrongTraveler.status).toBe(403);
  });

  it("an unverified vendor cannot create a hotel", async () => {
    const { accessToken } = await registerAndLogin(
      app,
      "unverified@example.com",
    );
    const res = await request(app.getHttpServer())
      .post("/v1/hotels")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Sneaky Hotel",
        city: "DHAKA",
        address: "1 Rd",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      });
    expect(res.status).toBe(403);
  });
});
