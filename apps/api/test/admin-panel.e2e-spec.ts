import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createAdmin,
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Admin Panel (e2e)", () => {
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

  it("POST /admin/vendors/:id/suspend requires ADMIN/SUPER_ADMIN", async () => {
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor1@example.com",
    );
    const res = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ reason: "test" });
    expect(res.status).toBe(403);
  });

  it("suspending a vendor blocks their login with 403, not 401", async () => {
    const { adminId: _adminId, accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin1@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor2@example.com",
    );

    const suspend = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "policy violation" });
    expect(suspend.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({
        identifier: "admin-e2e-vendor2@example.com",
        password: "supersecret1",
      });
    expect(login.status).toBe(403);
  });

  it("a suspended vendor's room disappears from GET /rooms/available", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin2@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor3@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const available = await request(app.getHttpServer()).get(
      "/v1/rooms/available?checkIn=2026-10-01&checkOut=2026-10-03",
    );
    expect(
      available.body.find((r: { id: string }) => r.id === roomId),
    ).toBeUndefined();
  });

  it("a traveler cannot book a suspended vendor's room", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin3@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor4@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "admin-e2e-traveler1@example.com",
    );

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const booking = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-10-01",
        checkOut: "2026-10-03",
      });
    expect(booking.status).toBe(403);
  });

  it("a suspended vendor cannot create an offline booking with their still-valid access token", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin5@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor6@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const offlineBooking = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-10-01",
        checkOut: "2026-10-03",
        amountMinor: 500000,
      });
    expect(offlineBooking.status).toBe(403);
  });

  it("a suspended vendor cannot create a date block with their still-valid access token", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin6@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor7@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const block = await request(app.getHttpServer())
      .post("/v1/vendor/blocks")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        startDate: "2026-10-01",
        endDate: "2026-10-03",
      });
    expect(block.status).toBe(403);
  });

  it("a suspended vendor cannot create a new room with their still-valid access token", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin7@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor8@example.com",
    );
    const { hotelId } = await createHotelWithRoom(app, vendorToken);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const newRoom = await request(app.getHttpServer())
      .post(`/v1/hotels/${hotelId}/rooms`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        roomType: "DOUBLE",
        pricePerNightMinor: 500000,
        capacity: 2,
        hasAC: true,
        bedType: "DOUBLE",
      });
    expect(newRoom.status).toBe(403);
  });

  it("unsuspending a vendor restores login and search visibility", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin4@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor5@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "temporary review" });
    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/unsuspend`)
      .set("Authorization", `Bearer ${adminToken}`);

    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({
        identifier: "admin-e2e-vendor5@example.com",
        password: "supersecret1",
      });
    expect(login.status).toBe(201);

    const available = await request(app.getHttpServer()).get(
      "/v1/rooms/available?checkIn=2026-10-05&checkOut=2026-10-07",
    );
    expect(
      available.body.find((r: { id: string }) => r.id === roomId),
    ).toBeDefined();
  });

  it("GET /admin/audit-log?vendorId= returns that vendor's suspend/unsuspend history", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin5@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor6@example.com",
    );

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "reason A" });
    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/unsuspend`)
      .set("Authorization", `Bearer ${adminToken}`);

    const auditLog = await request(app.getHttpServer())
      .get(`/v1/admin/audit-log?vendorId=${vendorId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(auditLog.status).toBe(200);
    expect(auditLog.body.items).toHaveLength(2);
    expect(auditLog.body.items[0].action).toBe("VENDOR_UNSUSPENDED");
    expect(auditLog.body.items[1].action).toBe("VENDOR_SUSPENDED");
  });

  it("PATCH /admin/vendors/:id/commission writes a COMMISSION_RATE_CHANGED audit row with old/new rates", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin6@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor7@example.com",
    );

    await request(app.getHttpServer())
      .patch(`/v1/admin/vendors/${vendorId}/commission`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionRatePercent: 20 });

    const auditLog = await request(app.getHttpServer())
      .get(`/v1/admin/audit-log?vendorId=${vendorId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(auditLog.body.items[0]).toMatchObject({
      action: "COMMISSION_RATE_CHANGED",
      metadata: { oldRatePercent: 10, newRatePercent: 20 },
    });
  });

  it("PATCH /admin/vendors/:id/commission returns 404 for a nonexistent vendor", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin7@example.com",
    );

    const res = await request(app.getHttpServer())
      .patch(
        "/v1/admin/vendors/00000000-0000-0000-0000-000000000000/commission",
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionRatePercent: 20 });
    expect(res.status).toBe(404);
  });

  it("GET /admin/vendors?status=SUSPENDED returns only suspended vendors", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin8@example.com",
    );
    const { vendorId: suspendedId } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor8@example.com",
    );
    await createVerifiedVendor(app, "admin-e2e-vendor9@example.com");

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${suspendedId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "test" });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/vendors?status=SUSPENDED")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(suspendedId);
  });

  it("GET /admin/overview returns headline counts", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin9@example.com",
    );
    await createVerifiedVendor(app, "admin-e2e-vendor10@example.com");

    const res = await request(app.getHttpServer())
      .get("/v1/admin/overview")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalVendors).toBeGreaterThanOrEqual(1);
    expect(res.body).toHaveProperty("monthlyRevenue");
  });
});
