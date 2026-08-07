import { IsEnum, IsOptional, Matches } from "class-validator";
import {
  CALENDAR_DATE_MESSAGE,
  CALENDAR_DATE_REGEX,
} from "../../common/date/calendar-date";
import { District } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SearchAvailableVehiclesDto {
  @ApiProperty({ example: "2026-09-01" })
  @Matches(CALENDAR_DATE_REGEX, {
    message: `startDate ${CALENDAR_DATE_MESSAGE}`,
  })
  startDate!: string;

  @ApiProperty({ example: "2026-09-03" })
  @Matches(CALENDAR_DATE_REGEX, {
    message: `endDate ${CALENDAR_DATE_MESSAGE}`,
  })
  endDate!: string;

  @ApiPropertyOptional({ enum: District, example: "BANDARBAN" })
  @IsOptional()
  @IsEnum(District)
  city?: District;
}
