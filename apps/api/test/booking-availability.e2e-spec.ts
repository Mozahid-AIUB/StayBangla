import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase, testPrisma } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
  createAdmin,
} from "./helpers/test-fixtures";

describe("Booking availability search (e2e)", () => {
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

  it("GET /rooms/available with valid dates returns available rooms without auth", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "availability-vendor@example.com",
    );
    await createHotelWithRoom(app, vendorToken);

    const res = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ checkIn: "2027-03-01", checkOut: "2027-03-03", city: "DHAKA" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /rooms/available carries the hotel's name and city on each room, and a city filter excludes rooms in other districts", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "availability-vendor-2@example.com",
    );
    const { roomId: dhakaRoomId } = await createHotelWithRoom(
      app,
      vendorToken,
      { name: "Lakeshore Dhaka", city: "DHAKA" },
    );
    const { roomId: coxsRoomId } = await createHotelWithRoom(app, vendorToken, {
      name: "Sea Pearl Coxs",
      city: "COXS_BAZAR",
    });

    const res = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ checkIn: "2027-03-01", checkOut: "2027-03-03", city: "DHAKA" });

    expect(res.status).toBe(200);
    const rooms = res.body as Array<{
      id: string;
      hotelName: string;
      hotelCity: string;
    }>;

    const dhakaRoom = rooms.find((r) => r.id === dhakaRoomId);
    expect(dhakaRoom).toBeDefined();
    expect(dhakaRoom!.hotelName).toBe("Lakeshore Dhaka");
    expect(dhakaRoom!.hotelCity).toBe("DHAKA");

    // Discriminates the city filter: the Coxs Bazar room must not leak into
    // a DHAKA-filtered search.
    expect(rooms.some((r) => r.id === coxsRoomId)).toBe(false);
  });

  it("GET /rooms/available rejects a missing checkIn with a clean 400, not a 500", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ checkOut: "2027-03-03" });

    expect(res.status).toBe(400);
  });

  it("GET /rooms/available rejects a malformed checkIn with a clean 400, not a 500", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ checkIn: "not-a-date", checkOut: "2027-03-03" });

    expect(res.status).toBe(400);
  });

  it("GET /vehicles/available rejects a missing startDate with a clean 400, not a 500", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/vehicles/available")
      .query({ endDate: "2027-03-03" });

    expect(res.status).toBe(400);
  });

  it("GET /vehicles/available rejects a malformed endDate with a clean 400, not a 500", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/vehicles/available")
      .query({ startDate: "2027-03-01", endDate: "not-a-date" });

    expect(res.status).toBe(400);
  });

  it("GET /vehicles/available with a city filter returns a vehicle in that district", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "vehicle-vendor@example.com",
    );

    const createRes = await request(app.getHttpServer())
      .post("/v1/vehicles")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        category: "CNG",
        city: "COXS_BAZAR",
        capacity: 3,
        pricePerDayMinor: 150000,
      });
    expect(createRes.status).toBe(201);

    const res = await request(app.getHttpServer())
      .get("/v1/vehicles/available")
      .query({
        startDate: "2027-03-01",
        endDate: "2027-03-03",
        city: "COXS_BAZAR",
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(
      res.body.some(
        (vehicle: { id: string }) => vehicle.id === createRes.body.id,
      ),
    ).toBe(true);
  });
});

describe("Availability search without dates (e2e)", () => {
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

  // The landing page's district cards invite browsing, and someone deciding
  // where to go has not chosen when yet. Dates used to be required, so those
  // cards had nowhere to lead.
  it("GET /rooms/available returns the district's rooms when no dates are given", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "nodates-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken, {
      name: "Sea Pearl",
      city: "COXS_BAZAR",
    });

    const res = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ city: "COXS_BAZAR" });

    expect(res.status).toBe(200);
    expect((res.body as Array<{ id: string }>).map((r) => r.id)).toContain(
      roomId,
    );
  });

  it("GET /rooms/available accepts no parameters at all", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "noparams-vendor@example.com",
    );
    await createHotelWithRoom(app, accessToken);

    const res = await request(app.getHttpServer()).get("/v1/rooms/available");

    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeGreaterThan(0);
  });

  it("GET /vehicles/available returns vehicles when no dates are given", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "nodates-vehicle-vendor@example.com",
    );
    await request(app.getHttpServer())
      .post("/v1/vehicles")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        category: "JEEP",
        city: "DHAKA",
        model: "Toyota Land Cruiser",
        capacity: 6,
        pricePerDayMinor: 400000,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get("/v1/vehicles/available")
      .query({ city: "DHAKA" });

    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeGreaterThan(0);
  });

  // Half a range has no meaning. Ignoring the date that was sent would answer a
  // different question than the one asked, and the caller would believe the
  // results were filtered.
  it("GET /rooms/available still rejects one date without the other", async () => {
    const onlyCheckIn = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ checkIn: "2027-03-01" });
    expect(onlyCheckIn.status).toBe(400);

    const onlyCheckOut = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ checkOut: "2027-03-03" });
    expect(onlyCheckOut.status).toBe(400);
  });

  it("GET /rooms/available still rejects a reversed range", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ checkIn: "2027-03-03", checkOut: "2027-03-01" });

    expect(res.status).toBe(400);
  });

  // Without dates there is no overlap clause at all, which is exactly where a
  // rewrite could drop the suspended-owner exclusion along with it.
  it("GET /rooms/available hides a suspended vendor's rooms with no dates", async () => {
    const { accessToken, vendorId } = await createVerifiedVendor(
      app,
      "suspended-nodates@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken, {
      name: "Suspended Inn",
      city: "SYLHET",
    });

    const before = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ city: "SYLHET" });
    expect((before.body as Array<{ id: string }>).map((r) => r.id)).toContain(
      roomId,
    );

    const { accessToken: adminToken } = await createAdmin(
      app,
      "suspender@example.com",
    );
    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "test" })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get("/v1/rooms/available")
      .query({ city: "SYLHET" });
    expect(
      (after.body as Array<{ id: string }>).map((r) => r.id),
    ).not.toContain(roomId);
  });
});

// The cover image is chosen inside the SQL — COALESCE over two LATERAL
// subqueries. A unit test with a mocked $queryRaw can only assert the text of
// that query, which proves nothing about what Postgres does with it. These
// insert real photographs and read back what the endpoint returns.
describe("Search result cover images (e2e)", () => {
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

  async function findRoom(roomId: string) {
    const res = await request(app.getHttpServer()).get("/v1/rooms/available");
    expect(res.status).toBe(200);
    return (
      res.body as Array<{ id: string; coverObjectKey: string | null }>
    ).find((r) => r.id === roomId);
  }

  it("prefers the room's own photograph over its hotel's", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "cover-room@example.com",
    );
    const { hotelId, roomId } = await createHotelWithRoom(app, accessToken);

    await testPrisma.hotelPhoto.create({
      data: { hotelId, objectKey: "hotels/h/exterior.webp", isPrimary: true },
    });
    await testPrisma.roomPhoto.create({
      data: { roomId, objectKey: "rooms/r/bed.webp", isPrimary: true },
    });

    expect((await findRoom(roomId))?.coverObjectKey).toBe("rooms/r/bed.webp");
  });

  it("falls back to the hotel's photograph when the room has none", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "cover-hotel@example.com",
    );
    const { hotelId, roomId } = await createHotelWithRoom(app, accessToken);

    await testPrisma.hotelPhoto.create({
      data: { hotelId, objectKey: "hotels/h/exterior.webp", isPrimary: true },
    });

    expect((await findRoom(roomId))?.coverObjectKey).toBe(
      "hotels/h/exterior.webp",
    );
  });

  // Null is a finished state, not a defect: the card falls back to its painted
  // tone, the same way a district card without a photograph does.
  it("is null when neither the room nor the hotel has one", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "cover-none@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken);

    expect((await findRoom(roomId))?.coverObjectKey).toBeNull();
  });

  it("picks the primary photograph rather than whichever was inserted first", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "cover-primary@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken);

    await testPrisma.roomPhoto.create({
      data: { roomId, objectKey: "rooms/r/old.webp", isPrimary: false },
    });
    await testPrisma.roomPhoto.create({
      data: { roomId, objectKey: "rooms/r/chosen.webp", isPrimary: true },
    });

    expect((await findRoom(roomId))?.coverObjectKey).toBe(
      "rooms/r/chosen.webp",
    );
  });

  // A join to a one-to-many table multiplies rows; LATERAL with LIMIT 1 does
  // not. Three photographs must not become three copies of the room.
  it("returns one row per room however many photographs it has", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "cover-dupes@example.com",
    );
    const { hotelId, roomId } = await createHotelWithRoom(app, accessToken);

    for (const key of ["a.webp", "b.webp", "c.webp"]) {
      await testPrisma.roomPhoto.create({
        data: { roomId, objectKey: `rooms/r/${key}`, isPrimary: false },
      });
      await testPrisma.hotelPhoto.create({
        data: { hotelId, objectKey: `hotels/h/${key}`, isPrimary: false },
      });
    }

    const res = await request(app.getHttpServer()).get("/v1/rooms/available");
    const matching = (res.body as Array<{ id: string }>).filter(
      (r) => r.id === roomId,
    );
    expect(matching).toHaveLength(1);
  });
});

describe("Vehicle categories (e2e)", () => {
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

  // CAR was missing from the enum. A hired car with a driver is the ordinary
  // way to travel between cities here — the most common thing a traveller
  // asks for, and there was no way to list one.
  //
  // This exercises the whole chain rather than the DTO alone: class-validator
  // has to accept it, and Postgres has to have the value in the type. The
  // migration is `ALTER TYPE ... ADD VALUE`, so a client generated before it
  // ran would pass validation and then fail at the insert.
  it("accepts a CAR, and it comes back from the search", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "car-vendor@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/v1/vehicles")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        category: "CAR",
        city: "DHAKA",
        model: "Toyota Axio",
        capacity: 4,
        pricePerDayMinor: 350000,
      });

    expect(created.status).toBe(201);
    expect(created.body.category).toBe("CAR");

    const res = await request(app.getHttpServer())
      .get("/v1/vehicles/available")
      .query({ city: "DHAKA" });

    const found = (res.body as Array<{ id: string; category: string }>).find(
      (v) => v.id === created.body.id,
    );
    expect(found?.category).toBe("CAR");
  });

  it("still refuses a category that is not in the enum", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "bad-category-vendor@example.com",
    );

    const res = await request(app.getHttpServer())
      .post("/v1/vehicles")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        category: "HELICOPTER",
        city: "DHAKA",
        capacity: 4,
        pricePerDayMinor: 350000,
      });

    expect(res.status).toBe(400);
  });
});
