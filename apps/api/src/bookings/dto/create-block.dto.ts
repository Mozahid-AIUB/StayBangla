import { IsIn, IsUUID, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { CALENDAR_DATE_REGEX } from "./create-booking.dto";

export class CreateBlockDto {
  @ApiProperty({ enum: ["ROOM", "VEHICLE"], example: "ROOM" })
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @ApiProperty({ example: "8f14e45f-ceea-4d2d-8b3f-1b3f8e2e2e2e" })
  @IsUUID()
  bookableId!: string;

  // Same rule as a booking's dates, and for the same reason: these reach
  // `daterange(${startDate}::date, ...)`, where an ISO instant would be
  // resolved against the database session's timezone.
  @ApiProperty({ example: "2026-09-10", pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
  @Matches(CALENDAR_DATE_REGEX, {
    message: "startDate must be a calendar date in YYYY-MM-DD form",
  })
  startDate!: string;

  @ApiProperty({ example: "2026-09-15", pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
  @Matches(CALENDAR_DATE_REGEX, {
    message: "endDate must be a calendar date in YYYY-MM-DD form",
  })
  endDate!: string;
}
