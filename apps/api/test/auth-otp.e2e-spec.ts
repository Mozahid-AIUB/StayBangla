import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";

describe("Auth OTP (e2e)", () => {
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

  it("rejects a second request within the cooldown window", async () => {
    const identifier = "+8801700000001";
    await request(app.getHttpServer())
      .post("/auth/otp/request")
      .send({ channel: "sms", identifier });
    const second = await request(app.getHttpServer())
      .post("/auth/otp/request")
      .send({ channel: "sms", identifier });
    expect(second.status).toBe(429);
  });

  it("rejects an incorrect OTP with 400", async () => {
    const identifier = "+8801700000002";
    await request(app.getHttpServer())
      .post("/auth/otp/request")
      .send({ channel: "sms", identifier });
    const verify = await request(app.getHttpServer())
      .post("/auth/otp/verify")
      .send({ identifier, otp: "000000" });
    expect(verify.status).toBe(400);
  });

  it("rejects verification when no OTP was requested (expired/never-issued)", async () => {
    const verify = await request(app.getHttpServer())
      .post("/auth/otp/verify")
      .send({ identifier: "+8801700000099", otp: "123456" });
    expect(verify.status).toBe(410);
  });

  it("rejects a malformed request body (DTO validation)", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/otp/request")
      .send({ channel: "carrier-pigeon", identifier: "x" });
    expect(res.status).toBe(400);
  });
});
