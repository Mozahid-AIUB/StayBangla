import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "minio";
import { StoragePort } from "./storage.port";

@Injectable()
export class MinioStorageService extends StoragePort implements OnModuleInit {
  private readonly client: Client;
  private readonly bucket: string;
  private readonly expirySeconds: number;

  constructor(config: ConfigService) {
    super();
    this.client = new Client({
      endPoint: config.get<string>("MINIO_ENDPOINT", "127.0.0.1"),
      port: config.get<number>("MINIO_PORT", 9000),
      useSSL: config.get<boolean>("MINIO_USE_SSL", false),
      accessKey: config.get<string>("MINIO_ACCESS_KEY"),
      secretKey: config.get<string>("MINIO_SECRET_KEY"),
    });
    this.bucket = config.get<string>("MINIO_BUCKET", "staybangla-photos");
    this.expirySeconds = config.get<number>(
      "PRESIGNED_URL_EXPIRY_SECONDS",
      300,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  async ensureBucketExists(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async getPresignedUploadUrl(
    objectKey: string,
    _contentType: string,
  ): Promise<string> {
    return this.client.presignedPutObject(
      this.bucket,
      objectKey,
      this.expirySeconds,
    );
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }
}
