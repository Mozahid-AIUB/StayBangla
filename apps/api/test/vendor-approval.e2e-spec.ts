import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase, testPrisma } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";
import {
  createAdmin,
  createVerifiedVendor,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Vendor approval (e2e)", () => {
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

  it("a newly registered vendor appears in the admin's pending list", async () => {
    const { adminId: _adminId, accessToken: adminToken } = await createAdmin(
      app,
      "admin1@example.com",
    );
    await registerAndLogin(app, "pending-vendor@example.com");

    const res = await request(app.getHttpServer())
      .get("/v1/admin/vendors?status=PENDING")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(
      res.body.some(
        (v: { email: string }) => v.email === "pending-vendor@example.com",
      ),
    ).toBe(true);
  });

  it("admin approves a pending vendor, who can then create a hotel", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin2@example.com",
    );
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "approve-vendor@example.com",
    );
    const me = await request(app.getHttpServer())
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    const approve = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${me.body.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(approve.status).toBe(201);
    expect(approve.body.verifiedStatus).toBe("VERIFIED");

    const createHotel = await request(app.getHttpServer())
      .post("/v1/hotels")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        name: "Approved Hotel",
        city: "COXS_BAZAR",
        address: "Beach Road",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      });
    expect(createHotel.status).toBe(201);
  });

  it("admin rejects a pending vendor with a reason, recorded in history", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin3@example.com",
    );
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "reject-vendor@example.com",
    );
    const me = await request(app.getHttpServer())
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    const reject = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "NID document unclear" });
    expect(reject.status).toBe(201);
    expect(reject.body.verifiedStatus).toBe("REJECTED");

    const history = await request(app.getHttpServer())
      .get(`/v1/admin/audit-log?vendorId=${me.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0].reason).toBe("NID document unclear");
    expect(history.body.items[0].action).toBe("VENDOR_REJECTED");
  });

  it("a rejected vendor can resubmit and becomes PENDING again", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin4@example.com",
    );
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "resubmit-vendor@example.com",
    );
    const me = await request(app.getHttpServer())
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "incomplete profile" });

    const resubmit = await request(app.getHttpServer())
      .post("/v1/users/me/resubmit")
      .set("Authorization", `Bearer ${vendorToken}`);

    expect(resubmit.status).toBe(201);
    expect(resubmit.body.verifiedStatus).toBe("PENDING");
  });

  it("a non-admin cannot access /admin/vendors?status=PENDING", async () => {
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "sneaky-vendor@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/admin/vendors?status=PENDING")
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(res.status).toBe(403);
  });

  it("rejecting an already-VERIFIED vendor returns 409 (guarded transition)", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin5@example.com",
    );
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "double-vendor@example.com",
    );
    const me = await request(app.getHttpServer())
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${me.body.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    const secondReject = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "changed my mind" });

    expect(secondReject.status).toBe(409);
  });

  it("never leaks passwordHash in vendor list/approve/reject responses", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "leak-check-admin@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "leak-check-vendor@example.com",
    );
    // Force back to PENDING so approve() has something to act on — reuse the
    // existing resubmit-after-reject pattern already proven in this file, or
    // directly flip via testPrisma if this file has that shortcut available.
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { verifiedStatus: "PENDING" },
    });

    const pending = await request(app.getHttpServer())
      .get("/v1/admin/vendors?status=PENDING")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(JSON.stringify(pending.body)).not.toMatch(
      /passwordHash|password_hash|\$argon2/,
    );

    const approve = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(JSON.stringify(approve.body)).not.toMatch(
      /passwordHash|password_hash|\$argon2/,
    );

    const reject = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "re-checking for the leak test" });
    expect(JSON.stringify(reject.body)).not.toMatch(
      /passwordHash|password_hash|\$argon2/,
    );
  });

  // AUTH-5: POST /users/me/resubmit carried JwtAuthGuard + RolesGuard but no
  // @Roles(...), and RolesGuard returns true when the metadata is absent —
  // so the guard was decoration, not enforcement. Any TRAVELER could call it
  // and inject a bogus row into the admin approval queue. Boots the real
  // AppModule with NO overrideGuard — a controller spec that stubs
  // canActivate() would stay green even with @Roles deleted, so it isn't
  // real coverage of this gap (see staybangla-review skill, class 3).
  it("a TRAVELER cannot call POST /users/me/resubmit (403, not silently accepted)", async () => {
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "resubmit-traveler@example.com",
    );

    const resubmit = await request(app.getHttpServer())
      .post("/v1/users/me/resubmit")
      .set("Authorization", `Bearer ${travelerToken}`);

    expect(resubmit.status).toBe(403);
  });

  // The audit listed resubmit among the write paths reachable by a suspended
  // user, but it was the one path the SuspensionGuard rollout missed — it
  // received @Roles at the same time, which is likely why the omission went
  // unnoticed. Without the guard, a vendor suspended for forged documents
  // could flip verifiedStatus REJECTED -> PENDING and re-enter the admin
  // approval queue, with nothing in that queue's row showing the suspension.
  //
  // Reuses the token issued BEFORE the suspension: that is what proves the
  // guard re-reads the DB rather than trusting the JWT claim, which is the
  // whole reason it exists (JwtAccessStrategy.validate never re-reads).
  it("a suspended vendor cannot call POST /users/me/resubmit with a still-valid pre-suspension token", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "resubmit-suspend-admin@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "resubmit-suspend-vendor@example.com",
    );
    await testPrisma.user.update({
      where: { id: vendorId },
      data: { verifiedStatus: "REJECTED" },
    });

    const suspend = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "forged trade licence" });
    expect(suspend.status).toBe(201);

    const resubmit = await request(app.getHttpServer())
      .post("/v1/users/me/resubmit")
      .set("Authorization", `Bearer ${vendorToken}`);

    expect(resubmit.status).toBe(403);

    // Distinguishes "guard blocked it" from "the call went through but
    // no-opped": the vendor must still be REJECTED, not back in the queue.
    const after = await testPrisma.user.findUniqueOrThrow({
      where: { id: vendorId },
    });
    expect(after.verifiedStatus).toBe("REJECTED");
  });
});
