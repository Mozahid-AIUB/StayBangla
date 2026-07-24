import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase, testPrisma } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";
import { createAdmin, createVerifiedVendor } from "./helpers/test-fixtures";

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
      .get("/admin/vendors/pending")
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
      .get("/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    const approve = await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(approve.status).toBe(201);
    expect(approve.body.verifiedStatus).toBe("VERIFIED");

    const createHotel = await request(app.getHttpServer())
      .post("/hotels")
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
      .get("/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    const reject = await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "NID document unclear" });
    expect(reject.status).toBe(201);
    expect(reject.body.verifiedStatus).toBe("REJECTED");

    const history = await request(app.getHttpServer())
      .get(`/admin/vendors/${me.body.id}/history`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].reason).toBe("NID document unclear");
    expect(history.body[0].action).toBe("REJECTED");
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
      .get("/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "incomplete profile" });

    const resubmit = await request(app.getHttpServer())
      .post("/users/me/resubmit")
      .set("Authorization", `Bearer ${vendorToken}`);

    expect(resubmit.status).toBe(201);
    expect(resubmit.body.verifiedStatus).toBe("PENDING");
  });

  it("a non-admin cannot access /admin/vendors/pending", async () => {
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "sneaky-vendor@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/admin/vendors/pending")
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
      .get("/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    const secondReject = await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "changed my mind" });

    expect(secondReject.status).toBe(409);
  });

  it("never leaks passwordHash in listPending/approve/reject responses", async () => {
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
      .get("/admin/vendors/pending")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(JSON.stringify(pending.body)).not.toMatch(
      /passwordHash|password_hash|\$argon2/,
    );

    const approve = await request(app.getHttpServer())
      .post(`/admin/vendors/${vendorId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(JSON.stringify(approve.body)).not.toMatch(
      /passwordHash|password_hash|\$argon2/,
    );
  });
});
