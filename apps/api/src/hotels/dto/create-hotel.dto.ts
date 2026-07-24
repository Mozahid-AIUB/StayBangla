import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { District, FacilityCatalog } from "@prisma/client";

export class CreateHotelDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(District)
  city!: District;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(FacilityCatalog, { each: true })
  amenities?: FacilityCatalog[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;

  @IsString()
  @IsNotEmpty()
  checkInTime!: string;

  @IsString()
  @IsNotEmpty()
  checkOutTime!: string;
}
