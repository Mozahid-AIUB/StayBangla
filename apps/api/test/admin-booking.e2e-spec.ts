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
    checkIn = "2026-11-01",
    checkOut = "2026-11-03",
  ): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn,
        checkOut,
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

  it("GET /admin/bookings?district= and ?from=&to= execute their raw-SQL casts against the real database", async () => {
    // Regression coverage: the district/from/to filter fragments each embed
    // an explicit Postgres cast (::"District", ::date) added after the
    // brief's verbatim status-filter cast was found to be necessary. Unlike
    // status (exercised above), these were never issued as a real query
    // before, so a wrong type name or column mismatch here would only
    // surface as a live 500 — not a red test. This test's job is solely to
    // prove each cast survives a real execution, not to re-prove filtering
    // semantics (that's the exclusion test below).
    const { accessToken: adminToken } = await createAdmin(
      app,
      "booking-e2e-admin5@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor5@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "booking-e2e-traveler4@example.com",
    );
    const bookingId = await createConfirmedBooking(
      travelerToken,
      roomId,
      "2026-11-01",
      "2026-11-03",
    );

    // createHotelWithRoom always creates the hotel in DHAKA.
    const byDistrict = await request(app.getHttpServer())
      .get("/v1/admin/bookings?district=DHAKA")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byDistrict.status).toBe(200);
    expect(
      byDistrict.body.items.some((b: { id: string }) => b.id === bookingId),
    ).toBe(true);

    const byDateRange = await request(app.getHttpServer())
      .get("/v1/admin/bookings?from=2026-10-25&to=2026-11-10")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byDateRange.status).toBe(200);
    expect(
      byDateRange.body.items.some((b: { id: string }) => b.id === bookingId),
    ).toBe(true);

    // All four filter fragments (status/district/from/to) combined in one
    // query, so their casts are also proven to compose without colliding.
    const combined = await request(app.getHttpServer())
      .get(
        "/v1/admin/bookings?status=HELD&district=DHAKA&from=2026-10-25&to=2026-11-10",
      )
      .set("Authorization", `Bearer ${adminToken}`);
    expect(combined.status).toBe(200);
    expect(
      combined.body.items.some((b: { id: string }) => b.id === bookingId),
    ).toBe(true);
  });

  it("GET /admin/bookings?status= excludes bookings that are not in the requested status", async () => {
    // Every other assertion in this file only checks "the booking I created
    // is present" — that also passes if filtering is entirely broken (e.g.
    // statusFilter silently became Prisma.empty and every query returns the
    // whole platform). This test creates two bookings, changes only one
    // booking's status, and asserts the other is ABSENT from a status-scoped
    // list — the only kind of assertion a broken/no-op filter cannot satisfy.
    const { accessToken: adminToken } = await createAdmin(
      app,
      "booking-e2e-admin6@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor6@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "booking-e2e-traveler5@example.com",
    );
    // Non-overlapping date ranges on the same room so both bookings succeed.
    const cancelledBookingId = await createConfirmedBooking(
      travelerToken,
      roomId,
      "2026-11-01",
      "2026-11-03",
    );
    const heldBookingId = await createConfirmedBooking(
      travelerToken,
      roomId,
      "2026-11-05",
      "2026-11-07",
    );

    const cancel = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${cancelledBookingId}/force-cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "exclusion test" });
    expect(cancel.status).toBe(201);

    const cancelledList = await request(app.getHttpServer())
      .get("/v1/admin/bookings?status=CANCELLED")
      .set("Authorization", `Bearer ${adminToken}`);
    const cancelledIds = cancelledList.body.items.map(
      (b: { id: string }) => b.id,
    );
    expect(cancelledIds).toContain(cancelledBookingId);
    expect(cancelledIds).not.toContain(heldBookingId);

    const heldList = await request(app.getHttpServer())
      .get("/v1/admin/bookings?status=HELD")
      .set("Authorization", `Bearer ${adminToken}`);
    const heldIds = heldList.body.items.map((b: { id: string }) => b.id);
    expect(heldIds).toContain(heldBookingId);
    expect(heldIds).not.toContain(cancelledBookingId);
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
