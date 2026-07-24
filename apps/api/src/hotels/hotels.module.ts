import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { StorageModule } from "../common/storage/storage.module";
import { HotelsService } from "./hotels.service";
import { HotelsController } from "./hotels.controller";
import { RoomsService } from "./rooms.service";
import { RoomsController } from "./rooms.controller";

@Module({
  imports: [UsersModule, StorageModule],
  controllers: [HotelsController, RoomsController],
  providers: [HotelsService, RoomsService],
  exports: [HotelsService, RoomsService],
})
export class HotelsModule {}
