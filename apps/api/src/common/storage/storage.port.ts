export abstract class StoragePort {
  abstract getPresignedUploadUrl(
    objectKey: string,
    contentType: string,
  ): Promise<string>;
  abstract deleteObject(objectKey: string): Promise<void>;
  abstract ensureBucketExists(): Promise<void>;
}
