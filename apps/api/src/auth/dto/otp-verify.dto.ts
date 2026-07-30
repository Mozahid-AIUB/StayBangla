import { IsNotEmpty, IsString, Length } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class OtpVerifyDto {
  @ApiProperty({
    example: "+8801700000000",
    description: "The same phone number or email the OTP was requested for.",
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({
    example: "123456",
    description: "The 6-digit one-time password received via SMS or email.",
  })
  @IsString()
  @Length(6, 6)
  otp!: string;
}
