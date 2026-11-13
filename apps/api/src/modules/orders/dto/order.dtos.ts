import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { NcfType, PaymentMethod } from '@prisma/client';

export class OrderItemDto {
  @IsString()
  productId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsBoolean()
  isLoose?: boolean;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  clientRnc?: string;

  @IsOptional()
  @IsEnum(NcfType)
  ncfType?: NcfType;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateOrderDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  clientRnc?: string;

  @IsOptional()
  @IsEnum(NcfType)
  ncfType?: NcfType;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class OrderCheckoutDto {
  @IsNumber()
  @Min(0)
  cashReceived: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsEnum(NcfType)
  ncfType?: NcfType;

  @IsOptional()
  @IsBoolean()
  applyItbis?: boolean;

  @IsOptional()
  @IsString()
  clientRnc?: string;

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
