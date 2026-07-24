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

export class CreateRoomDto {
  @IsEnum(RoomType)
  roomType!: RoomType;

  @IsInt()
  @Min(1)
  pricePerNightMinor!: number;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsBoolean()
  hasAC!: boolean;

  @IsEnum(BedType)
  bedType!: BedType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];
}
