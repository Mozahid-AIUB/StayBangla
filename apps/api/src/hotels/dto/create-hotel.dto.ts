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
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateHotelDto {
  @ApiProperty({ example: "Cox's Bazar Beach Resort" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: District, example: "COXS_BAZAR" })
  @IsEnum(District)
  city!: District;

  @ApiProperty({ example: "Marine Drive Road, Kolatoli" })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiPropertyOptional({ example: "Beachfront resort with sea-view rooms." })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: FacilityCatalog,
    isArray: true,
    example: ["WIFI", "SWIMMING_POOL"],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(FacilityCatalog, { each: true })
  amenities?: FacilityCatalog[];

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;

  @ApiProperty({ example: "14:00" })
  @IsString()
  @IsNotEmpty()
  checkInTime!: string;

  @ApiProperty({ example: "11:00" })
  @IsString()
  @IsNotEmpty()
  checkOutTime!: string;
}
