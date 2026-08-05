import { IsIn, IsInt, IsISO8601, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";

export class RevenueTrendQueryDto {
  @IsOptional()
  @IsIn(["daily", "weekly", "monthly"])
  period?: "daily" | "weekly" | "monthly";

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class TopVendorsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsIn(["revenue", "bookings"])
  metric?: "revenue" | "bookings";
}
