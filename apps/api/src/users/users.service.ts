import { Injectable } from "@nestjs/common";
import { Role, User, VendorType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface CreateUserInput {
  email?: string;
  phone?: string;
  passwordHash?: string;
  fullName?: string;
  role: Role;
  vendorType?: VendorType;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdentifier(identifier: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }] },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        phone: input.phone,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        vendorType: input.vendorType,
        roles: { create: [{ role: input.role }] },
      },
    });
  }

  async updateProfile(id: string, data: { fullName?: string }): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }
}
