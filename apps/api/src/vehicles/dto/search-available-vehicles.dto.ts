import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { District } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SearchAvailableVehiclesDto {
  @ApiProperty({ example: "2026-09-01" })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: "2026-09-03" })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ enum: District, example: "BANDARBAN" })
  @IsOptional()
  @IsEnum(District)
  city?: District;
}
