import { IsOptional, IsString, MinLength } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: "Karim Hotel & Resorts" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;
}
