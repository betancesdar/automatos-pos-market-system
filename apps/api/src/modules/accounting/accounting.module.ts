import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  controllers: [AccountingController, LedgerController],
  providers: [AccountingService, LedgerService],
  exports: [AccountingService, LedgerService],
})
export class AccountingModule {}
