import { Body, Controller, Ip, Post } from "@nestjs/common";
import { OtpRequestDto } from "./dto/otp-request.dto";
import { OtpVerifyDto } from "./dto/otp-verify.dto";
import { OtpService } from "./otp.service";

@Controller("auth/otp")
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Post("request")
  async request(
    @Body() dto: OtpRequestDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.otpService.requestOtp(dto.channel, dto.identifier, ip);
    return { message: "OTP sent" };
  }

  @Post("verify")
  async verify(@Body() dto: OtpVerifyDto): Promise<{ verified: boolean }> {
    const verified = await this.otpService.verifyOtp(dto.identifier, dto.otp);
    return { verified };
  }
}
