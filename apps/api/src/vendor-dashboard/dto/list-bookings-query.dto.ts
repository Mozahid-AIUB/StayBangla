import { IsIn, IsOptional, IsString } from "class-validator";

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
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
