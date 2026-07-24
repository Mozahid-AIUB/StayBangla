import { IsDateString, IsOptional, IsString } from "class-validator";

export class SearchAvailableRoomsDto {
  @IsDateString()
  checkIn!: string;

  @IsDateString()
  checkOut!: string;

  @IsOptional()
  @IsString()
  city?: string;
}
