import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";

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
    await app.close();
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
});
