import { IsBoolean, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ConfirmPhotoDto {
  @ApiProperty({
    example: "hotels/abc123/photo-1.jpg",
    description: "The objectKey returned by the presign step.",
  })
  @IsString()
  objectKey!: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
