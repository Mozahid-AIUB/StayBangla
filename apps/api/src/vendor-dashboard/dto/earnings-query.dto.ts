import { IsIn, IsISO8601, IsOptional } from "class-validator";

export class EarningsQueryDto {
  @IsOptional()
  @IsIn(["today", "week", "month"])
  period?: "today" | "week" | "month";

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
