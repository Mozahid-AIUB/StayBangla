import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { registerAndLogin } from "./test-users";
import { testPrisma } from "./test-db";

export async function createVerifiedVendor(
  app: INestApplication,
  email: string,
): Promise<{ vendorId: string; accessToken: string }> {
  const { accessToken } = await registerAndLogin(app, email);
  const me = await request(app.getHttpServer())
    .get("/users/me")
    .set("Authorization", `Bearer ${accessToken}`);

  // Test-only shortcut: directly flip verifiedStatus via Prisma, since the real
  // admin-approval flow (add-admin-panel-basic) doesn't exist yet.
  await testPrisma.user.update({
    where: { id: me.body.id },
    data: { verifiedStatus: "VERIFIED" },
  });

  return { vendorId: me.body.id as string, accessToken };
}

export async function createHotelWithRoom(
  app: INestApplication,
  vendorToken: string,
  overrides: Partial<{ pricePerNightMinor: number; capacity: number }> = {},
): Promise<{ hotelId: string; roomId: string }> {
  const hotel = await request(app.getHttpServer())
    .post("/hotels")
    .set("Authorization", `Bearer ${vendorToken}`)
    .send({ name: "Test Hotel", city: "Dhaka", address: "123 Test Road" });

  const room = await request(app.getHttpServer())
    .post(`/hotels/${hotel.body.id}/rooms`)
    .set("Authorization", `Bearer ${vendorToken}`)
    .send({
      roomType: "DOUBLE",
      pricePerNightMinor: overrides.pricePerNightMinor ?? 500000,
      capacity: overrides.capacity ?? 2,
    });

  return { hotelId: hotel.body.id as string, roomId: room.body.id as string };
}
