import { IsIn } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class PresignPhotoDto {
  @ApiProperty({
    enum: ["image/jpeg", "image/png", "image/webp"],
    example: "image/jpeg",
  })
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  contentType!: "image/jpeg" | "image/png" | "image/webp";
}
