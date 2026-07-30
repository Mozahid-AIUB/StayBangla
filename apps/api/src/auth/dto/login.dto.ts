import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
  @ApiProperty({
    example: "vendor@example.com",
    description: "Email address used at registration.",
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({
    example: "correct-horse-battery-staple",
    description: "Account password (vendor/guide/admin credential login).",
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
