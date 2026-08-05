import { IsIn, IsInt, IsISO8601, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";
import { District } from "@prisma/client";

const BOOKING_STATUSES = [
  "HELD",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "AUTO_CANCELLED",
  "CANCELLED",
  "REFUNDED",
  "BLOCKED",
] as const;

const DISTRICTS = Object.values(District);

export class AdminBookingListQueryDto {
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: (typeof BOOKING_STATUSES)[number];

  @IsOptional()
  @IsIn(DISTRICTS)
  district?: District;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
