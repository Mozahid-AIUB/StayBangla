import { IsIn, IsOptional, IsString } from "class-validator";

export class VendorListQueryDto {
  @IsOptional()
  @IsIn(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"])
  status?: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";

  @IsOptional()
  @IsString()
  search?: string;
}
