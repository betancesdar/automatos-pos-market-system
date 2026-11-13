import { Global, Module, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface AuditActor {
  sub: string;
  username: string;
}

/**
 * Fire-and-forget audit trail. Never throws — an audit failure must not
 * break the business action being audited.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  log(
    actor: AuditActor,
    action: string,
    targetTenantId?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    this.prisma.auditLog
      .create({
        data: {
          actorUserId: actor.sub,
          actorUsername: actor.username,
          action,
          targetTenantId: targetTenantId ?? null,
          metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      })
      .catch((err) => {
        this.logger.warn(`Audit log failed for ${action}: ${err instanceof Error ? err.message : err}`);
      });
  }

  list(filters: { tenantId?: string; limit?: number }) {
    return this.prisma.auditLog.findMany({
      where: filters.tenantId ? { targetTenantId: filters.tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit ?? 100, 500),
    });
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
