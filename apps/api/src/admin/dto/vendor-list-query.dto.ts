import { IsIn, IsOptional, IsString } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class VendorListQueryDto {
  @ApiPropertyOptional({
    enum: ["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"],
    example: "VERIFIED",
  })
  @IsOptional()
  @IsIn(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"])
  status?: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";

  @ApiPropertyOptional({
    description: "Case-insensitive partial match against email/fullName/phone.",
    example: "rahim",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
