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

// createOfflineBooking's validateDates() rejects a checkIn in the past
// relative to the real clock, so any fixture booking dates must be computed
// relative to "now" rather than hardcoded literals that will eventually
// roll into the past — see bookings.service.spec.ts's identical helper and
// its comment for the prior incident (hardcoded 2026-08-01 dates rotting
// and turning that suite red).
function futureDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

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

  it("GET /vendor/dashboard/summary's upcomingCheckIns counts only CONFIRMED bookings with a check-in today (Dhaka) or later, not all-time (real Postgres, not mocked)", async () => {
    // DEFECT 3 regression: the unfixed query has no date predicate at all
    // (`booking.count({ where: { resourceOwnerId, status: { in: [...] } } })`)
    // — it counts every CONFIRMED/CHECKED_IN booking ever made. A past
    // CONFIRMED booking must be excluded; a future one must be counted.
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-upcoming@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    // Future CONFIRMED booking — must be counted as upcoming. Computed
    // relative to "now" rather than a hardcoded literal: this test's
    // correctness depends on the date actually being in the future, and a
    // fixed literal silently stops discriminating once the calendar
    // catches up to it (this codebase has already been bitten by exactly
    // this — see futureDateStr's comment above).
    const future = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: futureDateStr(30),
        checkOut: futureDateStr(32),
        amountMinor: 5000,
      });
    expect(future.status).toBe(201);

    // Past CONFIRMED booking (created directly via Prisma/raw SQL, since
    // the offline-booking endpoint always books forward from today) — must
    // be excluded from upcomingCheckIns; the unfixed all-time count would
    // include it.
    await testPrisma.$executeRaw`
      INSERT INTO bookings (
        id, bookable_type, room_id, resource_owner_id, date_range,
        guest_count, total_amount_minor, currency, status, payment_status,
        source, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), 'ROOM', ${roomId}::uuid, ${vendorId}::uuid,
        daterange('2026-01-01'::date, '2026-01-03'::date, '[)'),
        2, 5000, 'BDT', 'CONFIRMED', 'PAID', 'OFFLINE', now(), now()
      )
    `;

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/dashboard/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.upcomingCheckIns).toBe(1);
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

  it("GET /vendor/listings keeps each room's earningsMinor/bookingCount scoped to that room, not mixed across rooms (real Postgres, not mocked)", async () => {
    // DEFECT 9 regression check: getListings was rewritten from N
    // sequential per-room queries to a single batched raw-SQL aggregate
    // (getListingAggregates) to fix an N+1. The correctness risk of that
    // rewrite is a listing's earnings/count leaking into a sibling
    // listing's row via a bad GROUP BY. Two rooms, two ledger entries of
    // different amounts, one offline booking on the second room only —
    // asserts each room shows exactly its own numbers, not the other's,
    // not a combined total, and not zero.
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-listings-scoped@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId: roomA } = await createHotelWithRoom(app, accessToken);
    const { roomId: roomB } = await createHotelWithRoom(app, accessToken);

    await testPrisma.vendorLedgerEntry.create({
      data: {
        vendorId,
        roomId: roomA,
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 1111,
        entryDate: new Date("2026-08-01"),
      },
    });
    await testPrisma.vendorLedgerEntry.create({
      data: {
        vendorId,
        roomId: roomB,
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 2222,
        entryDate: new Date("2026-08-01"),
      },
    });
    // createOfflineBooking auto-creates a linked WALK_IN_BOOKING
    // VendorLedgerEntry (direction=INCOME) for the booking's amountMinor,
    // in addition to the booking row itself — so room B's expected
    // earnings is the manually-created 2222 entry PLUS this 5000, not 2222
    // alone.
    const offlineOnB = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomB,
        checkIn: "2026-12-10",
        checkOut: "2026-12-12",
        amountMinor: 5000,
      });
    expect(offlineOnB.status).toBe(201);

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/listings")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const listingA = res.body.find((l: { id: string }) => l.id === roomA);
    const listingB = res.body.find((l: { id: string }) => l.id === roomB);
    expect(listingA.earningsMinor).toBe(1111);
    expect(listingA.bookingCount).toBe(0);
    expect(listingB.earningsMinor).toBe(2222 + 5000);
    expect(listingB.bookingCount).toBe(1);
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

  it("GET /vendor/listings returns both rooms and vehicles for a BOTH vendor, and GET /vendor/dashboard/summary carries both rate fields", async () => {
    // DEFECT 1 regression: a vendorType=BOTH vendor was silently losing
    // their entire vehicle inventory to an if(isHotel){rooms}else{vehicles}
    // branch — this must run against the real Nest app + Postgres, not a
    // mocked Prisma client, since the defect is specifically that the
    // vehicle-fetching Prisma call was never made at all for a BOTH vendor.
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-both@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "BOTH" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);
    const vehicle = await request(app.getHttpServer())
      .post("/v1/vehicles")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        category: "CNG",
        city: "DHAKA",
        capacity: 3,
        pricePerDayMinor: 200000,
      });
    expect(vehicle.status).toBe(201);
    const vehicleId = vehicle.body.id as string;

    const listings = await request(app.getHttpServer())
      .get("/v1/vendor/listings")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(listings.status).toBe(200);
    const listingIds = listings.body.map((l: { id: string }) => l.id);
    expect(listingIds).toContain(roomId);
    expect(listingIds).toContain(vehicleId);
    expect(listings.body).toHaveLength(2);

    const summary = await request(app.getHttpServer())
      .get("/v1/vendor/dashboard/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body).toHaveProperty("hotelOccupancyRatePct");
    expect(summary.body).toHaveProperty("vehicleUtilizationRatePct");
    // 1 active room + 1 active vehicle, not just one side.
    expect(summary.body.activeListings).toBe(2);
  });

  it("GET /vendor/dashboard/summary returns 400 for a VENDOR-role user whose vendorType is not yet set", async () => {
    // DEFECT 8 regression: nullable vendorType must not silently fall
    // through to a vehicle-shaped empty response.
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-onboarding@example.com",
    );
    // Deliberately does not set vendorType — mirrors a VENDOR-role user
    // mid-onboarding.
    const res = await request(app.getHttpServer())
      .get("/v1/vendor/dashboard/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it("GET /vendor/bookings?status=CONFIRMED filters correctly and does not 500 (real Postgres, not mocked)", async () => {
    // DEFECT 2 regression: binding filter.status as `text` against the
    // BookingStatus enum column raises a real Postgres 42883 error at
    // runtime only — a mocked-Prisma unit test asserting sqlObject.values
    // contains "CONFIRMED" stays green against this bug because it never
    // executes real SQL. This test must run the query for real, and must
    // assert exclusion (a non-matching row is absent), not just presence.
    //
    // A single-booking version of this test (create one CONFIRMED booking,
    // cancel it, filter status=CONFIRMED, assert .not.toContain) cannot
    // distinguish a working filter from a broken one: after the cancel
    // there are zero CONFIRMED bookings for this vendor, so an empty array
    // satisfies `.not.toContain` whether the filter works or the endpoint
    // just returns nothing. Keeping a second booking CONFIRMED and
    // asserting it IS present, in the same response that must exclude the
    // cancelled one, is what actually discriminates — see the DEFECT 2
    // fix report for the break-it-and-watch-it-fail proof.
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-status-filter@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const toCancel = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: futureDateStr(30),
        checkOut: futureDateStr(32),
        amountMinor: 5000,
      });
    expect(toCancel.status).toBe(201);
    const cancelledBookingId = toCancel.body.booking.id as string;

    // Cancel it — must be excluded when filtering status=CONFIRMED.
    await request(app.getHttpServer())
      .delete(`/v1/vendor/bookings/offline/${cancelledBookingId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    // A second booking on different, non-overlapping dates that stays
    // CONFIRMED — must be present in the filtered response.
    const stillConfirmed = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: futureDateStr(60),
        checkOut: futureDateStr(62),
        amountMinor: 5000,
      });
    expect(stillConfirmed.status).toBe(201);
    const confirmedBookingId = stillConfirmed.body.booking.id as string;

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/bookings?status=CONFIRMED")
      .set("Authorization", `Bearer ${accessToken}`);

    // The unfixed code 500s here (operator does not exist: "BookingStatus"
    // = text) — reaching a 200 at all is part of what this test proves.
    expect(res.status).toBe(200);
    const ids = res.body.map((b: { id: string }) => b.id);
    expect(ids).toContain(confirmedBookingId);
    expect(ids).not.toContain(cancelledBookingId);
  });

  it("GET /vendor/bookings?status=abc123 (not a real enum value) returns 400, not a raw 500", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-bad-status@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/vendor/bookings?status=NOT_A_REAL_STATUS")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it("GET /vendor/bookings?from=abc rejects with 400 instead of a raw Postgres 500", async () => {
    // DEFECT 6 regression: an invalid `from` used to reach
    // `${filter.from}::date` in raw SQL and produce a Postgres 22007 error
    // surfaced as an unhandled 500.
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-bad-from@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/vendor/bookings?from=abc")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it("GET /vendor/bookings?from=2026-02-30 (calendar-invalid but ISO8601-shaped) rejects with 400 instead of a raw Postgres 500", async () => {
    // DEFECT 6 regression: the default (loose) @IsISO8601() check accepts
    // "2026-02-30" — isISO8601("2026-02-30") === true — because it only
    // validates the string's shape, not calendar validity. That value then
    // reaches `${filter.from}::date` in raw SQL and Postgres raises 22007
    // (date/time field value out of range), which AllExceptionsFilter maps
    // to a generic 500. { strict: true } must catch this before the DB.
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-calendar-invalid-from@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/vendor/bookings?from=2026-02-30")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it("GET /vendor/bookings?from=... alone (no `to`) filters instead of silently returning everything", async () => {
    // DEFECT 7 regression: previously required both from AND to; supplying
    // only `from` silently dropped the filter and returned all bookings
    // with no indication it was ignored.
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-onesided-range@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const early = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
        amountMinor: 5000,
      });
    expect(early.status).toBe(201);

    const late = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-01",
        checkOut: "2026-11-03",
        amountMinor: 5000,
      });
    expect(late.status).toBe(201);

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/bookings?from=2026-10-15")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((b: { id: string }) => b.id);
    expect(ids).toContain(late.body.booking.id);
    expect(ids).not.toContain(early.body.booking.id);
  });

  it("GET /vendor/earnings?from=...&to=... uses Dhaka calendar days, not UTC, at the 18:00Z-24:00Z boundary", async () => {
    // DEFECT 4 regression: new Date("2026-07-30") parses as
    // 2026-07-30T00:00:00Z, six hours after the actual start of the Dhaka
    // calendar day 2026-07-30 (which begins 2026-07-29T18:00:00Z). A ledger
    // entry created just after that Dhaka-day boundary but before UTC
    // midnight must be included when filtering from=2026-07-30 — a
    // naive-UTC implementation would exclude it.
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-earnings-utc@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    // 2026-07-29T19:00:00Z is 2026-07-30T01:00:00 in Dhaka (UTC+6) — inside
    // the Dhaka day 2026-07-30, but a UTC-naive `gte: new Date("2026-07-30")`
    // (2026-07-30T00:00:00Z) would exclude it since 19:00Z on the 29th is
    // before that instant.
    await testPrisma.vendorLedgerEntry.create({
      data: {
        vendorId,
        roomId,
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 7700,
        entryDate: new Date("2026-07-29T19:00:00Z"),
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/earnings?from=2026-07-30&to=2026-07-31")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.offline).toBe(7700);
  });

  it("GET /vendor/earnings?from=... alone (no `to`) filters from that date forward instead of silently falling back to the current-month period", async () => {
    // DEFECT 7 regression: the unfixed code only special-cased
    // `query.from && query.to` together — a lone `from` fell through to the
    // `else` branch and silently used the current-month window, ignoring
    // the caller's filter with no error. An entry outside the current
    // month but at/after the supplied `from` must be included; an entry
    // before `from` must be excluded — neither of which the current-month
    // fallback would reliably get right by coincidence.
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-earnings-onesided@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { vendorType: "HOTEL" },
    });
    const { roomId } = await createHotelWithRoom(app, accessToken);

    // Before the filter's `from` — must be excluded.
    await testPrisma.vendorLedgerEntry.create({
      data: {
        vendorId,
        roomId,
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 1234,
        entryDate: new Date("2020-01-01"),
      },
    });
    // On/after the filter's `from`, far in the future — must be included.
    // A current-month fallback would exclude this, since it is many months
    // away from "now".
    await testPrisma.vendorLedgerEntry.create({
      data: {
        vendorId,
        roomId,
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 5678,
        entryDate: new Date("2030-01-01"),
      },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/earnings?from=2025-01-01")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.offline).toBe(5678);
  });

  it("GET /vendor/earnings?from=2026-02-30 (calendar-invalid but ISO8601-shaped) rejects with 400 instead of a raw Postgres 500", async () => {
    // DEFECT 6 regression, earnings-endpoint half: same underlying issue as
    // the /vendor/bookings case above — EarningsQueryDto's from/to used the
    // default (loose) @IsISO8601(), which accepts "2026-02-30" as
    // well-formed. That value reaches startOfDhakaDay(new Date(query.from))
    // -> Date parsing overflow in JS, or (for other endpoints)
    // `${...}::date` in raw SQL -> Postgres 22007. { strict: true } rejects
    // it at the DTO boundary instead.
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor-calendar-invalid-earnings@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/vendor/earnings?from=2026-02-30")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  // DEFECT 5 (period=week rolling-UTC-window bug) is deliberately NOT
  // covered here: this endpoint computes its window from `new Date()`
  // ("now") with no way to inject a fixed instant over HTTP, and per the
  // review skill's own guidance a fixture has to land in the
  // 18:00Z-24:00Z window to discriminate UTC-vs-Dhaka bugs at all — a
  // fixture built from whatever "now" happens to be when the suite runs
  // only lands there by accident (it does not, as of this writing). A
  // real e2e test built on relative "now" offsets was tried here first,
  // observed to pass identically against the unfixed rolling-168h-UTC
  // code, and removed as decoration rather than left in. The Dhaka-week
  // boundary is instead covered by a unit test
  // (vendor-dashboard.service.spec.ts, "getEarnings — period=week") that
  // uses jest.useFakeTimers to pin "now" to the exact
  // 2026-08-02T19:00:00Z fixture from the skill's own worked example.

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
