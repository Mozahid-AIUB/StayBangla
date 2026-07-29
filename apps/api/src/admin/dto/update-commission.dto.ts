import { IsInt, Max, Min } from "class-validator";

export class UpdateCommissionDto {
  @IsInt()
  @Min(0)
  @Max(100)
  commissionRatePercent!: number;
}
