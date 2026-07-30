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

describe("Hotel/Vehicle detail endpoints (e2e)", () => {
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

  describe("GET /hotels/:id", () => {
    it("returns the hotel with its rooms and photos, with no auth required", async () => {
      const { accessToken: vendorToken } = await createVerifiedVendor(
        app,
        "detail-vendor@example.com",
      );
      const { hotelId, roomId } = await createHotelWithRoom(app, vendorToken);

      const res = await request(app.getHttpServer()).get(
        `/v1/hotels/${hotelId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(hotelId);
      expect(res.body.rooms).toHaveLength(1);
      expect(res.body.rooms[0].id).toBe(roomId);
      expect(res.body.photos).toEqual([]);
    });

    it("returns 404 for a hotel id that does not exist", async () => {
      const res = await request(app.getHttpServer()).get(
        "/v1/hotels/00000000-0000-0000-0000-000000000000",
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /vehicles/:id", () => {
    it("returns the vehicle, with no auth required", async () => {
      const { accessToken: vendorToken } = await createVerifiedVendor(
        app,
        "detail-vendor2@example.com",
      );
      const create = await request(app.getHttpServer())
        .post("/v1/vehicles")
        .set("Authorization", `Bearer ${vendorToken}`)
        .send({
          category: "CNG",
          city: "DHAKA",
          capacity: 3,
          pricePerDayMinor: 200000,
        });

      const res = await request(app.getHttpServer()).get(
        `/v1/vehicles/${create.body.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(create.body.id);
      expect(res.body.category).toBe("CNG");
    });

    it("returns 404 for a vehicle id that does not exist", async () => {
      const res = await request(app.getHttpServer()).get(
        "/v1/vehicles/00000000-0000-0000-0000-000000000000",
      );
      expect(res.status).toBe(404);
    });
  });
});
