import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateLedgerEntryDto {
  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsIn(["INCOME", "EXPENSE"])
  direction!: "INCOME" | "EXPENSE";

  @IsIn(["MAINTENANCE", "SALARY", "UTILITY", "OTHER"])
  category!: "MAINTENANCE" | "SALARY" | "UTILITY" | "OTHER";

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsString()
  entryDate!: string;
}
