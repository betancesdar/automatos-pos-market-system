import { Controller, Get, Post, Body, Req, UseGuards, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { AiAssistantService } from './ai-assistant.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import type { TokenPayload } from '../../common/jwt.util';

interface ChatDto {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

@Controller('ai-assistant')
@UseGuards(JwtAuthGuard)
export class AiAssistantController {
  constructor(private readonly ai: AiAssistantService) {}

  @RequirePermissions('ai.chat')
  @Get('health')
  health() {
    return this.ai.health();
  }

  @RequirePermissions('ai.chat')
  @Post('chat')
  chat(
    @TenantId() tenantId: string,
    @Body() body: ChatDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    const message = body.message?.trim();
    if (!message) throw new BadRequestException('Escribe una pregunta.');
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    return this.ai.chat(tenantId, req.user.username, history, message);
  }
}
