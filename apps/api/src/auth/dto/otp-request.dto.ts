import { IsIn, IsNotEmpty, IsString } from "class-validator";

export class OtpRequestDto {
  @IsIn(["sms", "email"])
  channel!: "sms" | "email";

  @IsString()
  @IsNotEmpty()
  identifier!: string;
}
