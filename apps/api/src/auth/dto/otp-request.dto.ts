import { IsIn, IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class OtpRequestDto {
  @ApiProperty({
    enum: ["sms", "email"],
    example: "sms",
    description: "Delivery channel for the one-time password.",
  })
  @IsIn(["sms", "email"])
  channel!: "sms" | "email";

  @ApiProperty({
    example: "+8801700000000",
    description:
      "Phone number (for channel=sms) or email address (for channel=email).",
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;
}
