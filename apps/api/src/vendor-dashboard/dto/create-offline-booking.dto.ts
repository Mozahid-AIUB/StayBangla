import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateOfflineBookingDto {
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @IsString()
  bookableId!: string;

  @IsString()
  checkIn!: string;

  @IsString()
  checkOut!: string;

  @IsOptional()
  @IsString()
  guestName?: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
