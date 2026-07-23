import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";

describe("Security hardening (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sets helmet security headers on responses", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-dns-prefetch-control"]).toBeDefined();
  });

  it("reflects Access-Control-Allow-Origin only for the configured allowed origin", async () => {
    const allowed = await request(app.getHttpServer()).get("/health").set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");

    const disallowed = await request(app.getHttpServer()).get("/health").set("Origin", "http://evil.example.com");
    expect(disallowed.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns the standardized error shape for unknown routes", async () => {
    const res = await request(app.getHttpServer()).get("/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
        path: "/this-route-does-not-exist",
      }),
    );
    expect(typeof res.body.timestamp).toBe("string");
  });
});
