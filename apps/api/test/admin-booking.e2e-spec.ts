import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createAdmin,
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Admin Booking Control (e2e)", () => {
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

  async function createConfirmedBooking(
    travelerToken: string,
    roomId: string,
  ): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-01",
        checkOut: "2026-11-03",
      });
    return created.body.id;
  }

  it("GET /admin/bookings requires ADMIN/SUPER_ADMIN", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor1@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/admin/bookings")
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /admin/bookings?status= filters correctly and is platform-wide (not scoped to one vendor)", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "booking-e2e-admin1@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor2@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "booking-e2e-traveler1@example.com",
    );
    const bookingId = await createConfirmedBooking(travelerToken, roomId);

    const res = await request(app.getHttpServer())
      .get("/v1/admin/bookings?status=HELD")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items.some((b: { id: string }) => b.id === bookingId)).toBe(
      true,
    );
  });

  it("POST /admin/bookings/:id/force-cancel cancels the booking without touching paymentStatus", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "booking-e2e-admin2@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor3@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "booking-e2e-traveler2@example.com",
    );
    const bookingId = await createConfirmedBooking(travelerToken, roomId);

    const before = await request(app.getHttpServer())
      .get(`/v1/admin/bookings?status=HELD`)
      .set("Authorization", `Bearer ${adminToken}`);
    const paymentStatusBefore = before.body.items.find(
      (b: { id: string }) => b.id === bookingId,
    ).paymentStatus;

    const cancel = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/force-cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "duplicate booking from a payment retry" });
    expect(cancel.status).toBe(201);

    const after = await request(app.getHttpServer())
      .get(`/v1/admin/bookings?status=CANCELLED`)
      .set("Authorization", `Bearer ${adminToken}`);
    const cancelled = after.body.items.find(
      (b: { id: string }) => b.id === bookingId,
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.paymentStatus).toBe(paymentStatusBefore);
  });

  it("POST /admin/bookings/:id/force-cancel is a safe no-op guard on a double force-cancel (returns 409)", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "booking-e2e-admin3@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor4@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "booking-e2e-traveler3@example.com",
    );
    const bookingId = await createConfirmedBooking(travelerToken, roomId);

    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/force-cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "first cancel" });

    const second = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/force-cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "second cancel attempt" });
    expect(second.status).toBe(409);
  });
});
