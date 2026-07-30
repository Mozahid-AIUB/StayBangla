import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Booking concurrency (e2e)", () => {
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

  // Timeout raised from Jest's 5000ms default: provisioning 5 real
  // HTTP-authenticated travelers (each a Prisma insert + JWT + refresh-token
  // persist) plus 5 concurrent booking requests takes longer than that in
  // this environment; the race-condition assertion itself is not slow, the
  // setup fan-out is.
  const CONCURRENT_SETUP_TIMEOUT_MS = 15000;

  it(
    "allows exactly one of 5 concurrent bookings for the same room and overlapping dates to succeed",
    async () => {
      const { accessToken: vendorToken } = await createVerifiedVendor(
        app,
        "concurrency-vendor@example.com",
      );
      const { roomId } = await createHotelWithRoom(app, vendorToken);

      const travelers = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          createTraveler(app, `concurrency-traveler-${i}@example.com`),
        ),
      );

      const results = await Promise.all(
        travelers.map(({ accessToken }) =>
          request(app.getHttpServer())
            .post("/v1/bookings")
            .set("Authorization", `Bearer ${accessToken}`)
            .send({
              bookableType: "ROOM",
              bookableId: roomId,
              checkIn: "2026-10-01",
              checkOut: "2026-10-03",
            }),
        ),
      );

      const succeeded = results.filter((r) => r.status === 201);
      const conflicted = results.filter((r) => r.status === 409);

      expect(succeeded).toHaveLength(1);
      expect(conflicted).toHaveLength(4);
    },
    CONCURRENT_SETUP_TIMEOUT_MS,
  );

  it("allows back-to-back bookings on the same room (checkout day = next checkin day)", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "backtoback-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: traveler1 } = await createTraveler(
      app,
      "backtoback-t1@example.com",
    );
    const { accessToken: traveler2 } = await createTraveler(
      app,
      "backtoback-t2@example.com",
    );

    const first = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${traveler1}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-01",
        checkOut: "2026-11-03",
      });

    const second = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${traveler2}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-03",
        checkOut: "2026-11-05",
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});
