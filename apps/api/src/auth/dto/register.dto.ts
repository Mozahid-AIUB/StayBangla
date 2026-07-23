import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  MinLength,
} from "class-validator";

export class RegisterDto {
  @IsEmail()
  email!: string;

  @MinLength(8)
  password!: string;

  @IsNotEmpty()
  fullName!: string;

  @IsIn(["VENDOR", "GUIDE"])
  role!: "VENDOR" | "GUIDE";

  @IsOptional()
  @IsIn(["HOTEL", "VEHICLE", "BOTH"])
  vendorType?: "HOTEL" | "VEHICLE" | "BOTH";
}
