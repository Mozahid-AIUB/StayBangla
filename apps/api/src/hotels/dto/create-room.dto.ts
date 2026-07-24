import { IsInt, IsNotEmpty, IsString, Min } from "class-validator";

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  roomType!: string;

  @IsInt()
  @Min(1)
  pricePerNightMinor!: number;

  @IsInt()
  @Min(1)
  capacity!: number;
}
