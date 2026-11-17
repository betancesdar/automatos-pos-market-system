import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../accounting/ledger.service';
import { Prisma } from '@prisma/client';
import {
  AiAssistantClient, type ChatMessage, type OllamaTool, type OllamaToolCall,
} from './ai-assistant.client';

const money = (n: Prisma.Decimal.Value | number) =>
  `RD$ ${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function monthDefaults(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

interface ToolDef {
  tool: OllamaTool;
  run: (tenantId: string, args: Record<string, unknown>) => Promise<unknown>;
}

@Injectable()
export class AiAssistantService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private client: AiAssistantClient,
  ) {}

  // ─────────────────────── Herramientas (deterministas) ───────────────────────

  private tools(): ToolDef[] {
    return [
      {
        tool: {
          type: 'function',
          function: {
            name: 'ventas_resumen',
            description: 'Total de ventas, número de transacciones e ITBIS cobrado en un rango de fechas. Úsalo para "¿cuánto vendí?".',
            parameters: {
              type: 'object',
              properties: {
                desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. Si no se da, el mes actual.' },
                hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD. Si no se da, hoy.' },
              },
            },
          },
        },
        run: async (tenantId, args) => {
          const { from, to } = this.range(args);
          const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999);
          const agg = await this.prisma.sale.aggregate({
            where: { tenantId, status: { not: 'VOIDED' }, createdAt: { gte: new Date(from), lte: toEnd } },
            _sum: { total: true, itbis: true },
            _count: true,
          });
          return {
            desde: from, hasta: to,
            total_ventas: money(agg._sum.total ?? 0),
            transacciones: agg._count,
            itbis_cobrado: money(agg._sum.itbis ?? 0),
          };
        },
      },
      {
        tool: {
          type: 'function',
          function: {
            name: 'cuentas_por_pagar',
            description: 'Saldo que el negocio le debe a proveedores. Si se indica un proveedor, da el saldo de ese; si no, el total general.',
            parameters: {
              type: 'object',
              properties: { proveedor: { type: 'string', description: 'Nombre (o parte) del proveedor. Opcional.' } },
            },
          },
        },
        run: async (tenantId, args) => {
          const proveedor = (args.proveedor as string | undefined)?.trim();
          if (proveedor) {
            const s = await this.prisma.supplier.findFirst({
              where: { tenantId, name: { contains: proveedor, mode: 'insensitive' } },
            });
            if (!s) return { encontrado: false, mensaje: `No se encontró el proveedor "${proveedor}".` };
            return { proveedor: s.name, saldo_por_pagar: money(s.balance) };
          }
          const agg = await this.prisma.supplier.aggregate({ where: { tenantId }, _sum: { balance: true } });
          return { total_por_pagar: money(agg._sum.balance ?? 0) };
        },
      },
      {
        tool: {
          type: 'function',
          function: {
            name: 'cuentas_por_cobrar',
            description: 'Saldo total que los clientes le deben al negocio (crédito/fiado).',
            parameters: { type: 'object', properties: {} },
          },
        },
        run: async (tenantId) => {
          const agg = await this.prisma.customer.aggregate({ where: { tenantId }, _sum: { balance: true } });
          const overdue = await this.prisma.creditSale.aggregate({
            where: { tenantId, status: 'OVERDUE' }, _sum: { balance: true },
          });
          return {
            total_por_cobrar: money(agg._sum.balance ?? 0),
            en_mora: money(overdue._sum.balance ?? 0),
          };
        },
      },
      {
        tool: {
          type: 'function',
          function: {
            name: 'estado_resultados',
            description: 'Ingresos, gastos y utilidad neta (ganancia) de un rango de fechas. Úsalo para "¿cuánto gané?", "¿cuál fue mi margen/utilidad?".',
            parameters: {
              type: 'object',
              properties: {
                desde: { type: 'string', description: 'YYYY-MM-DD. Si no se da, el mes actual.' },
                hasta: { type: 'string', description: 'YYYY-MM-DD. Si no se da, hoy.' },
              },
            },
          },
        },
        run: async (tenantId, args) => {
          const { from, to } = this.range(args);
          const is = await this.ledger.incomeStatement(tenantId, from, to);
          return {
            desde: from, hasta: to,
            ingresos: money(is.totalIncome),
            gastos: money(is.totalExpense),
            utilidad_neta: money(is.netIncome),
            nota: 'Requiere que los asientos del período estén generados en Contabilidad.',
          };
        },
      },
      {
        tool: {
          type: 'function',
          function: {
            name: 'inventario_bajo',
            description: 'Productos cuyo stock está en o por debajo del mínimo configurado (hay que reabastecer).',
            parameters: { type: 'object', properties: {} },
          },
        },
        run: async (tenantId) => {
          const rows = await this.prisma.$queryRaw<{ name: string; stock: number; quantityMin: number }[]>`
            SELECT name, stock, "quantityMin" FROM "Product"
            WHERE "tenantId" = ${tenantId} AND "quantityMin" > 0 AND stock <= "quantityMin"
            ORDER BY stock ASC LIMIT 25`;
          return {
            cantidad: rows.length,
            productos: rows.map((r) => ({ producto: r.name, stock: r.stock, minimo: r.quantityMin })),
          };
        },
      },
      {
        tool: {
          type: 'function',
          function: {
            name: 'productos_mas_vendidos',
            description: 'Los productos más vendidos (por cantidad) en un rango de fechas.',
            parameters: {
              type: 'object',
              properties: {
                desde: { type: 'string', description: 'YYYY-MM-DD. Si no se da, el mes actual.' },
                hasta: { type: 'string', description: 'YYYY-MM-DD. Si no se da, hoy.' },
              },
            },
          },
        },
        run: async (tenantId, args) => {
          const { from, to } = this.range(args);
          const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999);
          const grouped = await this.prisma.saleItem.groupBy({
            by: ['productId'],
            where: { sale: { tenantId, status: { not: 'VOIDED' }, createdAt: { gte: new Date(from), lte: toEnd } } },
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 5,
          });
          const ids = grouped.map((g) => g.productId);
          const products = await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
          const byId = new Map(products.map((p) => [p.id, p.name]));
          return {
            desde: from, hasta: to,
            top: grouped.map((g) => ({ producto: byId.get(g.productId) ?? 'Producto', unidades: g._sum.quantity ?? 0 })),
          };
        },
      },
    ];
  }

  private range(args: Record<string, unknown>): { from: string; to: string } {
    const d = monthDefaults();
    const from = typeof args.desde === 'string' && args.desde ? args.desde : d.from;
    const to = typeof args.hasta === 'string' && args.hasta ? args.hasta : d.to;
    return { from, to };
  }

  // ─────────────────────── Orquestación del chat ───────────────────────

  async health() {
    return { available: await this.client.health() };
  }

  async chat(tenantId: string, userName: string, history: { role: 'user' | 'assistant'; content: string }[], message: string) {
    if (!this.client.configured) {
      throw new ServiceUnavailableException('El asistente IA no está configurado en este servidor.');
    }
    if (!(await this.client.health())) {
      throw new ServiceUnavailableException('El asistente no está disponible ahora mismo. Intenta más tarde.');
    }

    const defs = this.tools();
    const toolList = defs.map((d) => d.tool);
    const toolMap = new Map(defs.map((d) => [d.tool.function.name, d]));

    const today = new Date().toISOString().slice(0, 10);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          `Eres "Automatos AI", el asistente del sistema Automatos para comercios en República Dominicana. ` +
          `Ayudas al dueño y al contador respondiendo sobre su negocio: ventas, inventario, cuentas por cobrar y pagar, y contabilidad.\n` +
          `REGLAS ESTRICTAS:\n` +
          `1. Para CUALQUIER cifra, monto o dato del negocio SIEMPRE llama una herramienta. NUNCA inventes ni estimes números.\n` +
          `2. Llama la herramienta DE INMEDIATO. NUNCA le pidas fechas ni datos al usuario: todos los parámetros son OPCIONALES y por defecto usan el mes actual. Si el usuario dice "este mes", "hoy", o no especifica, llama la herramienta SIN parámetros.\n` +
          `3. Si ninguna herramienta cubre la pregunta, dilo con honestidad en vez de inventar.\n` +
          `4. Después de recibir el resultado de la herramienta, redacta la respuesta final en español dominicano, clara y breve. Montos en RD$.\n` +
          `5. Hoy es ${today}. El usuario es ${userName}.`,
      },
      ...history.slice(-6).map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
      { role: 'user', content: message },
    ];

    // Hasta 4 rondas: el modelo pide datos (tools), nosotros ejecutamos, y redacta.
    for (let i = 0; i < 4; i++) {
      const res = await this.client.chat(messages, toolList);
      if (!res.toolCalls.length) {
        return { reply: res.content.trim() || 'No pude generar una respuesta.', available: true };
      }
      messages.push({ role: 'assistant', content: res.content ?? '', tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        const result = await this.runTool(tenantId, call);
        messages.push({ role: 'tool', tool_name: call.function.name, content: JSON.stringify(result) });
      }
    }
    // Si agotó las rondas, una última redacción sin tools.
    const final = await this.client.chat(messages, []);
    return { reply: final.content.trim() || 'No pude completar la respuesta.', available: true };
  }

  private async runTool(tenantId: string, call: OllamaToolCall): Promise<unknown> {
    const def = this.tools().find((d) => d.tool.function.name === call.function.name);
    if (!def) return { error: `Herramienta desconocida: ${call.function.name}` };
    try {
      let raw: unknown = call.function.arguments;
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { raw = {}; }
      }
      const args = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      return await def.run(tenantId, args);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Error ejecutando la consulta' };
    }
  }
}
