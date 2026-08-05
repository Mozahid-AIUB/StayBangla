import { IsIn, IsISO8601, IsOptional, IsString } from "class-validator";

export class ListBookingsQueryDto {
  @IsOptional()
  @IsIn([
    "HELD",
    "CONFIRMED",
    "CHECKED_IN",
    "COMPLETED",
    "AUTO_CANCELLED",
    "CANCELLED",
    "REFUNDED",
    "BLOCKED",
  ])
  status?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
