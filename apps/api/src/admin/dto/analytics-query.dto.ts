import { IsIn, IsInt, IsISO8601, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class RevenueTrendQueryDto {
  @ApiPropertyOptional({
    enum: ["daily", "weekly", "monthly"],
    default: "daily",
    example: "daily",
  })
  @IsOptional()
  @IsIn(["daily", "weekly", "monthly"])
  period?: "daily" | "weekly" | "monthly";

  @ApiPropertyOptional({ example: "2026-07-01T00:00:00.000Z" })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: "2026-08-01T00:00:00.000Z" })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class TopVendorsQueryDto {
  @ApiPropertyOptional({ example: 10, minimum: 1, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    enum: ["revenue", "bookings"],
    default: "revenue",
    example: "revenue",
  })
  @IsOptional()
  @IsIn(["revenue", "bookings"])
  metric?: "revenue" | "bookings";
}
