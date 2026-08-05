import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { PasswordService } from "src/auth/password.service";
import { cleanDatabase, testPrisma } from "./helpers/test-db";
import {
  createAdmin,
  createTraveler,
  createVerifiedVendor,
  createHotelWithRoom,
} from "./helpers/test-fixtures";

describe("Admin Traveler Control (e2e)", () => {
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

  it("suspending a traveler blocks their login with 403", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "traveler-e2e-admin1@example.com",
    );
    const { travelerId } = await createTraveler(
      app,
      "traveler-e2e-traveler1@example.com",
    );
    // createTraveler bypasses HTTP registration (no HTTP-facing OTP-verify
    // flow exists yet to capture in e2e), so it never sets a passwordHash.
    // Logging in via password requires one, so it's set directly here —
    // same "test-only shortcut" pattern the fixtures file already uses for
    // verifiedStatus/roles — to exercise the suspension check on login
    // rather than fail earlier on "no password set".
    const passwordService = app.get(PasswordService);
    await testPrisma.user.update({
      where: { id: travelerId },
      data: { passwordHash: await passwordService.hash("supersecret1") },
    });

    const suspend = await request(app.getHttpServer())
      .post(`/v1/admin/travelers/${travelerId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "abusive messages to vendors" });
    expect(suspend.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({
        identifier: "traveler-e2e-traveler1@example.com",
        password: "supersecret1",
      });
    expect(login.status).toBe(403);
  });

  it("a suspended traveler cannot create a new booking", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "traveler-e2e-admin2@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "traveler-e2e-vendor1@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { travelerId, accessToken: travelerToken } = await createTraveler(
      app,
      "traveler-e2e-traveler2@example.com",
    );

    await request(app.getHttpServer())
      .post(`/v1/admin/travelers/${travelerId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const booking = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
      });
    expect(booking.status).toBe(403);
  });

  it("GET /admin/travelers?status=SUSPENDED returns only suspended travelers", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "traveler-e2e-admin3@example.com",
    );
    const { travelerId: suspendedId } = await createTraveler(
      app,
      "traveler-e2e-traveler3@example.com",
    );
    await createTraveler(app, "traveler-e2e-traveler4@example.com");

    await request(app.getHttpServer())
      .post(`/v1/admin/travelers/${suspendedId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "test" });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/travelers?status=SUSPENDED")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(suspendedId);
  });

  it("suspending and unsuspending a traveler writes TRAVELER_SUSPENDED/TRAVELER_UNSUSPENDED audit rows (not VENDOR_*)", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "traveler-e2e-admin4@example.com",
    );
    const { travelerId } = await createTraveler(
      app,
      "traveler-e2e-traveler5@example.com",
    );

    await request(app.getHttpServer())
      .post(`/v1/admin/travelers/${travelerId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "test suspend" });

    await request(app.getHttpServer())
      .post(`/v1/admin/travelers/${travelerId}/unsuspend`)
      .set("Authorization", `Bearer ${adminToken}`);

    const logs = await testPrisma.adminAuditLog.findMany({
      where: { targetId: travelerId },
      orderBy: { createdAt: "asc" },
    });

    expect(logs.map((l) => l.action)).toEqual([
      "TRAVELER_SUSPENDED",
      "TRAVELER_UNSUSPENDED",
    ]);
  });
});
