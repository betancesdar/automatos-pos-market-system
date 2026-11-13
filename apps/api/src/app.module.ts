import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { SalesModule } from './modules/sales/sales.module';
import { FinanceModule } from './modules/finance/finance.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UsersModule } from './modules/users/users.module';
import { SuperadminModule } from './modules/superadmin/superadmin.module';
import { CashSessionModule } from './modules/cash-session/cash-session.module';
import { ReportsModule } from './modules/reports/reports.module';
import { OrdersModule } from './modules/orders/orders.module';
import { EcfModule } from './modules/ecf/ecf.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { RolesModule } from './modules/roles/roles.module';
import { AuditModule } from './common/audit.module';
import { TenantLicenseMiddleware } from './common/tenant-license.middleware';
import { JwtAuthGuard, PermissionsGuard } from './common/auth.guard';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    CatalogModule,
    CategoriesModule,
    SalesModule,
    FinanceModule,
    AnalyticsModule,
    TenantModule,
    UsersModule,
    SuperadminModule,
    CashSessionModule,
    ReportsModule,
    OrdersModule,
    EcfModule,
    AccountingModule,
    RolesModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    TenantLicenseMiddleware,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantLicenseMiddleware).forRoutes('*');
  }
}
