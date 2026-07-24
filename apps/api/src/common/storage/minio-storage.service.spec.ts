import { ConfigService } from "@nestjs/config";
import { MinioStorageService } from "./minio-storage.service";

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    MINIO_ENDPOINT: "127.0.0.1",
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: "staybangla",
    MINIO_SECRET_KEY: "staybangla-secret",
    MINIO_BUCKET: "staybangla-photos",
    PRESIGNED_URL_EXPIRY_SECONDS: 300,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("MinioStorageService", () => {
  it("delegates getPresignedUploadUrl to the underlying MinIO client with the configured bucket and expiry", async () => {
    const service = new MinioStorageService(makeConfig());
    const client = {
      presignedPutObject: jest
        .fn()
        .mockResolvedValue("https://minio.local/signed-url"),
    };
    (service as unknown as { client: unknown }).client = client;

    const url = await service.getPresignedUploadUrl(
      "hotels/h1/photo.jpg",
      "image/jpeg",
    );

    expect(client.presignedPutObject).toHaveBeenCalledWith(
      "staybangla-photos",
      "hotels/h1/photo.jpg",
      300,
    );
    expect(url).toBe("https://minio.local/signed-url");
  });

  it("delegates deleteObject to the underlying MinIO client", async () => {
    const service = new MinioStorageService(makeConfig());
    const client = { removeObject: jest.fn().mockResolvedValue(undefined) };
    (service as unknown as { client: unknown }).client = client;

    await service.deleteObject("hotels/h1/photo.jpg");

    expect(client.removeObject).toHaveBeenCalledWith(
      "staybangla-photos",
      "hotels/h1/photo.jpg",
    );
  });

  it("ensureBucketExists creates the bucket only if it doesn't already exist", async () => {
    const service = new MinioStorageService(makeConfig());
    const client = {
      bucketExists: jest.fn().mockResolvedValue(false),
      makeBucket: jest.fn().mockResolvedValue(undefined),
    };
    (service as unknown as { client: unknown }).client = client;

    await service.ensureBucketExists();

    expect(client.bucketExists).toHaveBeenCalledWith("staybangla-photos");
    expect(client.makeBucket).toHaveBeenCalledWith("staybangla-photos");
  });

  it("ensureBucketExists is a no-op when the bucket already exists", async () => {
    const service = new MinioStorageService(makeConfig());
    const client = {
      bucketExists: jest.fn().mockResolvedValue(true),
      makeBucket: jest.fn(),
    };
    (service as unknown as { client: unknown }).client = client;

    await service.ensureBucketExists();

    expect(client.makeBucket).not.toHaveBeenCalled();
  });
});
