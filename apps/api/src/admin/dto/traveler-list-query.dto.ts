import { IsIn, IsOptional, IsString } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class TravelerListQueryDto {
  @ApiPropertyOptional({ enum: ["SUSPENDED"], example: "SUSPENDED" })
  @IsOptional()
  @IsIn(["SUSPENDED"])
  status?: "SUSPENDED";

  @ApiPropertyOptional({
    description: "Case-insensitive partial match against email/fullName/phone.",
    example: "rahim",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
