import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Booking lifecycle (e2e)", () => {
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

  it("full happy path: create -> confirm-payment -> checkout", async () => {
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
      .post("/bookings")
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

    const confirmed = await request(app.getHttpServer()).post(
      `/bookings/${created.body.id}/confirm-payment`,
    );
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.status).toBe("CONFIRMED");

    const checkedOut = await request(app.getHttpServer())
      .post(`/bookings/${created.body.id}/checkout`)
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(checkedOut.status).toBe(201);
    expect(checkedOut.body.status).toBe("COMPLETED");
  });

  it("confirm-payment is idempotent when called twice", async () => {
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
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-05",
        checkOut: "2026-12-06",
      });

    const first = await request(app.getHttpServer()).post(
      `/bookings/${created.body.id}/confirm-payment`,
    );
    const second = await request(app.getHttpServer()).post(
      `/bookings/${created.body.id}/confirm-payment`,
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.status).toBe("CONFIRMED");
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
      .post("/bookings")
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
      .post("/bookings")
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
      .post("/vendor/blocks")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        startDate: "2026-12-20",
        endDate: "2026-12-22",
      });
    expect(block.status).toBe(201);

    const attempt = await request(app.getHttpServer())
      .post("/bookings")
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
