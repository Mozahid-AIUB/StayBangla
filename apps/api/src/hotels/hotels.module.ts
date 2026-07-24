import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { HotelsService } from "./hotels.service";

@Module({
  imports: [UsersModule],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
