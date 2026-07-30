import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateRoomDto {
  @ApiPropertyOptional({
    example: 550000,
    description: "Price per night in minor units (poisha).",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerNightMinor?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
