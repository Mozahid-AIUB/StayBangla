import { IsEnum, IsOptional, Matches } from "class-validator";
import {
  CALENDAR_DATE_MESSAGE,
  CALENDAR_DATE_REGEX,
} from "../../common/date/calendar-date";
import { District } from "@prisma/client";
import { ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Dates are optional, and the pair is validated in the service rather than here.
 *
 * class-validator can say "this is a calendar date" but not "these two must
 * arrive together" without a custom validator, and the same pairing rule
 * applies to vehicles. `assertOptionalAvailabilityRange` holds it in one place
 * — which is also where the reversed-range and equal-date rules already live.
 *
 * The regexes stay so a malformed date is refused before it reaches
 * `${checkIn}::date`, where Postgres would resolve an ISO instant against the
 * session timezone and quietly search a different night.
 */
export class SearchAvailableRoomsDto {
  @ApiPropertyOptional({
    example: "2026-09-01",
    description:
      "Omit both dates to browse everything in the district. Sending one " +
      "without the other is a 400.",
  })
  @IsOptional()
  @Matches(CALENDAR_DATE_REGEX, {
    message: `checkIn ${CALENDAR_DATE_MESSAGE}`,
  })
  checkIn?: string;

  @ApiPropertyOptional({ example: "2026-09-03" })
  @IsOptional()
  @Matches(CALENDAR_DATE_REGEX, {
    message: `checkOut ${CALENDAR_DATE_MESSAGE}`,
  })
  checkOut?: string;

  @ApiPropertyOptional({ enum: District, example: "DHAKA" })
  @IsOptional()
  @IsEnum(District)
  city?: District;
}
