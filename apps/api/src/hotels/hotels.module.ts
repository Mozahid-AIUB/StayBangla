import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { HotelsService } from "./hotels.service";
import { HotelsController } from "./hotels.controller";
import { RoomsService } from "./rooms.service";
import { RoomsController } from "./rooms.controller";

@Module({
  imports: [UsersModule],
  controllers: [HotelsController, RoomsController],
  providers: [HotelsService, RoomsService],
  exports: [HotelsService, RoomsService],
})
export class HotelsModule {}
