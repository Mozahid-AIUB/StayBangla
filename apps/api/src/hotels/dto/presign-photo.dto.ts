import { IsIn } from "class-validator";

export class PresignPhotoDto {
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  contentType!: "image/jpeg" | "image/png" | "image/webp";
}
