import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";

export class UpdateVehicleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerDayMinor?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
