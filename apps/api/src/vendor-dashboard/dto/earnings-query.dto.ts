import { IsIn, IsOptional, IsString } from "class-validator";

export class EarningsQueryDto {
  @IsOptional()
  @IsIn(["today", "week", "month"])
  period?: "today" | "week" | "month";

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
