import { Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../common/redis/redis.service";
import { StoragePort } from "../common/storage/storage.port";
import { HealthController } from "./health.controller";

function makeResMock(): { status: jest.Mock; json: jest.Mock } {
  const res: { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("HealthController", () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };
  let storage: { ensureBucketExists: jest.Mock };

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    redis = { ping: jest.fn() };
    storage = { ensureBucketExists: jest.fn() };
    controller = new HealthController(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      storage as unknown as StoragePort,
    );
  });

  describe("check", () => {
    it("returns status ok", () => {
      expect(controller.check()).toEqual({ status: "ok" });
    });
  });

  describe("db", () => {
    it("returns db ok when Postgres reachable", async () => {
      prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
      await expect(controller.db()).resolves.toEqual({ db: "ok" });
    });
  });

  describe("detailed", () => {
    it("returns 200 with all three ok when every check succeeds", async () => {
      prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
      redis.ping.mockResolvedValue("PONG");
      storage.ensureBucketExists.mockResolvedValue(undefined);
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        db: "ok",
        redis: "ok",
        minio: "ok",
      });
    });

    it("returns 503 with db down when Postgres fails, but redis/minio still report ok", async () => {
      prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));
      redis.ping.mockResolvedValue("PONG");
      storage.ensureBucketExists.mockResolvedValue(undefined);
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        db: "down",
        redis: "ok",
        minio: "ok",
      });
    });

    it("returns 503 with redis down when Redis fails, but db/minio still report ok", async () => {
      prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
      redis.ping.mockRejectedValue(new Error("ECONNREFUSED"));
      storage.ensureBucketExists.mockResolvedValue(undefined);
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        db: "ok",
        redis: "down",
        minio: "ok",
      });
    });

    it("returns 503 with minio down when MinIO fails, but db/redis still report ok", async () => {
      prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
      redis.ping.mockResolvedValue("PONG");
      storage.ensureBucketExists.mockRejectedValue(
        new Error("bucket unreachable"),
      );
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        db: "ok",
        redis: "ok",
        minio: "down",
      });
    });

    it("returns 503 with all three down when every check fails", async () => {
      prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));
      redis.ping.mockRejectedValue(new Error("ECONNREFUSED"));
      storage.ensureBucketExists.mockRejectedValue(
        new Error("bucket unreachable"),
      );
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        db: "down",
        redis: "down",
        minio: "down",
      });
    });
  });
});
