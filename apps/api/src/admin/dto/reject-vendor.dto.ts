import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RejectVendorDto {
  @ApiProperty({
    example: "Business registration document is illegible.",
    description:
      "Shown to the vendor and recorded in the verification history.",
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
