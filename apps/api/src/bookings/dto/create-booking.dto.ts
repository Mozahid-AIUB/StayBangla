import { IsIn, IsInt, IsOptional, IsUUID, Matches, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * A bare calendar date, not any ISO 8601 string.
 *
 * `@IsDateString()` accepts "2026-09-01T23:00:00Z" as readily as "2026-09-01",
 * and that value ends up in `${checkIn}::date` — where Postgres resolves the
 * instant against the session timezone. The day a booking falls on would then
 * depend on a database setting rather than on what the traveller picked.
 */
export const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_DATE_MESSAGE = "must be a calendar date in YYYY-MM-DD form";

export class CreateBookingDto {
  @ApiProperty({ enum: ["ROOM", "VEHICLE"], example: "ROOM" })
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @ApiProperty({ example: "8f14e45f-ceea-4d2d-8b3f-1b3f8e2e2e2e" })
  @IsUUID()
  bookableId!: string;

  @ApiProperty({ example: "2026-09-01", pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
  @Matches(CALENDAR_DATE_REGEX, { message: `checkIn ${CALENDAR_DATE_MESSAGE}` })
  checkIn!: string;

  @ApiProperty({ example: "2026-09-03", pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
  @Matches(CALENDAR_DATE_REGEX, {
    message: `checkOut ${CALENDAR_DATE_MESSAGE}`,
  })
  checkOut!: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;
}
