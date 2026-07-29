import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { BedType, RoomType } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateRoomDto {
  @ApiProperty({ enum: RoomType, example: "DOUBLE" })
  @IsEnum(RoomType)
  roomType!: RoomType;

  @ApiProperty({
    example: 500000,
    description: "Price per night in minor units (poisha).",
  })
  @IsInt()
  @Min(1)
  pricePerNightMinor!: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  capacity!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  hasAC!: boolean;

  @ApiProperty({ enum: BedType, example: "DOUBLE" })
  @IsEnum(BedType)
  bedType!: BedType;

  @ApiPropertyOptional({ example: ["Sea view", "Balcony"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];
}
