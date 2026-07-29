import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { District } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SearchAvailableRoomsDto {
  @ApiProperty({ example: "2026-09-01" })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: "2026-09-03" })
  @IsDateString()
  checkOut!: string;

  @ApiPropertyOptional({ enum: District, example: "DHAKA" })
  @IsOptional()
  @IsEnum(District)
  city?: District;
}
