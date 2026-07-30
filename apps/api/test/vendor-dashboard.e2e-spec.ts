import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase, testPrisma } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

function lastNightOfCurrentDhakaMonth(): { checkIn: string; checkOut: string } {
  // Deliberately picks the last calendar night of "this month" in Dhaka
  // (UTC+6) — this is exactly the boundary a UTC-vs-Dhaka date-truncation
  // bug in the occupancy calculation would get wrong (a night correctly
  // inside the month gets silently dropped, or a night from the next month
  // gets silently included, depending on the direction of the error).
  const nowUtc = new Date();
  const dhakaNow = new Date(nowUtc.getTime() + 6 * 60 * 60 * 1000);
  const year = dhakaNow.getUTCFullYear();
  const month = dhakaNow.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const checkIn = new Date(Date.UTC(year, month, lastDay))
    .toISOString()
    .slice(0, 10);
  const checkOut = new Date(Date.UTC(year, month + 1, 1))
    .toISOString()
    .slice(0, 10);
  return { checkIn, checkOut };
}

describe("Vendor Dashboard (e2e)", () => {
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

  it("GET /vendor/dashboard/summary requires authentication", async () => {
    const res = await request(app.getHttpServer()).get(
      "/v1/vendor/dashboard/summary",
    );
    expect(res.status).toBe(401);
  });

  it("GET /vendor/dashboard/summary returns hotelOccupancyRatePct for a hotel vendor with no listings", async () => {
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor1@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const res = await request(app.getHttpServer())
      .get("/v1/vendor/dashboard/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("hotelOccupancyRatePct");
    expect(res.body.activeListings).toBe(0);
  });

  it("GET /vendor/dashboard/summary counts a booking on the last night of the current Dhaka month toward occupancy (real Postgres, not mocked)", async () => {
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-occupancy@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);
    const { checkIn, checkOut } = lastNightOfCurrentDhakaMonth();

    const booking = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn,
        checkOut,
        amountMinor: 5000,
      });
    expect(booking.status).toBe(201);

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/dashboard/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    // A UTC-truncation bug in the occupancy SQL would drop this last-night
    // booking from "this month" entirely, reporting 0% instead of a
    // positive rate for the vendor's one room with one booked night.
    expect(res.body.hotelOccupancyRatePct).toBeGreaterThan(0);
  });

  it("GET /vendor/listings returns the vendor's own rooms with photoCount", async () => {
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor2@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/listings")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: roomId, isActive: true, photoCount: 0 }),
    ]);
    void vendorId;
  });

  it("POST /vendor/ledger-entries creates an entry and it appears in GET /vendor/ledger-entries", async () => {
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor3@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const create = await request(app.getHttpServer())
      .post("/v1/vendor/ledger-entries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        roomId,
        direction: "EXPENSE",
        category: "MAINTENANCE",
        amountMinor: 1500,
        entryDate: "2026-08-01",
      });
    expect(create.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get("/v1/vendor/ledger-entries")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].amountMinor).toBe(1500);
  });

  it("POST /vendor/ledger-entries rejects category=WALK_IN_BOOKING", async () => {
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor4@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const res = await request(app.getHttpServer())
      .post("/v1/vendor/ledger-entries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        roomId,
        direction: "INCOME",
        category: "WALK_IN_BOOKING",
        amountMinor: 5000,
        entryDate: "2026-08-01",
      });
    expect(res.status).toBe(400);
  });

  it("POST /vendor/bookings/offline blocks the room's dates from GET /rooms/available", async () => {
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor5@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const create = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
        amountMinor: 5000,
      });
    expect(create.status).toBe(201);

    const available = await request(app.getHttpServer()).get(
      "/v1/rooms/available?checkIn=2026-09-01&checkOut=2026-09-03",
    );
    expect(
      available.body.find((r: { id: string }) => r.id === roomId),
    ).toBeUndefined();
  });

  it("an online booking attempt for the same offline-booked dates is rejected with 409", async () => {
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "dash-vendor6@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "dash-traveler1@example.com",
    );

    await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-10",
        checkOut: "2026-09-12",
        amountMinor: 5000,
      });

    const onlineAttempt = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-10",
        checkOut: "2026-09-12",
      });
    expect(onlineAttempt.status).toBe(409);
  });

  it("DELETE /vendor/bookings/offline/:id frees the dates again", async () => {
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor7@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const create = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-20",
        checkOut: "2026-09-22",
        amountMinor: 5000,
      });
    const bookingId = create.body.booking.id;

    await request(app.getHttpServer())
      .delete(`/v1/vendor/bookings/offline/${bookingId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    const available = await request(app.getHttpServer()).get(
      "/v1/rooms/available?checkIn=2026-09-20&checkOut=2026-09-22",
    );
    expect(
      available.body.find((r: { id: string }) => r.id === roomId),
    ).toBeDefined();
  });

  it("vendor A cannot see or delete vendor B's ledger entries", async () => {
    const { vendorId: vendorIdA, accessToken: tokenA } =
      await createVerifiedVendor(app, "dash-vendorA@example.com");
    await testPrisma.user.update({
      where: { id: vendorIdA },
      data: { vendorType: "HOTEL" },
    });
    const { roomId: roomA } = await createHotelWithRoom(app, tokenA);
    const { accessToken: tokenB } = await createVerifiedVendor(
      app,
      "dash-vendorB@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/v1/vendor/ledger-entries")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        roomId: roomA,
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 1000,
        entryDate: "2026-08-01",
      });

    const deleteAttempt = await request(app.getHttpServer())
      .delete(`/v1/vendor/ledger-entries/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(deleteAttempt.status).toBe(403);
  });
});
