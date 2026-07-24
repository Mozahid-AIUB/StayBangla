import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { District } from "@prisma/client";

export class SearchAvailableVehiclesDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsEnum(District)
  city?: District;
}
