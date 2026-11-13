import { Module } from '@nestjs/common';
import { EcfController } from './ecf.controller';
import { EcfService } from './ecf.service';
import { PronesoftClient } from './pronesoft.client';

@Module({
  controllers: [EcfController],
  providers: [EcfService, PronesoftClient],
  exports: [EcfService],
})
export class EcfModule {}
