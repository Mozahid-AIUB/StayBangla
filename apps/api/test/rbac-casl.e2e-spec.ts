import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";

describe("RBAC + CASL (e2e)", () => {
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

  it("GET /users/me without a token returns 401", async () => {
    const res = await request(app.getHttpServer()).get("/users/me");
    expect(res.status).toBe(401);
  });

  it("GET /users/me with a valid token returns the profile without passwordHash", async () => {
    const { accessToken } = await registerAndLogin(app, "rbac1@example.com");
    const res = await request(app.getHttpServer())
      .get("/users/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("rbac1@example.com");
    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|password_hash|\$argon2/,
    );
  });

  it("PATCH /users/me updates only the caller's own profile, ignoring any id in the body", async () => {
    const { accessToken } = await registerAndLogin(app, "rbac2@example.com");
    const res = await request(app.getHttpServer())
      .patch("/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fullName: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe("Updated Name");
    expect(res.body.email).toBe("rbac2@example.com");
  });

  it("PATCH /users/me rejects unknown fields via DTO whitelist", async () => {
    const { accessToken } = await registerAndLogin(app, "rbac3@example.com");
    const res = await request(app.getHttpServer())
      .patch("/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fullName: "Ok Name", verifiedStatus: "VERIFIED" });

    expect(res.status).toBe(400);
  });

  it("GET /users/me with an invalid token returns 401", async () => {
    const res = await request(app.getHttpServer())
      .get("/users/me")
      .set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
  });
});
