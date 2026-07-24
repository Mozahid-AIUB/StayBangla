import { Module } from "@nestjs/common";
import { StoragePort } from "./storage.port";
import { MinioStorageService } from "./minio-storage.service";

@Module({
  providers: [{ provide: StoragePort, useClass: MinioStorageService }],
  exports: [StoragePort],
})
export class StorageModule {}
