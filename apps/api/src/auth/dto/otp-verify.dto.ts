import { IsNotEmpty, IsString, Length } from "class-validator";

export class OtpVerifyDto {
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}
