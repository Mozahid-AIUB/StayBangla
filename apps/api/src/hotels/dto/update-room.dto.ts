import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";

export class UpdateRoomDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerNightMinor?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
