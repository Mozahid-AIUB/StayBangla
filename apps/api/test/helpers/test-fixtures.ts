import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { registerAndLogin } from "./test-users";
import { testPrisma } from "./test-db";
import { TokenService } from "../../src/auth/token.service";

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
    .send({
      name: "Test Hotel",
      city: "DHAKA",
      address: "123 Test Road",
      checkInTime: "14:00",
      checkOutTime: "11:00",
    });

  const room = await request(app.getHttpServer())
    .post(`/hotels/${hotel.body.id}/rooms`)
    .set("Authorization", `Bearer ${vendorToken}`)
    .send({
      roomType: "DOUBLE",
      pricePerNightMinor: overrides.pricePerNightMinor ?? 500000,
      capacity: overrides.capacity ?? 2,
      hasAC: true,
      bedType: "DOUBLE",
    });

  return { hotelId: hotel.body.id as string, roomId: room.body.id as string };
}

export async function createTraveler(
  app: INestApplication,
  email: string,
): Promise<{ travelerId: string; accessToken: string }> {
  const user = await testPrisma.user.create({
    data: {
      email,
      fullName: "Test Traveler",
      verifiedStatus: "VERIFIED",
      roles: { create: [{ role: "TRAVELER" }] },
    },
  });

  // Test-only shortcut: real TRAVELER users are only ever created via the OTP
  // verify flow (no e2e-capturable OTP delivery exists yet), so this bypasses
  // HTTP entirely for user creation — same pattern as createVerifiedVendor's
  // direct Prisma flip of verifiedStatus above. The DI-wired TokenService
  // instance is pulled from the compiled test module so token issuance
  // (JWT secret/expiry, refresh-token persistence) exactly matches production.
  const tokenService = app.get(TokenService);
  const { accessToken } = await tokenService.issueTokenPair({
    id: user.id,
    roles: ["TRAVELER"],
  });

  return { travelerId: user.id, accessToken };
}

export async function createAdmin(
  app: INestApplication,
  email: string,
): Promise<{ adminId: string; accessToken: string }> {
  const user = await testPrisma.user.create({
    data: {
      email,
      fullName: "Test Admin",
      verifiedStatus: "VERIFIED",
      roles: { create: [{ role: "ADMIN" }] },
    },
  });

  // Test-only shortcut: real ADMIN users have no HTTP-facing creation path
  // (created via privileged/internal means in production), so this bypasses
  // HTTP entirely for user creation — same pattern as createTraveler above.
  const tokenService = app.get(TokenService);
  const { accessToken } = await tokenService.issueTokenPair({
    id: user.id,
    roles: ["ADMIN"],
  });

  return { adminId: user.id, accessToken };
}
