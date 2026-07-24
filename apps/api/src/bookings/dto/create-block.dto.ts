import { IsDateString, IsIn, IsUUID } from "class-validator";

export class CreateBlockDto {
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @IsUUID()
  bookableId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
