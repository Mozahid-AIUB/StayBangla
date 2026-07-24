import { IsBoolean, IsOptional, IsString } from "class-validator";

export class ConfirmPhotoDto {
  @IsString()
  objectKey!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
