import {
  Controller, Get, Post, Body, Req, UseGuards, BadRequestException,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AiAssistantService } from './ai-assistant.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import type { TokenPayload } from '../../common/jwt.util';

interface ChatDto {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

interface UploadedFileType {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
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

  @RequirePermissions('purchases.manage')
  @Post('scan-invoice')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  scanInvoice(@TenantId() tenantId: string, @UploadedFile() file?: UploadedFileType) {
    if (!file) throw new BadRequestException('Sube una foto o imagen de la factura.');
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Solo se aceptan imágenes (JPG, PNG). Para PDF/Excel usa el importador de Compras.');
    }
    return this.ai.scanInvoice(tenantId, file.buffer.toString('base64'));
  }
}
