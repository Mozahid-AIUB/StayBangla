import { IsIn, IsISO8601, IsOptional, IsString } from "class-validator";

export class ListBookingsQueryDto {
  @IsOptional()
  @IsIn([
    "HELD",
    "CONFIRMED",
    "CHECKED_IN",
    "COMPLETED",
    "AUTO_CANCELLED",
    "CANCELLED",
    "REFUNDED",
    "BLOCKED",
  ])
  status?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  // { strict: true } rejects calendar-invalid dates like "2026-02-30" that
  // the default (loose) ISO8601 check accepts (isISO8601("2026-02-30") ===
  // true without strict mode). Without this, such a value passes DTO
  // validation, reaches `${filter.from}::date` in raw SQL, and Postgres
  // raises 22007 (date/time field value out of range) — surfaced by
  // AllExceptionsFilter as a generic 500 instead of a 400 at the boundary.
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
