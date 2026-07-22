import { Module } from '@nestjs/common';
import { CashSessionController } from './cash-session.controller';
import { CashSessionService } from './cash-session.service';

@Module({
  controllers: [CashSessionController],
  providers: [CashSessionService],
  exports: [CashSessionService],
})
export class CashSessionModule {}
