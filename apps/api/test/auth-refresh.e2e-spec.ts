import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { registerAndLogin, extractCookie } from "./helpers/test-users";

describe("Auth Refresh (e2e)", () => {
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

  it("rotates the refresh cookie and issues a new access token", async () => {
    const { refreshCookie } = await registerAndLogin(
      app,
      "refresh1@example.com",
    );
    const res = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", refreshCookie);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect((res.headers["set-cookie"] as unknown as string[])[0]).toMatch(
      /refreshToken=/,
    );
  });

  it("rejects reuse of an already-rotated refresh token and revokes the whole family", async () => {
    const { refreshCookie } = await registerAndLogin(
      app,
      "refresh2@example.com",
    );
    const first = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", refreshCookie);
    const rotatedCookie = extractCookie(first);

    const reuse = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", refreshCookie);
    expect(reuse.status).toBe(401);

    const legitimateFollowUp = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", rotatedCookie);
    expect(legitimateFollowUp.status).toBe(401);
  });

  it("rejects refresh with no cookie present", async () => {
    const res = await request(app.getHttpServer()).post("/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("logout revokes the family so a subsequent refresh fails", async () => {
    const { refreshCookie } = await registerAndLogin(
      app,
      "refresh3@example.com",
    );
    await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", refreshCookie);
    const res = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", refreshCookie);
    expect(res.status).toBe(401);
  });
});
