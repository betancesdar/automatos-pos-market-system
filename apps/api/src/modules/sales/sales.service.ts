import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NcfType } from '@prisma/client';

const ITBIS_RATE = 0.18;

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async checkout(tenantId: string, data: { items: { productId: string; quantity: number }[]; cashReceived: number; ncfType: NcfType; clientRnc?: string }) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Calculate total and check stock
      let total = 0;
      const saleItemsData: { productId: string; quantity: number; price: number; cost: number }[] = [];

      for (const item of data.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || product.tenantId !== tenantId) throw new BadRequestException(`Product ${item.productId} not found`);
        if (product.stock < item.quantity) throw new BadRequestException(`Insufficient stock for ${product.name}`);

        total += product.price * item.quantity;
        
        saleItemsData.push({
          productId: product.id,
          quantity: item.quantity,
          price: product.price,
          cost: product.cost,
        });

        // Deduct stock
        await tx.product.update({
          where: { id: product.id },
          data: { stock: product.stock - item.quantity },
        });
      }

      if (data.cashReceived < total) throw new BadRequestException('Cash received is less than total');
      const changeDue = data.cashReceived - total;

      let itbis = 0;
      if (data.ncfType === NcfType.CREDITO_FISCAL || data.ncfType === NcfType.GUBERNAMENTAL) {
        const taxableAmount = total / (1 + ITBIS_RATE);
        itbis = parseFloat((total - taxableAmount).toFixed(2));
      }

      // 2. Generate NCF
      let ncf: string | null = null;
      if (data.ncfType === NcfType.CREDITO_FISCAL) {
        if (!data.clientRnc || (data.clientRnc.length !== 9 && data.clientRnc.length !== 11)) {
          throw new BadRequestException('Valid RNC is required for CREDITO_FISCAL (9 or 11 digits)');
        }
      }

      const seq = await tx.nCFSequence.findUnique({
        where: { tenantId_type: { tenantId, type: data.ncfType } }
      });

      if (seq) {
        // Format NCF (e.g., B0200000001)
        ncf = `${seq.prefix}${seq.nextValue.toString().padStart(8, '0')}`;
        await tx.nCFSequence.update({
          where: { id: seq.id },
          data: { nextValue: seq.nextValue + 1 },
        });
      }

      // 3. Create Sale
      const sale = await tx.sale.create({
        data: {
          tenantId,
          total,
          cashReceived: data.cashReceived,
          changeDue,
          ncf,
          ncfType: data.ncfType,
          clientRnc: data.clientRnc,
          itbis,
          items: {
            create: saleItemsData,
          },
        },
        include: { items: { include: { product: true } }, tenant: true },
      });

      // 4. Generate ESC/POS raw commands
      const receiptRaw = this.generateEscPosReceipt(sale);

      return {
        sale,
        receiptRaw,
      };
    });
  }

  private generateEscPosReceipt(sale: any): string {
    // ESC/POS Commands
    const ESC = '\x1b';
    const GS = '\x1d';
    const INIT = `${ESC}@`; // Initialize printer
    const ALIGN_CENTER = `${ESC}a1`;
    const ALIGN_LEFT = `${ESC}a0`;
    const BOLD_ON = `${ESC}E1`;
    const BOLD_OFF = `${ESC}E0`;
    const DOUBLE_HEIGHT = `${GS}!\x11`;
    const NORMAL_SIZE = `${GS}!\x00`;
    const CUT_PAPER = `${GS}V\x41\x03`; // Partial cut
    const OPEN_DRAWER = `${ESC}p0\x19\xFA`; // ESC p 0 25 250 (Pin 2, 25ms on, 250ms off)

    let receipt = '';
    receipt += INIT;
    receipt += ALIGN_CENTER;
    receipt += BOLD_ON + DOUBLE_HEIGHT;
    receipt += `${sale.tenant.name}\n`;
    receipt += NORMAL_SIZE + BOLD_OFF;
    if (sale.tenant.rnc) receipt += `RNC: ${sale.tenant.rnc}\n`;
    if (sale.tenant.phone) receipt += `Tel: ${sale.tenant.phone}\n`;
    if (sale.tenant.address) receipt += `${sale.tenant.address}\n`;
    
    receipt += `--------------------------------\n`;
    receipt += `NCF: ${sale.ncf || 'N/A'}\n`;
    receipt += `Tipo: ${sale.ncfType}\n`;
    if (sale.clientRnc) receipt += `Cliente RNC: ${sale.clientRnc}\n`;
    receipt += `Fecha: ${sale.createdAt.toLocaleString()}\n`;
    receipt += `--------------------------------\n`;
    
    receipt += ALIGN_LEFT;
    receipt += `Cant   Descripcion        Importe\n`;
    
    for (const item of sale.items) {
      const name = item.product.name.substring(0, 16).padEnd(16, ' ');
      const qty = item.quantity.toString().padEnd(4, ' ');
      const price = (item.price * item.quantity).toFixed(2).padStart(8, ' ');
      receipt += `${qty} ${name} ${price}\n`;
    }
    
    receipt += `--------------------------------\n`;
    receipt += ALIGN_CENTER;
    receipt += DOUBLE_HEIGHT + BOLD_ON;
    receipt += `TOTAL: RD$ ${sale.total.toFixed(2)}\n`;
    receipt += NORMAL_SIZE + BOLD_OFF;
    
    receipt += ALIGN_LEFT;
    receipt += `Efectivo: RD$ ${sale.cashReceived.toFixed(2)}\n`;
    receipt += `Devuelta: RD$ ${sale.changeDue.toFixed(2)}\n`;
    receipt += `\n\n`;
    receipt += ALIGN_CENTER;
    receipt += `GRACIAS POR SU COMPRA\n`;
    
    // Add drawer kick and cut
    receipt += OPEN_DRAWER;
    receipt += CUT_PAPER;

    // Base64 encode the raw string to safely transmit over JSON
    return Buffer.from(receipt, 'ascii').toString('base64');
  }
}
