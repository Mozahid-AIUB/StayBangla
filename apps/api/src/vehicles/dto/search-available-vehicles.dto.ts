import { IsDateString, IsOptional, IsString } from "class-validator";

export class SearchAvailableVehiclesDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  city?: string;
}
