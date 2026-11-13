# Política de tipos de dinero

**Regla:** todo campo monetario **nuevo** usa `Decimal @db.Decimal(14, 2)` en Prisma
(tipo `Prisma.Decimal` / `Decimal` en TS), nunca `Float`.

Motivo: `Float` (double) no representa exactamente valores decimales y acumula
error de centavos en sumas de cuotas, abonos y balances. En un módulo de crédito /
cuentas por cobrar eso es inaceptable.

## Aplicación
- **Modelos financieros nuevos** (Customer.balance/creditLimit, CreditSale, Installment,
  CreditPayment, etc.): `Decimal(14,2)` desde el día 1. ✅
- **Aritmética:** usar `Prisma.Decimal` (o `decimal.js`) para sumar/restar; nunca
  convertir a `number` para operar con dinero.

## Deuda conocida (programada, no silenciosa)
Los modelos existentes (`Sale`, `SaleItem`, `CashSession`, `CashMovement`, `Purchase`,
`Product.price/cost/basePrice`) usan `Float`. Su migración a `Decimal` está planificada
en la **Fase 7 (Hardening)** del `ROADMAP-2.1.md`, con migración de datos y ajuste de la
aritmética de ventas. No se mezcla en silencio: hasta entonces esos campos siguen en
`Float` y los nuevos en `Decimal`.
