import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "vendor@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: "correct-horse-battery-staple",
    minLength: 8,
    description: "Minimum 8 characters.",
  })
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: "Karim Hotel & Resorts" })
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({
    enum: ["VENDOR", "GUIDE"],
    example: "VENDOR",
    description:
      "Only VENDOR and GUIDE self-register; TRAVELER uses OTP, ADMIN/SUPER_ADMIN are created internally.",
  })
  @IsIn(["VENDOR", "GUIDE"])
  role!: "VENDOR" | "GUIDE";

  @ApiPropertyOptional({
    enum: ["HOTEL", "VEHICLE", "BOTH"],
    example: "HOTEL",
    description: "Required when role=VENDOR; ignored for role=GUIDE.",
  })
  @IsOptional()
  @IsIn(["HOTEL", "VEHICLE", "BOTH"])
  vendorType?: "HOTEL" | "VEHICLE" | "BOTH";
}
