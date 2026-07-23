import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";

describe("Auth Credentials (e2e)", () => {
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

  it("registers a vendor with PENDING status and never leaks the password hash", async () => {
    const res = await request(app.getHttpServer()).post("/auth/register").send({
      email: "vendor1@example.com",
      password: "supersecret1",
      fullName: "Vendor One",
      role: "VENDOR",
    });

    expect(res.status).toBe(201);
    expect(res.body.verifiedStatus).toBe("PENDING");
    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|password_hash|\$argon2/,
    );
  });

  it("rejects duplicate email registration with 409", async () => {
    await request(app.getHttpServer()).post("/auth/register").send({
      email: "vendor2@example.com",
      password: "supersecret1",
      fullName: "Vendor Two",
      role: "VENDOR",
    });
    const res = await request(app.getHttpServer()).post("/auth/register").send({
      email: "vendor2@example.com",
      password: "anotherpassword",
      fullName: "Vendor Two Duplicate",
      role: "VENDOR",
    });
    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials and sets a refresh cookie", async () => {
    await request(app.getHttpServer()).post("/auth/register").send({
      email: "vendor3@example.com",
      password: "supersecret1",
      fullName: "Vendor Three",
      role: "VENDOR",
    });

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ identifier: "vendor3@example.com", password: "supersecret1" });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.headers["set-cookie"]).toBeDefined();
    expect((res.headers["set-cookie"] as unknown as string[])[0]).toMatch(
      /refreshToken=/,
    );
  });

  it("rejects wrong password with a generic 401 message (anti-enumeration)", async () => {
    await request(app.getHttpServer()).post("/auth/register").send({
      email: "vendor4@example.com",
      password: "supersecret1",
      fullName: "Vendor Four",
      role: "VENDOR",
    });
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ identifier: "vendor4@example.com", password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect((res.body.message as string).toLowerCase()).not.toContain(
      "password",
    );
  });

  it("rejects weak passwords via DTO validation", async () => {
    const res = await request(app.getHttpServer()).post("/auth/register").send({
      email: "weakpass@example.com",
      password: "short",
      fullName: "Weak Pass",
      role: "VENDOR",
    });
    expect(res.status).toBe(400);
  });
});
