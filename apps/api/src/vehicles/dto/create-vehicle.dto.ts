import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { District } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateVehicleDto {
  @ApiProperty({ enum: ["CNG", "JEEP", "BOAT"], example: "JEEP" })
  @IsIn(["CNG", "JEEP", "BOAT"])
  category!: "CNG" | "JEEP" | "BOAT";

  @ApiProperty({ enum: District, example: "BANDARBAN" })
  @IsEnum(District)
  city!: District;

  @ApiPropertyOptional({ example: "Toyota Land Cruiser" })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ example: 6 })
  @IsInt()
  @Min(1)
  capacity!: number;

  @ApiProperty({
    example: 400000,
    description: "Price per day in minor units (poisha).",
  })
  @IsInt()
  @Min(1)
  pricePerDayMinor!: number;
}
