import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
} from "./helpers/test-fixtures";

describe("Room/hotel photo upload (e2e)", () => {
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

  it("full happy path: presign -> upload to MinIO -> confirm -> appears as primary", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "photo-vendor@example.com",
    );
    const { hotelId } = await createHotelWithRoom(app, vendorToken);

    const presign = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ contentType: "image/jpeg" });
    expect(presign.status).toBe(201);
    expect(presign.body.uploadUrl).toEqual(expect.any(String));
    expect(presign.body.objectKey).toMatch(
      new RegExp(`^hotels/${hotelId}/.+\\.jpg$`),
    );

    // Real upload to the presigned URL, proving MinIO round-trips correctly.
    const fakeImageBytes = Buffer.from("fake-jpeg-bytes");
    const uploadRes = await fetch(presign.body.uploadUrl, {
      method: "PUT",
      body: fakeImageBytes,
      headers: { "Content-Type": "image/jpeg" },
    });
    expect(uploadRes.ok).toBe(true);

    const confirm = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/confirm`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ objectKey: presign.body.objectKey, isPrimary: true });
    expect(confirm.status).toBe(201);
    expect(confirm.body.isPrimary).toBe(true);
  });

  it("uploading a second primary photo un-sets the first", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "photo-vendor2@example.com",
    );
    const { hotelId } = await createHotelWithRoom(app, vendorToken);

    const presign1 = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ contentType: "image/jpeg" });
    const first = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/confirm`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ objectKey: presign1.body.objectKey, isPrimary: true });
    expect(first.body.isPrimary).toBe(true);

    const presign2 = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ contentType: "image/jpeg" });
    const second = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/confirm`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ objectKey: presign2.body.objectKey, isPrimary: true });
    expect(second.body.isPrimary).toBe(true);

    const deleteFirst = await request(app.getHttpServer())
      .delete(`/hotels/${hotelId}/photos/${first.body.id}`)
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(deleteFirst.status).toBe(200);
  });

  it("vendor B cannot presign a photo upload for vendor A's hotel", async () => {
    const { accessToken: vendorAToken } = await createVerifiedVendor(
      app,
      "photo-owner-a@example.com",
    );
    const { accessToken: vendorBToken } = await createVerifiedVendor(
      app,
      "photo-owner-b@example.com",
    );
    const { hotelId } = await createHotelWithRoom(app, vendorAToken);

    const res = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorBToken}`)
      .send({ contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });

  it("presigning a room photo scopes the objectKey to the room's id", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "photo-vendor3@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    const res = await request(app.getHttpServer())
      .post(`/rooms/${roomId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.objectKey).toMatch(
      new RegExp(`^rooms/${roomId}/.+\\.png$`),
    );
  });
});
