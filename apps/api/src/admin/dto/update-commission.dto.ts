import { IsInt, Max, Min } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateCommissionDto {
  @ApiProperty({
    example: 12,
    minimum: 0,
    maximum: 100,
    description:
      "Platform's commission rate for this vendor, as a whole-number percent.",
  })
  @IsInt()
  @Min(0)
  @Max(100)
  commissionRatePercent!: number;
}
