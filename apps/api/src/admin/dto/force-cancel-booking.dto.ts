import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class ForceCancelBookingDto {
  @ApiProperty({
    example: "Duplicate booking created by a payment-gateway retry.",
    description:
      "Shown in the audit log; never surfaced to the traveler automatically.",
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
