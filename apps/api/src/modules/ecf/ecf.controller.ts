import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { EcfService } from './ecf.service';
import { Roles } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

class UpsertEcfConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['sandbox', 'prod'])
  environment?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  /** Write-only: never returned by any endpoint. */
  @IsOptional()
  @IsString()
  clientSecret?: string;
}

@Controller('ecf')
export class EcfController {
  constructor(private readonly ecfService: EcfService) {}

  @Roles('ADMIN', 'ACCOUNTANT', 'SUPER_ADMIN')
  @Get('submissions')
  listSubmissions(@TenantId() tenantId: string, @Query('status') status?: string) {
    return this.ecfService.listSubmissions(tenantId, status);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('submissions/:id/retry')
  retry(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ecfService.retrySubmission(tenantId, id);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('config')
  getConfig(@TenantId() tenantId: string) {
    return this.ecfService.getConfig(tenantId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Put('config')
  upsertConfig(@TenantId() tenantId: string, @Body() body: UpsertEcfConfigDto) {
    return this.ecfService.upsertConfig(tenantId, body);
  }
}
