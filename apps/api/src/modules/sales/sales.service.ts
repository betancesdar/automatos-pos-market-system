import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NcfType, PaymentMethod } from '@prisma/client';

const ITBIS_RATE = 0.18;

const NCF_GENERATING_TYPES: NcfType[] = [
  NcfType.CONSUMIDOR_FINAL,
  NcfType.CREDITO_FISCAL,
  NcfType.GUBERNAMENTAL,
  NcfType.REGISTRO_UNICO_INGRESO,
];

interface CheckoutItem {
  productId: string;
  quantity: number;
  unitPrice?: number;
  isLoose?: boolean;
}

interface CheckoutData {
  items: CheckoutItem[];
  cashReceived: number;
  ncfType: NcfType;
  applyItbis?: boolean;
  clientRnc?: string;
  paymentMethod?: PaymentMethod;
  discountAmount?: number;
}

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async checkout(tenantId: string, data: CheckoutData) {
    return this.prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const saleItemsData: {
        productId: string;
        quantity: number;
        price: number;
        cost: number;
        isLoose: boolean;
      }[] = [];

      for (const item of data.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || product.tenantId !== tenantId) {
          throw new BadRequestException(`Product ${item.productId} not found`);
        }

        const unitPrice = item.unitPrice ?? product.price;
        const qty = item.quantity;
        const isLoose = item.isLoose ?? unitPrice !== product.price;
        const lineTotal = unitPrice * qty;

        if (!isLoose && product.stock < Math.ceil(qty)) {
          throw new BadRequestException(`Insufficient stock for ${product.name}`);
        }

        subtotal += lineTotal;
        saleItemsData.push({
          productId: product.id,
          quantity: qty,
          price: unitPrice,
          cost: product.cost,
          isLoose,
        });

        if (!isLoose && qty > 0) {
          const stockDeduct = Math.ceil(qty);
          await tx.product.update({
            where: { id: product.id },
            data: { stock: Math.max(0, product.stock - stockDeduct) },
          });
        }
      }

      subtotal = parseFloat(subtotal.toFixed(2));

      const discount = Math.min(Math.max(data.discountAmount ?? 0, 0), subtotal);
      const netSubtotal = parseFloat((subtotal - discount).toFixed(2));

      let itbis = 0;
      const shouldApplyItbis = data.applyItbis ?? false;
      if (shouldApplyItbis) {
        const taxableAmount = netSubtotal / (1 + ITBIS_RATE);
        itbis = parseFloat((netSubtotal - taxableAmount).toFixed(2));
      }

      const total = netSubtotal;
      const paymentMethod = data.paymentMethod ?? PaymentMethod.CASH;

      if (paymentMethod === PaymentMethod.CASH && data.cashReceived < total) {
        throw new BadRequestException('Cash received is less than total');
      }

      const cashReceived = paymentMethod === PaymentMethod.CASH ? data.cashReceived : total;
      const changeDue = parseFloat((cashReceived - total).toFixed(2));

      if (data.ncfType === NcfType.CREDITO_FISCAL) {
        const rnc = data.clientRnc?.replace(/\D/g, '') ?? '';
        if (rnc.length !== 9 && rnc.length !== 11) {
          throw new BadRequestException('Valid RNC is required for CREDITO_FISCAL (9 or 11 digits)');
        }
      }

      let ncf: string | null = null;
      if (NCF_GENERATING_TYPES.includes(data.ncfType)) {
        const seq = await tx.nCFSequence.findUnique({
          where: { tenantId_type: { tenantId, type: data.ncfType } },
        });
        if (seq) {
          ncf = `${seq.prefix}${seq.nextValue.toString().padStart(8, '0')}`;
          await tx.nCFSequence.update({
            where: { id: seq.id },
            data: { nextValue: seq.nextValue + 1 },
          });
        }
      }

      const sale = await tx.sale.create({
        data: {
          tenantId,
          subtotal,
          total,
          cashReceived,
          changeDue,
          ncf,
          ncfType: data.ncfType,
          clientRnc: data.clientRnc?.replace(/\D/g, '') || null,
          itbis,
          applyItbis: shouldApplyItbis,
          paymentMethod,
          items: { create: saleItemsData },
        },
        include: { items: { include: { product: true } }, tenant: true },
      });

      const receiptRaw = this.generateEscPosReceipt(sale);
      return { sale, receiptRaw };
    });
  }

  private generateEscPosReceipt(sale: any): string {
    const ESC = '\x1b';
    const GS = '\x1d';
    const INIT = `${ESC}@`;
    const ALIGN_CENTER = `${ESC}a1`;
    const ALIGN_LEFT = `${ESC}a0`;
    const BOLD_ON = `${ESC}E1`;
    const BOLD_OFF = `${ESC}E0`;
    const DOUBLE_HEIGHT = `${GS}!\x11`;
    const NORMAL_SIZE = `${GS}!\x00`;
    const CUT_PAPER = `${GS}V\x41\x03`;
    const OPEN_DRAWER = `${ESC}p0\x19\xFA`;

    let receipt = '';
    receipt += INIT + ALIGN_CENTER + BOLD_ON + DOUBLE_HEIGHT;
    receipt += `${sale.tenant.name}\n`;
    receipt += NORMAL_SIZE + BOLD_OFF;
    if (sale.tenant.rnc) receipt += `RNC: ${sale.tenant.rnc}\n`;
    receipt += '--------------------------------\n';
    receipt += `NCF: ${sale.ncf || 'N/A'}\n`;
    receipt += `Tipo: ${sale.ncfType}\n`;
    if (sale.clientRnc) receipt += `Cliente RNC: ${sale.clientRnc}\n`;
    if (sale.applyItbis) receipt += `ITBIS: RD$ ${sale.itbis.toFixed(2)}\n`;
    receipt += `Pago: ${sale.paymentMethod}\n`;
    receipt += `Fecha: ${sale.createdAt.toLocaleString()}\n`;
    receipt += '--------------------------------\n';
    receipt += ALIGN_LEFT + 'Cant   Descripcion        Importe\n';

    for (const item of sale.items) {
      const name = item.product.name.substring(0, 16).padEnd(16, ' ');
      const qty = item.quantity.toFixed(2).padEnd(4, ' ');
      const price = (item.price * item.quantity).toFixed(2).padStart(8, ' ');
      receipt += `${qty} ${name} ${price}\n`;
    }

    receipt += '--------------------------------\n' + ALIGN_CENTER + DOUBLE_HEIGHT + BOLD_ON;
    receipt += `TOTAL: RD$ ${sale.total.toFixed(2)}\n`;
    receipt += NORMAL_SIZE + BOLD_OFF + ALIGN_LEFT;
    receipt += `Recibido: RD$ ${sale.cashReceived.toFixed(2)}\n`;
    receipt += `Devuelta: RD$ ${sale.changeDue.toFixed(2)}\n\n`;
    receipt += ALIGN_CENTER + 'GRACIAS POR SU COMPRA\n';
    receipt += OPEN_DRAWER + CUT_PAPER;

    return Buffer.from(receipt, 'ascii').toString('base64');
  }
}
