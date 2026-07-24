import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";
import {
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Booking ownership (e2e)", () => {
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

  it("vendor B cannot checkout vendor A's booking", async () => {
    const { accessToken: vendorAToken } = await createVerifiedVendor(
      app,
      "ownerA@example.com",
    );
    const { accessToken: vendorBToken } = await createVerifiedVendor(
      app,
      "ownerB@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorAToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "ownership-traveler@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2027-01-01",
        checkOut: "2027-01-03",
      });
    await request(app.getHttpServer()).post(
      `/bookings/${created.body.id}/confirm-payment`,
    );

    const res = await request(app.getHttpServer())
      .post(`/bookings/${created.body.id}/checkout`)
      .set("Authorization", `Bearer ${vendorBToken}`);

    expect(res.status).toBe(409);
  });

  it("traveler B cannot cancel traveler A's booking", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "cancel-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerAToken } = await createTraveler(
      app,
      "cancel-a@example.com",
    );
    const { accessToken: travelerBToken } = await createTraveler(
      app,
      "cancel-b@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerAToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2027-01-10",
        checkOut: "2027-01-12",
      });

    const res = await request(app.getHttpServer())
      .post(`/bookings/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${travelerBToken}`);

    expect(res.status).toBe(409);
  });

  it("an unverified vendor cannot create a hotel", async () => {
    const { accessToken } = await registerAndLogin(
      app,
      "unverified@example.com",
    );
    const res = await request(app.getHttpServer())
      .post("/hotels")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Sneaky Hotel", city: "Dhaka", address: "1 Rd" });
    expect(res.status).toBe(403);
  });
});
