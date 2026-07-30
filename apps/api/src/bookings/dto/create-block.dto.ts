import { IsDateString, IsIn, IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateBlockDto {
  @ApiProperty({ enum: ["ROOM", "VEHICLE"], example: "ROOM" })
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @ApiProperty({ example: "8f14e45f-ceea-4d2d-8b3f-1b3f8e2e2e2e" })
  @IsUUID()
  bookableId!: string;

  @ApiProperty({ example: "2026-09-10" })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: "2026-09-15" })
  @IsDateString()
  endDate!: string;
}
