import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { HotelsService } from "./hotels.service";
import { HotelsController } from "./hotels.controller";

@Module({
  imports: [UsersModule],
  controllers: [HotelsController],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
