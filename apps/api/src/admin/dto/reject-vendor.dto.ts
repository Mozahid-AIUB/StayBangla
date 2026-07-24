import { IsNotEmpty, IsString } from "class-validator";

export class RejectVendorDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
