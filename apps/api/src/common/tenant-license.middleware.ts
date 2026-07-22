import {
  Injectable,
  NestMiddleware,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { LICENSE_BLOCKED_MESSAGE } from '../common/jwt.util';

const LICENSE_PROTECTED_PREFIXES = [
  '/catalog',
  '/categories',
  '/sales',
  '/finance',
  '/analytics',
  '/users',
  '/tenant',
  '/cash-sessions',
  '/reports',
];

@Injectable()
export class TenantLicenseMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const path = req.originalUrl.split('?')[0];

    const needsCheck = LICENSE_PROTECTED_PREFIXES.some((prefix) =>
      path.startsWith(prefix),
    );
    if (!needsCheck) return next();

    const tenantId =
      (req.query.tenantId as string) ||
      (req.body?.tenantId as string) ||
      undefined;

    if (!tenantId) return next();

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { isActive: true, expiresAt: true },
    });

    if (!tenant) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LICENSE_BLOCKED',
        message: LICENSE_BLOCKED_MESSAGE,
      });
    }

    const expired = new Date(tenant.expiresAt) < new Date();

    if (!tenant.isActive || expired) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LICENSE_BLOCKED',
        message: LICENSE_BLOCKED_MESSAGE,
      });
    }

    next();
  }
}
