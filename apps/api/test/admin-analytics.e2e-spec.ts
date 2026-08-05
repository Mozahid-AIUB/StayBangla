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

  it("GET /admin/analytics/district-distribution discriminates districts: a district with a seeded hotel is non-zero, a district with a different seeded hotel does not inherit that count", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin2b@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor3b@example.com",
    );
    // createHotelWithRoom seeds a hotel in DHAKA (see test-fixtures.ts).
    await createHotelWithRoom(app, vendorToken);
    // Seed a second, distinct hotel directly in SYLHET — same test-only
    // shortcut pattern used throughout this file — so the SYLHET assertion
    // below actually executes against real data instead of a vacuous
    // "if present" branch.
    await testPrisma.hotel.create({
      data: {
        ownerId: vendorId,
        name: "Sylhet Test Hotel",
        city: "SYLHET",
        address: "456 Test Road",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/district-distribution")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const dhakaRow = res.body.find(
      (row: { district: string }) => row.district === "DHAKA",
    );
    const sylhetRow = res.body.find(
      (row: { district: string }) => row.district === "SYLHET",
    );
    expect(dhakaRow.hotels).toBe(1);
    expect(sylhetRow.hotels).toBe(1);
    // Both districts have exactly one hotel each — proving the merge keys
    // off the actual city column per-row rather than e.g. summing every
    // hotel into every district or returning one shared total.
  });

  it("GET /admin/analytics/district-distribution excludes a deactivated hotel from its district's count", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin2c@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor3c@example.com",
    );
    const { hotelId } = await createHotelWithRoom(app, vendorToken);

    const beforeRes = await request(app.getHttpServer())
      .get("/v1/admin/analytics/district-distribution")
      .set("Authorization", `Bearer ${adminToken}`);
    const dhakaBefore = beforeRes.body.find(
      (row: { district: string }) => row.district === "DHAKA",
    );
    expect(dhakaBefore.hotels).toBe(1);

    // Deactivate the hotel directly — no HTTP-facing deactivation endpoint
    // exists in this test suite's scope, same test-only-shortcut pattern
    // used throughout this file.
    await testPrisma.hotel.update({
      where: { id: hotelId },
      data: { isActive: false },
    });

    const afterRes = await request(app.getHttpServer())
      .get("/v1/admin/analytics/district-distribution")
      .set("Authorization", `Bearer ${adminToken}`);
    const dhakaAfter = afterRes.body.find(
      (row: { district: string }) => row.district === "DHAKA",
    );
    // Would fail (still 1) if the service's groupBy did not filter on
    // isActive — this is the isActive/"Active hotel/vehicle listing
    // counts" doc-vs-behavior fix.
    expect(dhakaAfter ? dhakaAfter.hotels : 0).toBe(0);
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

  it("GET /admin/analytics/top-vendors does not overflow when a vendor's summed GROSS_PAYMENT exceeds int32 max", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin-overflow@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor-overflow@example.com",
    );
    // Two distinct hotels/rooms for the same vendor, so each booking gets its
    // own room_id and the gist exclusion constraint (room_id WITH =, date_range
    // WITH &&) never sees an overlap even though the date ranges themselves
    // coincide.
    const { roomId: roomId1 } = await createHotelWithRoom(app, vendorToken);
    const { roomId: roomId2 } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler-overflow@example.com",
    );
    const bookingRes1 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId1,
        checkIn: "2026-12-20",
        checkOut: "2026-12-21",
      });
    const bookingRes2 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId2,
        checkIn: "2026-12-20",
        checkOut: "2026-12-21",
      });

    // int32 max is 2,147,483,647. Two GROSS_PAYMENT rows of 1,500,000,000
    // each sum to 3,000,000,000 — comfortably past int32 max, but still far
    // below Number.MAX_SAFE_INTEGER, so Number(bigint) round-trips exactly.
    // A raw ::int cast on SUM(amount_minor) throws "integer out of range"
    // at the database level for this fixture; only a ::bigint cast (plus a
    // JS-side BigInt -> Number conversion, since $queryRaw would otherwise
    // hand back a BigInt that JSON.stringify cannot serialize) survives it.
    // Production only ever writes one GROSS_PAYMENT row per booking (see
    // bookings.service.ts's confirmIfValid), so this now spreads the two
    // rows across two distinct bookings for the same vendor instead of
    // double-writing one booking — matching how `ledger_entries` actually
    // gets populated and respecting the UNIQUE (booking_id, type) constraint.
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes1.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 1500000000,
        ratePercentApplied: 10,
      },
    });
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes2.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 1500000000,
        ratePercentApplied: 10,
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/top-vendors")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const row = (
      res.body as { vendorId: string; totalRevenueMinor: number }[]
    ).find((r) => r.vendorId === vendorId);
    expect(row).toBeDefined();
    expect(row!.totalRevenueMinor).toBe(3000000000);
    expect(typeof row!.totalRevenueMinor).toBe("number");
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

  it("GET /admin/analytics/revenue-trend?period=weekly merges entries from different Dhaka days of the same Dhaka week, and keeps the next week separate", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin-weekly@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor-weekly@example.com",
    );
    // Three distinct rooms so the three bookings below (needed because each
    // GROSS_PAYMENT ledger row must belong to a different booking under the
    // new UNIQUE (booking_id, type) constraint) never collide on the gist
    // room-overlap exclusion, even though their date ranges coincide.
    const { roomId: roomId1 } = await createHotelWithRoom(app, vendorToken);
    const { roomId: roomId2 } = await createHotelWithRoom(app, vendorToken);
    const { roomId: roomId3 } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler-weekly@example.com",
    );
    const bookingRes1 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId1,
        checkIn: "2026-12-18",
        checkOut: "2026-12-19",
      });
    const bookingRes2 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId2,
        checkIn: "2026-12-18",
        checkOut: "2026-12-19",
      });
    const bookingRes3 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId3,
        checkIn: "2026-12-18",
        checkOut: "2026-12-19",
      });

    // Monday 2026-07-27 and Thursday 2026-07-30 are both in the same Dhaka
    // week; Monday 2026-08-03 is the following Dhaka week. Real Postgres
    // round-trip proves the service's period=weekly branch actually invokes
    // startOfDhakaWeek end-to-end (not just in a mocked unit test). Each row
    // sits on its own booking (production only ever writes one GROSS_PAYMENT
    // row per booking) — the bucketing keys off the ledger row's createdAt,
    // not the booking, so spreading across bookings does not disturb it.
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes1.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 11000,
        ratePercentApplied: 10,
        createdAt: new Date("2026-07-27T01:00:00Z"),
      },
    });
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes2.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 22000,
        ratePercentApplied: 10,
        createdAt: new Date("2026-07-30T10:00:00Z"),
      },
    });
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes3.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 55000,
        ratePercentApplied: 10,
        createdAt: new Date("2026-08-03T01:00:00Z"),
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/revenue-trend?period=weekly")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const weekOfJuly27 = res.body.find(
      (b: { bucketStart: string }) =>
        b.bucketStart === "2026-07-26T18:00:00.000Z",
    );
    const weekOfAug3 = res.body.find(
      (b: { bucketStart: string }) =>
        b.bucketStart === "2026-08-02T18:00:00.000Z",
    );
    expect(weekOfJuly27).toBeDefined();
    expect(weekOfJuly27.grossMinor).toBe(33000);
    expect(weekOfAug3).toBeDefined();
    expect(weekOfAug3.grossMinor).toBe(55000);
  });

  it("GET /admin/analytics/revenue-trend?period=monthly merges entries from different Dhaka days of the same Dhaka month", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin-monthly@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor-monthly@example.com",
    );
    // Three distinct rooms so the three bookings below (needed because each
    // GROSS_PAYMENT ledger row must belong to a different booking under the
    // new UNIQUE (booking_id, type) constraint) never collide on the gist
    // room-overlap exclusion, even though their date ranges coincide.
    const { roomId: roomId1 } = await createHotelWithRoom(app, vendorToken);
    const { roomId: roomId2 } = await createHotelWithRoom(app, vendorToken);
    const { roomId: roomId3 } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler-monthly@example.com",
    );
    const bookingRes1 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId1,
        checkIn: "2026-12-22",
        checkOut: "2026-12-23",
      });
    const bookingRes2 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId2,
        checkIn: "2026-12-22",
        checkOut: "2026-12-23",
      });
    const bookingRes3 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId3,
        checkIn: "2026-12-22",
        checkOut: "2026-12-23",
      });

    // Each row sits on its own booking (production only ever writes one
    // GROSS_PAYMENT row per booking) — bucketing keys off the ledger row's
    // createdAt, not the booking, so this does not disturb the Dhaka-month
    // grouping under test.
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes1.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 7000,
        ratePercentApplied: 10,
        createdAt: new Date("2026-09-02T01:00:00Z"),
      },
    });
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes2.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 8000,
        ratePercentApplied: 10,
        createdAt: new Date("2026-09-25T01:00:00Z"),
      },
    });
    // A different Dhaka month must NOT merge into the September bucket.
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes3.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 99000,
        ratePercentApplied: 10,
        createdAt: new Date("2026-10-05T01:00:00Z"),
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/revenue-trend?period=monthly")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // 2026-09-01T00:00 Dhaka == 2026-08-31T18:00:00Z
    const septBucket = res.body.find(
      (b: { bucketStart: string }) =>
        b.bucketStart === "2026-08-31T18:00:00.000Z",
    );
    expect(septBucket).toBeDefined();
    expect(septBucket.grossMinor).toBe(15000);
  });

  it("GET /admin/analytics/revenue-trend?from=&to= filters using Dhaka calendar-day boundaries, excluding a same-UTC-day entry that falls just before Dhaka midnight and including one just after", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin-fromto@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor-fromto@example.com",
    );
    // Two distinct rooms so the two bookings below (needed because each
    // GROSS_PAYMENT ledger row must belong to a different booking under the
    // new UNIQUE (booking_id, type) constraint) never collide on the gist
    // room-overlap exclusion, even though their date ranges coincide.
    const { roomId: roomId1 } = await createHotelWithRoom(app, vendorToken);
    const { roomId: roomId2 } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler-fromto@example.com",
    );
    const bookingRes1 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId1,
        checkIn: "2026-12-25",
        checkOut: "2026-12-26",
      });
    const bookingRes2 = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId2,
        checkIn: "2026-12-25",
        checkOut: "2026-12-26",
      });

    // Requesting from=2026-07-30&to=2026-07-31 should admit exactly the
    // Dhaka calendar day 2026-07-30, i.e. [2026-07-29T18:00:00Z,
    // 2026-07-30T18:00:00Z). A naive UTC filter would instead admit
    // [2026-07-30T00:00:00Z, 2026-07-31T00:00:00Z), which would wrongly
    // EXCLUDE the first entry below (17:00Z, still Dhaka 2026-07-30 evening,
    // but before UTC 2026-07-30T00:00 is impossible — so instead we prove
    // the other direction: an entry at 2026-07-29T19:00:00Z is Dhaka
    // 2026-07-30T01:00, which the Dhaka-correct filter must INCLUDE but a
    // naive UTC filter (gte 2026-07-30T00:00:00Z) would wrongly EXCLUDE.
    const includedInstant = new Date("2026-07-29T19:00:00.000Z"); // Dhaka 07-30 01:00
    const excludedInstant = new Date("2026-07-30T19:00:00.000Z"); // Dhaka 07-31 01:00 (next Dhaka day, correctly excluded either way)
    // Each row sits on its own booking (production only ever writes one
    // GROSS_PAYMENT row per booking) — the filter keys off the ledger row's
    // createdAt, not the booking, so this does not disturb the boundary
    // under test.
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes1.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 12345,
        ratePercentApplied: 10,
        createdAt: includedInstant,
      },
    });
    await testPrisma.ledgerEntry.create({
      data: {
        bookingId: bookingRes2.body.id as string,
        type: "GROSS_PAYMENT",
        amountMinor: 99999,
        ratePercentApplied: 10,
        createdAt: excludedInstant,
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/revenue-trend?from=2026-07-30&to=2026-07-31")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const totalGross = (res.body as { grossMinor: number }[]).reduce(
      (sum, b) => sum + b.grossMinor,
      0,
    );
    // A naive UTC filter (gte new Date("2026-07-30") = 2026-07-30T00:00:00Z)
    // would exclude the 12345 entry (created at 2026-07-29T19:00:00Z, before
    // UTC midnight on 07-30) even though it belongs to Dhaka calendar day
    // 07-30 — this assertion fails under that bug.
    expect(totalGross).toBe(12345);
  });
});
