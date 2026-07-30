import { IsBoolean, IsOptional } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class CancelBookingDto {
  @ApiPropertyOptional({
    example: true,
    description:
      "Required (must be true) to cancel a CONFIRMED+PAID booking — " +
      "acknowledges no refund will be issued. Not needed for a HELD booking.",
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeNoRefund?: boolean;
}
