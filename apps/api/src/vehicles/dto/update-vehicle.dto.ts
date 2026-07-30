import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateVehicleDto {
  @ApiPropertyOptional({
    example: 450000,
    description: "Price per day in minor units (poisha).",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerDayMinor?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
