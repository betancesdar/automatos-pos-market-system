import {
  Injectable,
  NestMiddleware,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  LICENSE_BLOCKED_MESSAGE,
  COOKIE_NAMES,
  verifyToken,
} from '../common/jwt.util';

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
  '/orders',
  '/accounting',
  '/ecf',
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

    // Resolve the tenant primarily from the JWT (authoritative); fall back to
    // the legacy query/body params only when no token is present.
    const tenantId =
      this.tenantIdFromToken(req) ||
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

  private tenantIdFromToken(req: Request): string | undefined {
    try {
      const auth = req.headers.authorization;
      const token = auth?.startsWith('Bearer ')
        ? auth.slice(7)
        : (req.cookies as Record<string, string> | undefined)?.[
            COOKIE_NAMES.accessToken
          ];
      if (!token) return undefined;
      const payload = verifyToken(token);
      // SUPER_ADMIN has no tenant; license checks don't apply to them.
      return payload.tenantId ?? undefined;
    } catch {
      return undefined;
    }
  }
}
