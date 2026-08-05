import { IsIn, IsOptional, IsString } from "class-validator";

export class TravelerListQueryDto {
  @IsOptional()
  @IsIn(["SUSPENDED"])
  status?: "SUSPENDED";

  @IsOptional()
  @IsString()
  search?: string;
}
