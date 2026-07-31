import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class SuspendVendorDto {
  @ApiProperty({
    example: "Repeated customer complaints about non-existent listings.",
    description: "Shown to the vendor and recorded in the audit log.",
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
