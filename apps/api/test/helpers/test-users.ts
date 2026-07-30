import { INestApplication } from "@nestjs/common";
import request from "supertest";

export function extractCookie(res: request.Response): string {
  const raw = (
    res.headers["set-cookie"] as unknown as string[] | undefined
  )?.[0];
  if (!raw) {
    throw new Error(
      "Expected a Set-Cookie header on the response, but none was present",
    );
  }
  return raw.split(";")[0]!;
}

export async function registerAndLogin(
  app: INestApplication,
  email: string,
  password = "supersecret1",
): Promise<{ accessToken: string; refreshCookie: string }> {
  await request(app.getHttpServer())
    .post("/v1/auth/register")
    .send({ email, password, fullName: "Test User", role: "VENDOR" });

  const login = await request(app.getHttpServer())
    .post("/v1/auth/login")
    .send({ identifier: email, password });

  return {
    accessToken: login.body.accessToken as string,
    refreshCookie: extractCookie(login),
  };
}
