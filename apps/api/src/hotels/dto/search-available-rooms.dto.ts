import { IsEnum, IsOptional, Matches } from "class-validator";
import {
  CALENDAR_DATE_MESSAGE,
  CALENDAR_DATE_REGEX,
} from "../../common/date/calendar-date";
import { District } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SearchAvailableRoomsDto {
  @ApiProperty({ example: "2026-09-01" })
  @Matches(CALENDAR_DATE_REGEX, {
    message: `checkIn ${CALENDAR_DATE_MESSAGE}`,
  })
  checkIn!: string;

  @ApiProperty({ example: "2026-09-03" })
  @Matches(CALENDAR_DATE_REGEX, {
    message: `checkOut ${CALENDAR_DATE_MESSAGE}`,
  })
  checkOut!: string;

  @ApiPropertyOptional({ enum: District, example: "DHAKA" })
  @IsOptional()
  @IsEnum(District)
  city?: District;
}
