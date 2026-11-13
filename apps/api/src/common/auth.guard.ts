import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { verifyToken, COOKIE_NAMES, TokenPayload } from '../common/jwt.util';
import { effectivePermissions, hasAnyPermission } from './permissions.catalog';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const IS_PUBLIC_KEY = 'isPublic';

/** Protege una ruta: el usuario debe tener AL MENOS UNO de los permisos listados. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const payload = verifyToken(token);
      (request as Request & { user: TokenPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    const cookies = req.cookies as Record<string, string> | undefined;
    return cookies?.[COOKIE_NAMES.accessToken];
  }
}

/**
 * Autorización por permisos (RBAC). Resuelve el set efectivo del usuario desde
 * `token.permissions` (sembrado al login/impersonación). Para tokens antiguos sin
 * ese campo, cae a `ROLE_DEFAULTS[role]` — misma semántica, sin lookup a DB.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true; // ruta solo requiere autenticación

    const request = context.switchToHttp().getRequest<Request & { user?: TokenPayload }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const granted =
      user.permissions && user.permissions.length
        ? user.permissions
        : effectivePermissions(user.role);

    if (!hasAnyPermission(granted, required)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
