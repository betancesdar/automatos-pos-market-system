import { Module } from '@nestjs/common';
import { SuperadminController } from './superadmin.controller';
import { SuperadminService } from './superadmin.service';
import { EcfModule } from '../ecf/ecf.module';

@Module({
  imports: [EcfModule],
  controllers: [SuperadminController],
  providers: [SuperadminService],
})
export class SuperadminModule {}
