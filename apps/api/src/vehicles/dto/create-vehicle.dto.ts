import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { District } from "@prisma/client";

export class CreateVehicleDto {
  @IsIn(["CNG", "JEEP", "BOAT"])
  category!: "CNG" | "JEEP" | "BOAT";

  @IsEnum(District)
  city!: District;

  @IsOptional()
  @IsString()
  model?: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsInt()
  @Min(1)
  pricePerDayMinor!: number;
}
