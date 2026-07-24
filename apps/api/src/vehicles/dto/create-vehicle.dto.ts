import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateVehicleDto {
  @IsIn(["CNG", "JEEP", "BOAT"])
  category!: "CNG" | "JEEP" | "BOAT";

  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsInt()
  @Min(1)
  pricePerDayMinor!: number;
}
