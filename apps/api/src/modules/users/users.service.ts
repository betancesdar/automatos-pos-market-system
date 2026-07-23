import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import { hashPassword, verifyPassword } from '../../common/password.util';
import { signToken } from '../../common/jwt.util';

export interface AuthUserDto {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: Role;
  tenantId: string | null;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async login(identifier: string, password: string): Promise<{ user: AuthUserDto; token: string }> {
    const normalizedIdentifier = identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: normalizedIdentifier, mode: 'insensitive' } },
          { email: { equals: normalizedIdentifier.toLowerCase(), mode: 'insensitive' } },
        ],
      },
    });
    if (!user || !verifyPassword(password, user.password)) {
      throw new UnauthorizedException('Invalid username/email or password');
    }

    const userDto: AuthUserDto = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const token = signToken({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    });

    return { user: userDto, token };
  }

  async getMe(userId: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };
  }
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async listUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, name: true, username: true, email: true, role: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async createUser(
    tenantId: string,
    data: { name: string; username: string; email?: string; password: string; role: Role },
  ) {
    if (!data.name?.trim()) throw new BadRequestException('Name is required');
    if (!data.username?.trim()) throw new BadRequestException('Username is required');
    if (!data.password || data.password.length < 4) {
      throw new BadRequestException('Password must be at least 4 characters');
    }
    if (data.role !== Role.ADMIN && data.role !== Role.CASHIER) {
      throw new BadRequestException('Role must be ADMIN or CASHIER');
    }

    const normalizedUsername = data.username.trim().toLowerCase();
    const existingUsername = await this.prisma.user.findUnique({ where: { username: normalizedUsername } });
    if (existingUsername) throw new ConflictException('Username already in use');
    if (data.email?.trim()) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: data.email.trim().toLowerCase() },
      });
      if (existingEmail) throw new ConflictException('Email already in use');
    }

    return this.prisma.user.create({
      data: {
        tenantId,
        name: data.name.trim(),
        username: normalizedUsername,
        email: data.email?.trim().toLowerCase() || null,
        password: hashPassword(data.password),
        role: data.role,
      },
      select: { id: true, name: true, username: true, email: true, role: true, createdAt: true },
    });
  }

  async updateUser(
    tenantId: string,
    userId: string,
    data: { name?: string; username?: string; email?: string | null; password?: string; role?: Role },
  ) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('User not found');

    if (data.email && data.email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: data.email.trim().toLowerCase() } });
      if (existing) throw new ConflictException('Email already in use');
    }
    if (data.username?.trim() && data.username.trim().toLowerCase() !== user.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: data.username.trim().toLowerCase() },
      });
      if (existing) throw new ConflictException('Username already in use');
    }

    if (data.role && data.role !== Role.ADMIN && data.role !== Role.CASHIER) {
      throw new BadRequestException('Role must be ADMIN or CASHIER');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: data.name?.trim(),
        username: data.username?.trim().toLowerCase(),
        ...(data.email !== undefined && { email: data.email?.trim().toLowerCase() || null }),
        role: data.role,
        ...(data.password ? { password: hashPassword(data.password) } : {}),
      },
      select: { id: true, name: true, username: true, email: true, role: true, createdAt: true },
    });
  }

  async deleteUser(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('User not found');

    const adminCount = await this.prisma.user.count({
      where: { tenantId, role: Role.ADMIN },
    });
    if (user.role === Role.ADMIN && adminCount <= 1) {
      throw new BadRequestException('Cannot delete the last admin user');
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { deleted: true };
  }
}
