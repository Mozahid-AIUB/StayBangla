import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Role, User, VendorType } from "@prisma/client";
import { UsersService } from "../users/users.service";
import { PasswordService } from "./password.service";
import { TokenService, TokenPair } from "./token.service";

interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  role: "VENDOR" | "GUIDE";
  vendorType?: "HOTEL" | "VEHICLE" | "BOTH";
}

@Injectable()
export class CredentialsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async register(input: RegisterInput): Promise<User> {
    const existing = await this.usersService.findByIdentifier(input.email);
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await this.passwordService.hash(input.password);
    return this.usersService.create({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role as Role,
      vendorType: input.vendorType as VendorType | undefined,
    });
  }

  async login(identifier: string, password: string): Promise<TokenPair> {
    const user = await this.usersService.findByIdentifier(identifier);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const valid = await this.passwordService.verify(
      user.passwordHash,
      password,
    );
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const roles = user.roles.map((r) => r.role);
    return this.tokenService.issueTokenPair({ id: user.id, roles });
  }
}
