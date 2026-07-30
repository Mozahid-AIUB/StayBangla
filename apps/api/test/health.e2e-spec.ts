import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { createAdmin, createVerifiedVendor } from "./helpers/test-fixtures";

describe("Health (e2e)", () => {
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

  it("GET /health returns 200 with status ok", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /health/db returns 200 when Postgres reachable", async () => {
    const res = await request(app.getHttpServer()).get("/health/db");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ db: "ok" });
  });

  it("GET /v1/health does NOT exist — health is version-neutral, not versioned", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health");
    expect(res.status).toBe(404);
  });

  it("GET /health/detailed requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/health/detailed");
    expect(res.status).toBe(401);
  });

  it("GET /health/detailed rejects a non-admin caller", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "health-vendor@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/health/detailed")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /health/detailed returns 200 with all three services ok for an admin caller", async () => {
    const { accessToken } = await createAdmin(app, "health-admin@example.com");
    const res = await request(app.getHttpServer())
      .get("/health/detailed")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ db: "ok", redis: "ok", minio: "ok" });
  });
});
