import { IsInt, IsOptional, IsString, Min } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class AuditLogQueryDto {
  @ApiPropertyOptional({
    description:
      "Filter to this vendor/traveler's audit history (matches AdminAuditLog.targetId).",
  })
  @IsOptional()
  @IsString()
  vendorId?: string;

  @ApiPropertyOptional({
    description: "Filter to actions performed by this admin.",
  })
  @IsOptional()
  @IsString()
  adminId?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
