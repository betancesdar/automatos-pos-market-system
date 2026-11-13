import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { EcfModule } from '../ecf/ecf.module';

@Module({
  imports: [EcfModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
