import { IsEnum, IsOptional, Matches } from "class-validator";
import {
  CALENDAR_DATE_MESSAGE,
  CALENDAR_DATE_REGEX,
} from "../../common/date/calendar-date";
import { District } from "@prisma/client";
import { ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Dates are optional, matching rooms. See SearchAvailableRoomsDto for why the
 * pairing rule lives in `assertOptionalAvailabilityRange` rather than here.
 */
export class SearchAvailableVehiclesDto {
  @ApiPropertyOptional({
    example: "2026-09-01",
    description:
      "Omit both dates to browse everything in the district. Sending one " +
      "without the other is a 400.",
  })
  @IsOptional()
  @Matches(CALENDAR_DATE_REGEX, {
    message: `startDate ${CALENDAR_DATE_MESSAGE}`,
  })
  startDate?: string;

  @ApiPropertyOptional({ example: "2026-09-03" })
  @IsOptional()
  @Matches(CALENDAR_DATE_REGEX, {
    message: `endDate ${CALENDAR_DATE_MESSAGE}`,
  })
  endDate?: string;

  @ApiPropertyOptional({ enum: District, example: "BANDARBAN" })
  @IsOptional()
  @IsEnum(District)
  city?: District;
}
