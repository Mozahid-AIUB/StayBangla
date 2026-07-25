import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";

describe("Rate limiting (e2e)", () => {
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

  it("throttles /auth/otp/request after 5 requests in the window and returns a well-formed 429", async () => {
    // The route's own @Throttle decorator hardcodes limit:5 (see Task 3) —
    // this test exercises that literal directly, not an env-driven value.
    let lastRes;
    for (let i = 0; i < 6; i += 1) {
      lastRes = await request(app.getHttpServer())
        .post("/auth/otp/request")
        .send({ channel: "sms", identifier: `+880170000${i}` });
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body).toEqual(
      expect.objectContaining({
        statusCode: 429,
        error: expect.any(String),
        message: expect.any(String),
        timestamp: expect.any(String),
        path: "/auth/otp/request",
      }),
    );
  });

  it("throttles /auth/login after 10 requests in the window", async () => {
    let lastRes;
    for (let i = 0; i < 11; i += 1) {
      lastRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ identifier: "nobody@example.com", password: "wrong-password" });
    }

    expect(lastRes!.status).toBe(429);
  });

  it("never throttles GET /health even after exceeding the global default many times over", async () => {
    // 150 requests > the global 100/min default, proving @SkipThrottle() truly
    // exempts this route rather than just having a generous limit. Sent in
    // small concurrent batches (not one 150-way Promise.all) — this environment's
    // socket/connection handling can't sustain 150 simultaneous in-process
    // supertest connections against a single Nest test server, which is an
    // infra ceiling unrelated to the throttling behavior under test.
    const batchSize = 10;
    const totalRequests = 150;
    for (let sent = 0; sent < totalRequests; sent += batchSize) {
      const batch = Array.from({ length: batchSize }, () =>
        request(app.getHttpServer()).get("/health"),
      );
      const results = await Promise.all(batch);
      for (const res of results) {
        expect(res.status).toBe(200);
      }
    }
  });
});
