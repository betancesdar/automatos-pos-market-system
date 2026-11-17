import { Module } from '@nestjs/common';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';
import { AiAssistantClient } from './ai-assistant.client';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService, AiAssistantClient],
})
export class AiAssistantModule {}
