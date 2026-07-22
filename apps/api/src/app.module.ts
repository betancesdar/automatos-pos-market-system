import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { TenantLicenseMiddleware } from './common/tenant-license.middleware';
import { JwtAuthGuard } from './common/auth.guard';

@Module({
  imports: [
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    TenantLicenseMiddleware,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantLicenseMiddleware).forRoutes('*');
  }
}
