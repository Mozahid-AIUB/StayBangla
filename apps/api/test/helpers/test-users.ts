import { INestApplication } from "@nestjs/common";
import request from "supertest";

export function extractCookie(res: request.Response): string {
  const raw = (res.headers["set-cookie"] as unknown as string[])[0];
  return raw.split(";")[0];
}

export async function registerAndLogin(
  app: INestApplication,
  email: string,
  password = "supersecret1",
): Promise<{ accessToken: string; refreshCookie: string }> {
  await request(app.getHttpServer())
    .post("/auth/register")
    .send({ email, password, fullName: "Test User", role: "VENDOR" });

  const login = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ identifier: email, password });

  return {
    accessToken: login.body.accessToken as string,
    refreshCookie: extractCookie(login),
  };
}
