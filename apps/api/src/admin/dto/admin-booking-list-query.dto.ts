import { IsIn, IsInt, IsISO8601, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
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
  @ApiPropertyOptional({ enum: BOOKING_STATUSES, example: "CONFIRMED" })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: (typeof BOOKING_STATUSES)[number];

  @ApiPropertyOptional({ enum: District, example: "DHAKA" })
  @IsOptional()
  @IsIn(DISTRICTS)
  district?: District;

  @ApiPropertyOptional({ example: "2026-07-01T00:00:00.000Z" })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: "2026-08-01T00:00:00.000Z" })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
