import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase, testPrisma } from "./helpers/test-db";
import {
  createAdmin,
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Admin Analytics (e2e)", () => {
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

  it("GET /admin/analytics/booking-status-breakdown requires ADMIN/SUPER_ADMIN", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor1@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/booking-status-breakdown")
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /admin/analytics/booking-status-breakdown returns all 8 statuses, zero-filled, against a small seeded dataset", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin1@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor2@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler1@example.com",
    );
    await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-01",
        checkOut: "2026-12-03",
      });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/booking-status-breakdown")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "AUTO_CANCELLED",
        "BLOCKED",
        "CANCELLED",
        "CHECKED_IN",
        "COMPLETED",
        "CONFIRMED",
        "HELD",
        "REFUNDED",
      ].sort(),
    );
    expect(res.body.HELD).toBeGreaterThanOrEqual(1);
  });

  it("GET /admin/analytics/booking-status-breakdown discriminates between statuses (a status with no bookings stays 0, one with bookings does not)", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin1b@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor1b@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler1b@example.com",
    );
    await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-05",
        checkOut: "2026-12-07",
      });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/booking-status-breakdown")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // The seeded booking lands in HELD (nothing confirms payment in this test),
    // so every OTHER status must remain exactly 0 — proving the breakdown
    // discriminates per-status rather than e.g. dumping the total count into
    // every bucket or only ever returning a non-discriminating default.
    expect(res.body.HELD).toBeGreaterThanOrEqual(1);
    expect(res.body.CONFIRMED).toBe(0);
    expect(res.body.CANCELLED).toBe(0);
    expect(res.body.COMPLETED).toBe(0);
    expect(res.body.CHECKED_IN).toBe(0);
    expect(res.body.AUTO_CANCELLED).toBe(0);
    expect(res.body.REFUNDED).toBe(0);
    expect(res.body.BLOCKED).toBe(0);
  });

  it("GET /admin/analytics/district-distribution reflects seeded hotel/vehicle counts", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin2@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor3@example.com",
    );
    await createHotelWithRoom(app, vendorToken);

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/district-distribution")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.some((row: { hotels: number }) => row.hotels >= 1)).toBe(
      true,
    );
  });

  it("GET /admin/analytics/district-distribution discriminates districts: a district with a seeded hotel is non-zero, a district with none is absent or zero", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin2b@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor3b@example.com",
    );
    // createHotelWithRoom seeds a hotel in DHAKA (see test-fixtures.ts).
    await createHotelWithRoom(app, vendorToken);

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/district-distribution")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const dhakaRow = res.body.find(
      (row: { district: string }) => row.district === "DHAKA",
    );
    expect(dhakaRow.hotels).toBeGreaterThanOrEqual(1);

    const sylhetRow = res.body.find(
      (row: { district: string }) => row.district === "SYLHET",
    );
    // SYLHET has no seeded hotels/vehicles in this test: either it's absent
    // from the result entirely, or present with hotels: 0. Either way it must
    // NOT show the same non-zero count as DHAKA — proving the merge keys off
    // the actual city column rather than returning one shared total.
    if (sylhetRow) {
      expect(sylhetRow.hotels).toBe(0);
    }
  });

  it("GET /admin/analytics/top-vendors ranks by revenue by default", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin3@example.com",
    );

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/top-vendors")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /admin/analytics/top-vendors ranks vendors by totalRevenueMinor descending when GROSS_PAYMENT ledger entries differ", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin3b@example.com",
    );
    const { vendorId: highVendorId, accessToken: highVendorToken } =
      await createVerifiedVendor(app, "analytics-e2e-vendor-high@example.com");
    const { vendorId: lowVendorId, accessToken: lowVendorToken } =
      await createVerifiedVendor(app, "analytics-e2e-vendor-low@example.com");
    const { roomId: highRoomId } = await createHotelWithRoom(
      app,
      highVendorToken,
    );
    const { roomId: lowRoomId } = await createHotelWithRoom(
      app,
      lowVendorToken,
    );
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler3b@example.com",
    );

    const highBookingRes = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: highRoomId,
        checkIn: "2026-12-10",
        checkOut: "2026-12-11",
      });
    const lowBookingRes = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: lowRoomId,
        checkIn: "2026-12-12",
        checkOut: "2026-12-13",
      });

    // Seed distinct, non-equal GROSS_PAYMENT ledger amounts directly — no
    // HTTP-facing payment-confirmation flow is available in this test suite,
    // same test-only-shortcut pattern used throughout test-fixtures.ts.
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: highBookingRes.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 900000,
        ratePercentApplied: 10,
      },
    });
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: lowBookingRes.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 100000,
        ratePercentApplied: 10,
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/top-vendors")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const rows: { vendorId: string; totalRevenueMinor: number }[] = res.body;
    const highRow = rows.find((r) => r.vendorId === highVendorId);
    const lowRow = rows.find((r) => r.vendorId === lowVendorId);
    expect(highRow).toBeDefined();
    expect(lowRow).toBeDefined();
    expect(highRow!.totalRevenueMinor).toBe(900000);
    expect(lowRow!.totalRevenueMinor).toBe(100000);
    // Prove ordering, not just presence: the higher-revenue vendor must rank
    // strictly before the lower-revenue vendor in the default (revenue) sort.
    const highIndex = rows.findIndex((r) => r.vendorId === highVendorId);
    const lowIndex = rows.findIndex((r) => r.vendorId === lowVendorId);
    expect(highIndex).toBeLessThan(lowIndex);
  });

  it("GET /admin/analytics/revenue-trend buckets a GROSS_PAYMENT ledger entry into the correct Dhaka calendar day across a UTC-day boundary", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin4@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor4@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler4@example.com",
    );
    const bookingRes = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-15",
        checkOut: "2026-12-16",
      });

    // 2026-07-30T23:30:00Z is still 2026-07-30 in UTC, but it is already
    // 2026-07-31T05:30:00 in Asia/Dhaka (UTC+6). A naive UTC truncation would
    // bucket this into 2026-07-30; correct Dhaka truncation must bucket it
    // into 2026-07-31 (bucketStart 2026-07-30T18:00:00.000Z, i.e. Dhaka
    // midnight on 2026-07-31). This mirrors the exact boundary instant
    // already used to prove startOfDhakaDay's correctness in dhaka-time.spec.ts.
    const boundaryInstant = new Date("2026-07-30T23:30:00.000Z");
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 424242,
        ratePercentApplied: 10,
        createdAt: boundaryInstant,
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/revenue-trend")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const bucket = res.body.find(
      (b: { grossMinor: number }) => b.grossMinor === 424242,
    );
    expect(bucket).toBeDefined();
    expect(bucket.bucketStart).toBe("2026-07-30T18:00:00.000Z");
  });
});
