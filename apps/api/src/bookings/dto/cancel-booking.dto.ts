import { IsBoolean, IsOptional } from "class-validator";

export class CancelBookingDto {
  @IsOptional()
  @IsBoolean()
  acknowledgeNoRefund?: boolean;
}
