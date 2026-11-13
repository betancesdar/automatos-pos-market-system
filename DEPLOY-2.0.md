# MiniMarket OS 2.0 — Guía de Despliegue

Rama: `release/2.0-biller-cashier`. Cambios de schema **aditivos** (compatibles con `prisma db push`).

## 1. Pre-deploy (OBLIGATORIO, contra la DB de producción)

### a. Verificar NCF duplicados (el nuevo unique `Sale(tenantId, ncf)` fallaría si existen)
```sql
SELECT "tenantId", ncf, count(*) FROM "Sale"
WHERE ncf IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
```
Si devuelve filas, renombrar los duplicados antes del deploy (conservando el original más antiguo):
```sql
UPDATE "Sale" s SET ncf = s.ncf || '-DUP-' || substr(s.id, 1, 4)
WHERE s.id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY "tenantId", ncf ORDER BY "createdAt") rn
    FROM "Sale" WHERE ncf IS NOT NULL
  ) t WHERE rn > 1
);
```

### b. Variable de entorno nueva
```
ECF_SECRET_KEY=<cadena larga aleatoria>   # cifra los clientSecret de Pronesoft (AES-256-GCM)
# Opcionales:
# PRONESOFT_PROD_URL / PRONESOFT_SANDBOX_URL / PRONESOFT_PROD_ENV_PATH / PRONESOFT_SANDBOX_ENV_PATH
```

## 2. Deploy
El `docker-entrypoint.sh` ya corre `prisma db push` — los cambios son aditivos. Después del push, **backfill del contador de facturas** (una sola vez):
```sql
UPDATE "Tenant" t SET "invoiceCounter" = (SELECT count(*) FROM "Sale" s WHERE s."tenantId" = t.id)
WHERE t."invoiceCounter" = 0;
```
(Sin esto, las facturas nuevas chocarían con `INV-xxxxx` existentes.)

## 3. Configurar el minimarket nuevo (flujo Facturador + Caja)
1. SuperAdmin → tenant → **Acciones → Detalles & Config → Plan & Modo** → "Facturador + Caja".
2. **Fiscal**: crear secuencias NCF (CONSUMIDOR_FINAL `B02`, CREDITO_FISCAL `B01`, etc.).
3. **Fiscal → e-CF**: pegar clientId/clientSecret de Pronesoft sandbox y habilitar (opcional).
4. Admin del tenant → Configuración → Empleados: crear 2 usuarios **FACTURADOR** y 1 **CAJA** (CASHIER). Opcional: 1 **CONTABLE**.

## 4. Flujo operativo
- Facturador: arma el carrito → "Enviar a Caja" (F12) → le dice al cliente su **#código** (y nombre). Requiere internet.
- Caja: ve la cola en vivo (refresco 4 s), busca por código o nombre, ajusta si hace falta y cobra (ahí se genera NCF, factura y se descuenta stock, todo atómico). El doble cobro simultáneo del mismo pedido devuelve 409.
- Pedidos no cobrados expiran automáticamente al día siguiente.
- Tenants en modo DIRECT: cero cambios.

## 5. Verificación post-deploy (checklist)
- [ ] 20 checkouts paralelos → 0 NCF/invoice duplicados: `SELECT ncf, count(*) FROM "Sale" GROUP BY 1 HAVING count(*)>1;`
- [ ] 2 facturadores simultáneos → códigos #001/#002 distintos.
- [ ] Doble cobro del mismo pedido → exactamente 1 venta (la otra pestaña recibe 409).
- [ ] Producto stock=1 facturado 2 veces → el segundo cobro falla con "Stock insuficiente", pedido queda PENDING.
- [ ] Token de tenant A con `?tenantId=B` → devuelve datos de A (cross-tenant cerrado).
- [ ] CASHIER no puede crear usuarios (403); BILLER no puede cobrar (403).
- [ ] Venta offline + sync sigue funcionando (modo DIRECT).
- [ ] e-CF sandbox: venta fiscal → submission QUEUED → SENT con trackId en ≤30 s (pestaña Contabilidad → e-CF). Con credenciales inválidas la venta se completa igual.
- [ ] Cerrar caja con diferencia → aparece en Contabilidad → Conciliaciones como PENDIENTE.
- [ ] Reportes 606/607/608 descargan TXT; cierre mensual exige conciliaciones revisadas.

## 5.1 Despliegue 2.1 — PASO CRÍTICO antes del primer `migrate deploy`
La versión 2.1 cambia el entrypoint de `prisma db push` a **`prisma migrate deploy`**.
Como la DB de producción venía de `db push` (sin historial de migraciones), el primer
`migrate deploy` intentaría correr `0_init` sobre tablas que YA existen y fallaría.
**Antes de desplegar 2.1, baseline la DB de producción una sola vez:**
```sh
cd packages/database
npx prisma migrate resolve --applied 0_init
# (si la 2.0 ya estaba en prod; marca el esquema actual como el baseline)
```
Después, `migrate deploy` aplicará solo `20261113141254_rbac_custom_roles` (aditiva:
crea `CustomRole` + `User.customRoleId`, no toca datos). Verificar con `migrate status`.

Nota RBAC: los permisos van embebidos en el JWT; **los usuarios deben re-loguearse**
tras el deploy para recibir sus permisos (los tokens viejos caen a los permisos del
rol base automáticamente, así que nada se rompe mientras tanto).

## 5.2 e-CF Pronesoft (implementación real, docs.ecf.pronesoft.com)
Autenticación **OAuth 2.0 client credentials** (no API key). El `clientId`/`clientSecret`
se crean en el portal de Pronesoft (sección **Apps → Crear App**), sandbox y producción
por separado.
- **Sandbox**: portal https://ecf.sandbox.pronesoft.com · API `https://api.ecf.sandbox.pronesoft.com/api/v1` · ambiente `TesteCF` (va en la URL). RNC de prueba con prefijo `SBX`, sin certificado.
- **Producción**: API `https://api.ecf.pronesoft.com/api/v1` · ambiente `eCF`. **Requiere subir el certificado digital .p12/.pfx** de la DGII vía `POST /{rnc}/certificates` (multipart `file` + `password`) y administrar las secuencias de e-NCF en el portal. Sin certificado no se puede emitir en producción.
- Configurar por tenant: SuperAdmin → tenant → Detalles & Config → Fiscal → e-CF (clientId/clientSecret, ambiente), o `PUT /ecf/config`.
- **Qué llama a Pronesoft**: solo ventas con comprobante fiscal (CONSUMIDOR_FINAL→e-CF 32, CREDITO_FISCAL→31, GUBERNAMENTAL→45, REGISTRO_UNICO_INGRESO→32). Las ventas de **contado sin comprobante** (VENTA_RAPIDA) y SIN_NCF **no** llaman a la API. La venta nunca falla por e-CF (cola + reintentos + consulta de estado DGII).
- Variable `ECF_SECRET_KEY` cifra los clientSecret (AES-256-GCM).

## 6. Pendiente / deuda técnica (no bloquea el lanzamiento)
- `.env.production` sigue en git → sacarlo (`git rm --cached`) y **rotar JWT_SECRET/COOKIE_SECRET/DB/Redis** (rotar JWT invalida sesiones: hacerlo de noche).
- ~~Migrar `db push` → `prisma migrate`~~ ✅ hecho en 2.1 (baseline `0_init`). Ver §5.1.
- Float → Decimal en montos; enums para `Sale.status`/`CashSession.status`; throttler en `/auth/login`; `ValidationPipe whitelist:true` cuando todos los DTOs estén decorados.
- e-CF producción: requiere certificado digital .p12 del contribuyente + certificación DGII (proceso con Pronesoft). El layout exacto de columnas 606/607/608 debe validarlo el contable contra la herramienta de envío de la DGII antes de la primera presentación.
- Token de impersonación en localStorage; refactor de `pos/page.tsx`; WebSocket para la cola de caja (hoy polling 4 s).
