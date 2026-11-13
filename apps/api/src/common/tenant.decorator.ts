import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import type { TokenPayload } from './jwt.util';

/**
 * Resolves the tenantId for the request from the authenticated JWT, never
 * from client-supplied input (except for SUPER_ADMIN, who may target any
 * tenant explicitly via the `tenantId` query param).
 *
 * This closes the cross-tenant hole where any authenticated user could read
 * or write another tenant's data by changing `?tenantId=`.
 *
 * Impersonation keeps working: impersonation tokens are minted with
 * role ADMIN + the target tenantId, so they resolve to the impersonated
 * tenant like any regular user.
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: TokenPayload }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.role === 'SUPER_ADMIN') {
      const queryTenantId = request.query?.tenantId;
      if (typeof queryTenantId === 'string' && queryTenantId) {
        return queryTenantId;
      }
      throw new ForbiddenException(
        'SUPER_ADMIN must specify a tenantId query param for tenant-scoped endpoints',
      );
    }

    if (!user.tenantId) {
      throw new ForbiddenException('User is not associated with a tenant');
    }

    return user.tenantId;
  },
);
