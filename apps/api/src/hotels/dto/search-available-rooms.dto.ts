import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { District } from "@prisma/client";

export class SearchAvailableRoomsDto {
  @IsDateString()
  checkIn!: string;

  @IsDateString()
  checkOut!: string;

  @IsOptional()
  @IsEnum(District)
  city?: District;
}
