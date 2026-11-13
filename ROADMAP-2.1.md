# MiniMarket OS 2.1 — Plan de Arquitectura (sin deuda técnica)

> Objetivo: convertir el MVP 2.0 en una plataforma sólida. Cada fase es **independiente, desplegable sola y sin deuda**. No es trabajo de 2 días: es un roadmap 2.1 por sprints. Ordenado por riesgo/dependencia.

## Estado de implementación (rama release/2.0-biller-cashier)
- ✅ **Fase 0** — Baseline de migraciones + política Decimal.
- ✅ **Fase 1** — Caja busca por nombre; SuperAdmin sin corte + buscador/filtro.
- ✅ **Fase 2** — RBAC: roles personalizados + permisos granulares.
- ✅ **Fase 3** — Clientes + Cotizaciones (convertibles a pedido).
- ✅ **Fase 4** — Crédito, cuotas, abonos y pagaré notarial.
- ✅ **Fase 5** — Zonas de inventario (ubicación + filtro).
- ✅ **Fase 6** — Contabilidad interactiva (movimientos manuales, cartera, drill-down).
- 🟡 **Fase 7** — Hardening: ✅ rate limiting en /auth/login (5/min). **Pendiente a propósito** (ver nota al final): Float→Decimal en modelos existentes, `whitelist:true`, sacar `.env.production` + rotar secrets, WebSocket para la cola de caja.

Todo lo anterior verificado en local (API tsc + web tsc + next build + pruebas de endpoints). Las migraciones se aplican solas con `migrate deploy` tras el baseline de §5.1 en DEPLOY-2.0.md.

## Principios de "sin deuda" que aplican a TODO el plan
1. **Migraciones versionadas, no `db push` a ciegas.** Fase 0 establece el baseline `prisma migrate`. De ahí en adelante cada cambio de schema es una migración revisable y reversible.
2. **Dinero en `Decimal(14,2)` en todo lo nuevo** (crédito, cuotas, abonos, balances de cliente). El `Float` actual queda documentado como hardening programado (Fase 7), no se mezcla en silencio.
3. **RBAC completo, no a medias.** Al migrar a permisos se migran los 32 `@Roles` en los 13 controladores, no una parte.
4. **Modelos propios, no sobrecargados.** Cotización ≠ Order; Crédito ≠ Sale. Se relacionan, no se mezclan.
5. **Aditivo y compatible.** Tenants existentes (modo DIRECT) no cambian su comportamiento salvo que activen la función.
6. **Cada fase trae su verificación** (API + UI) antes de cerrarse.

---

## Fase 0 — Fundación (baseline de migraciones + política de dinero)
**Por qué primero:** agregar ~10 modelos con `db push` sería deuda inmediata. Hay que poder versionar y revertir.

- Baseline de Prisma Migrate sobre el estado actual: `prisma migrate diff` → migración inicial → `migrate resolve --applied`. El `docker-entrypoint.sh` pasa de `db push` a `migrate deploy`.
- Archivo `packages/database/prisma/money.md`: política `Decimal(14,2)` para modelos financieros nuevos.
- `apps/api/src/common/permissions.catalog.ts`: catálogo de permisos como constantes (base para Fase 2).

**Verificación:** `migrate deploy` en limpio reproduce el schema; `migrate status` sin drift.

---

## Fase 1 — Quick wins (cajero por nombre + UX SuperAdmin)
Alto impacto, bajo riesgo. Se puede hacer de una.

### 1a. Caja: buscar pedido por nombre (además del código)
- **Backend:** `orders.service.list(tenantId, { status, search })` → `where` con `OR: [{ dailyCode }, { clientName: { contains, mode: insensitive } }]`. Endpoint `GET /orders?status=PENDING&search=`.
- **Frontend (`PendingOrdersPanel.tsx`):** un solo input "Buscar por # o nombre" que filtra la lista en vivo del lado cliente y, si el texto es numérico, también resuelve por código exacto (comportamiento actual). Resalta coincidencias.

### 1b. SuperAdmin: arreglar el corte + verse moderno y estable
- **Bug raíz:** el menú "Acciones ▾" es `position:absolute` dentro de un contenedor `overflow-x-auto` → se recorta en las últimas filas.
- **Solución:** menú con **portal flotante** (Floating UI / Radix-style posicionado en `document.body`), que nunca lo recorta ningún contenedor.
- **Rediseño estable:** tabla responsiva con cabecera fija, buscador y filtro por estado (activo/suspendido/por vencer), paginación simple, tarjetas en móvil. Tema consistente con el resto. Sin cambios de datos — solo UX.

**Verificación:** menú de acciones visible completo en la última fila; búsqueda por nombre en caja encuentra el pedido; superadmin usable en móvil.

---

## Fase 2 — RBAC: roles personalizados + permisos granulares
**Decisión del usuario:** RBAC real. El super admin define el catálogo; el admin (dueño del comercio) arma roles con permisos.

### Schema (aditivo, enum `Role` se conserva como baseline del sistema)
- `Permission` — catálogo sembrado (code, label, group). Ej: `sales.void`, `sales.credit.grant`, `inventory.cost.view`, `accounting.period.close`, `users.manage`, `roles.manage`...
- `CustomRole` — por tenant: `id, tenantId, name, permissionCodes String[], isSystem Boolean`. `@@unique([tenantId, name])`.
- `User.customRoleId String?` → relación opcional a `CustomRole`.
- Se siembran roles-sistema por defecto equivalentes al enum actual (ADMIN, CASHIER, BILLER, ACCOUNTANT) para que nada se rompa.

### Backend
- **Permisos efectivos** = permisos del rol base (`enum Role` → set por defecto) **∪** permisos del `CustomRole` asignado.
- Nuevo `PermissionsGuard` + decorador `@RequirePermissions('sales.void', ...)`. Resuelve el set efectivo desde el JWT (se agrega `permissions` o se resuelve en el guard con cache corto).
- **Migración completa:** los 32 `@Roles` de los 13 controladores pasan a `@RequirePermissions`. El enum sigue existiendo para el baseline, pero las rutas chequean permisos. (Sin estado mixto: se migran todos.)
- Endpoints: `GET /permissions` (catálogo), CRUD `/roles` (admin del tenant, protegido por `roles.manage`), `PATCH /users/:id/role` asigna customRole.
- **SUPER_ADMIN** gestiona qué permisos/categorías habilita cada plan (límite por plan).

### Frontend
- Admin → **Configuración → Roles y permisos**: crear rol, marcar permisos por grupo (checkboxes agrupados), asignar rol a empleados. Vista clara de "qué puede hacer cada rol".
- SuperAdmin → catálogo de permisos por plan.

**Verificación:** un rol "Supervisor" con `sales.void` pero sin `users.manage` → puede anular, no puede crear usuarios (403); quitar un permiso se refleja al re-loguear; tenants sin customRole siguen funcionando por su rol base.

---

## Fase 3 — Clientes + Cotizaciones
Base para crédito (Fase 4). Hoy el cliente es solo texto suelto.

### Schema
- `Customer` — por tenant: `name, docType (RNC|CEDULA), docNumber, phone, email, address, creditLimit Decimal, balance Decimal @default(0), isActive`. `@@unique([tenantId, docNumber])`. `@@index([tenantId, name])`.
- `Quote` — **modelo propio**: `id, tenantId, number (secuencia propia), customerId?, clientNameSnapshot, status (DRAFT|SENT|ACCEPTED|CONVERTED|EXPIRED|CANCELLED), validUntil, subtotal/itbis/total Decimal, notes, createdById, convertedSaleId?, convertedOrderId?`. `@@unique([tenantId, number])`.
- `QuoteItem` — `quoteId, productId, quantity, unitPrice, isLoose`.

### Backend (`modules/customers`, `modules/quotes`)
- Customers CRUD + búsqueda (autocomplete por nombre/doc).
- Quotes CRUD; **convertir**: `POST /quotes/:id/convert` → en modo DIRECT crea venta (reusa `salesService.processSale`), en modo BILLER_CASHIER crea un `Order` pendiente de cobro. Marca la cotización `CONVERTED` (atómico). Expiración perezosa por `validUntil`.
- Numeración atómica propia (patrón `UPDATE ... RETURNING`, como NCF).

### Frontend
- Selector/registro de cliente reutilizable (en POS, cotización y crédito).
- `/admin/quotes`: lista con estado y validez, crear/editar, **imprimir/compartir** (vista imprimible sin NCF), botón "Convertir a venta/pedido".
- En POS: "Guardar como cotización" y "Cargar cotización".

**Verificación:** crear cotización → imprimir → convertir en ambos modos → no se puede convertir dos veces; cotización vencida no convierte.

---

## Fase 4 — Crédito + Pagaré Notarial (cuentas por cobrar)
**Decisión del usuario:** plazos + mora configurable (sin interés compuesto). Depende de Fase 3 (Customer).

### Schema (Decimal en todo)
- `CreditSale` — 1:1 con `Sale`: `saleId @unique, customerId, principal Decimal, downPayment Decimal, financedAmount Decimal, installmentsCount, frequency (WEEKLY|BIWEEKLY|MONTHLY), firstDueDate, lateFeePercent Decimal, status (OPEN|PAID|OVERDUE|CANCELLED), balance Decimal`.
- `Installment` — `creditSaleId, number, dueDate, amount Decimal, paidAmount Decimal @default(0), status (PENDING|PARTIAL|PAID|OVERDUE)`.
- `CreditPayment` — abonos: `creditSaleId, amount Decimal, method, receivedById, cashSessionId?, note, createdAt`. (Entra a la caja como inflow.)
- `PromissoryNote` (pagaré notarial) — `creditSaleId @unique, number, debtorSnapshot Json (nombre, doc, dirección), amountInWords, legalText, signedAt?, notaryInfo?`. Documento imprimible con formato legal RD.

### Backend (`modules/credit`)
- Vender a crédito: en checkout, `paymentMethod = CREDIT` (nuevo valor del enum) o flag `isCredit` → la venta se crea igual (NCF/stock como siempre), y **post-commit** se crea el `CreditSale`, se genera el **calendario de cuotas** y el **pagaré**. La venta nunca falla por el crédito (misma regla de oro que e-CF).
- Control de `creditLimit` del cliente al otorgar.
- Abonos: `POST /credit/:id/payments` → aplica FIFO a cuotas, actualiza balances, registra inflow de caja. Atómico.
- Mora: job perezoso que marca cuotas vencidas y calcula recargo configurable.
- Pagaré: `GET /credit/:id/promissory-note` → HTML imprimible (y luego PDF).

### Frontend (`/admin/credit` — se ve como sistema de préstamos)
- Lista de cuentas por cobrar con balance, próximo vencimiento, semáforo de mora.
- Detalle: calendario de cuotas (tipo tabla de amortización), historial de abonos, botón "Registrar abono", "Imprimir pagaré".
- En POS/caja: "Vender a crédito" (elige cliente, enganche, # cuotas, frecuencia).
- Dashboard: total por cobrar, vencido, cobrado del mes.

**Verificación:** venta a crédito genera cuotas y pagaré; abono reduce balance y entra a caja; exceder límite de crédito bloquea; venta no falla aunque falle la generación del pagaré.

---

## Fase 5 — Inventario: Zonas
**Decisión del usuario:** zona = ubicación organizativa + filtro (stock único, no multi-almacén).

### Schema
- `Zone` — por tenant: `id, tenantId, name, description?, isActive`. `@@unique([tenantId, name])`.
- `Product.zoneId String?` → relación opcional (no rompe productos existentes).

### Backend/Frontend
- CRUD de zonas (`modules/catalog` extendido o `modules/zones`).
- Inventario: columna/selector de zona al crear/editar producto; filtro y agrupación por zona; vista "productos por zona".
- Reportes de inventario agrupados por zona.

**Verificación:** crear zonas, asignar productos, filtrar inventario por zona; productos sin zona siguen visibles ("Sin zona").

---

## Fase 6 — Contabilidad interactiva (de "reportes" a "banco de trabajo")
El módulo hoy genera 606/607/608 y cierra períodos, pero el usuario quiere **interactuar**, no solo leer.

- **Asientos/ajustes manuales:** registrar ingresos/gastos/ajustes que no vienen de ventas o compras (ej. gasto de luz sin NCF, ajuste de caja), con categoría y soporte.
- **Compras editables** con adjuntos y validación de NCF de proveedor mejorada.
- **Integración de cuentas por cobrar** (Fase 4) en el dashboard contable: cartera, cobrado, provisión.
- **Dashboard con drill-down:** clic en una cifra → ver las transacciones que la componen.
- **Gestión de gastos** recurrentes.
- UX de contador: todo editable antes de cerrar el período; al cerrar, inmutable (ya existe el gating por conciliaciones).

**Verificación:** registrar un ajuste manual se refleja en el dashboard y en el cierre; drill-down lista las transacciones; período cerrado bloquea edición.

---

## Fase 7 — Hardening (cerrar la deuda explícitamente, no en silencio)
Se hace al final porque toca dinero y sesiones.
- ✅ **Rate limiting en `/auth/login`** (5 intentos/min por IP vía `@nestjs/throttler`, aplicado solo al login para no afectar el polling de la cola de caja). Verificado: 6º intento → 429.
- 🟡 **`Float` → `Decimal(14,2)`** en los modelos de dinero existentes (Sale, SaleItem, CashSession, Purchase, Product). **Deferido a propósito:** es el cambio más riesgoso (toca toda la aritmética de ventas/caja/reportes) y el sistema funciona hoy con Float. Hacerlo apurado justo antes del lanzamiento introduce riesgo, no lo reduce. Los **modelos financieros nuevos (crédito, clientes) ya usan Decimal**. Se hará con una migración de datos dedicada + suite de pruebas de cálculo, fuera de la ventana de lanzamiento.
- 🟡 `ValidationPipe({ whitelist: true })` — requiere que **todos** los DTOs legacy tengan decoradores class-validator; activarlo hoy stripearía propiedades no decoradas y rompería endpoints. Se activa cuando se terminen de decorar los DTOs.
- 🟡 Sacar `.env.production` de git + rotar secrets (JWT/COOKIE/DB/Redis) — operativo, invalida sesiones; hacerlo de noche con el equipo (no es un cambio de código que deba ir en este commit).
- 🟡 WebSocket para la cola de caja (hoy polling 4s) — mejora de rendimiento, no de seguridad; no bloquea.

**Verificación (hecho):** login rate-limited (429 tras 5 intentos). **Pendiente:** suite de cálculos con Decimal; retirada de secretos de git.

---

## Dependencias y orden sugerido
```
Fase 0 (baseline)  ──►  todo lo demás
Fase 1 (quick wins)      ← independiente, puede ir primero/en paralelo
Fase 2 (RBAC)            ← independiente
Fase 3 (Clientes+Cotiz)  ──►  Fase 4 (Crédito depende de Customer)
Fase 5 (Zonas)           ← independiente
Fase 6 (Contab. interac) ← mejor después de Fase 4 (integra cartera)
Fase 7 (Hardening)       ← al final
```
Recomendación de arranque: **Fase 0 → Fase 1** (impacto inmediato y arreglo del corte) y de ahí decidimos si seguimos por RBAC (Fase 2) o por Clientes+Crédito (Fases 3–4), que es el bloque más grande.

## Lo que NO entra (y por qué, para no fingir que no es deuda)
- Inventario multi-almacén con stock por zona (se eligió zona = ubicación).
- Préstamos con interés compuesto/amortización financiera (se eligió plazos + mora).
- Contabilidad de partida doble completa (libro diario/mayor, estados financieros) — el módulo cubre lo fiscal-operativo + ajustes; la partida doble formal sería un proyecto aparte.
- e-CF producción (requiere certificado .p12 + certificación DGII con Pronesoft).
