import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { createVerifiedVendor, createAdmin } from "./helpers/test-fixtures";

describe("Admin commission (e2e)", () => {
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

  it("admin can update a vendor's commissionRatePercent", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "commission-admin@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "commission-vendor@example.com",
    );

    const res = await request(app.getHttpServer())
      .patch(`/admin/vendors/${vendorId}/commission`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionRatePercent: 20 });

    expect(res.status).toBe(200);
    expect(res.body.commissionRatePercent).toBe(20);
  });

  it("a non-admin cannot update commission", async () => {
    const { accessToken: vendorToken, vendorId } = await createVerifiedVendor(
      app,
      "commission-vendor2@example.com",
    );

    const res = await request(app.getHttpServer())
      .patch(`/admin/vendors/${vendorId}/commission`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ commissionRatePercent: 20 });

    expect(res.status).toBe(403);
  });

  it("rejects a commissionRatePercent outside 0-100", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "commission-admin2@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "commission-vendor3@example.com",
    );

    const res = await request(app.getHttpServer())
      .patch(`/admin/vendors/${vendorId}/commission`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionRatePercent: 150 });

    expect(res.status).toBe(400);
  });
});
