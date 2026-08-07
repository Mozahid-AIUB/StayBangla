import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
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
