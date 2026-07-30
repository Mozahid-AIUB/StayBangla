import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateBookingDto {
  @ApiProperty({ enum: ["ROOM", "VEHICLE"], example: "ROOM" })
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @ApiProperty({ example: "8f14e45f-ceea-4d2d-8b3f-1b3f8e2e2e2e" })
  @IsUUID()
  bookableId!: string;

  @ApiProperty({ example: "2026-09-01" })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: "2026-09-03" })
  @IsDateString()
  checkOut!: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;
}
