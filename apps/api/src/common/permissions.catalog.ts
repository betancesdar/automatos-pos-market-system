/**
 * RBAC — catálogo de permisos (fuente única de verdad).
 *
 * El catálogo vive en código (no en una tabla) para evitar drift entre constantes
 * y datos. Los `CustomRole.permissionCodes` referencian estos `code`.
 *
 * Permisos efectivos de un usuario = ROLE_DEFAULTS[role] ∪ customRole.permissionCodes.
 * SUPER_ADMIN tiene el comodín '*' (todo). Los permisos `platform.*` NO son asignables
 * a roles de comercio (solo los obtiene SUPER_ADMIN vía '*').
 */

export const WILDCARD = '*';

export interface PermissionDef {
  code: string;
  label: string;
  group: string;
}

/** Catálogo completo de permisos de comercio (lo que un admin puede otorgar). */
export const PERMISSIONS: PermissionDef[] = [
  // Ventas / POS
  { code: 'pos.sell', label: 'Cobrar en el POS', group: 'Ventas' },
  { code: 'sales.view', label: 'Ver ventas e historial', group: 'Ventas' },
  { code: 'sales.void', label: 'Anular ventas', group: 'Ventas' },
  // Pedidos (flujo facturador/caja)
  { code: 'orders.create', label: 'Crear pedidos (facturar)', group: 'Pedidos' },
  { code: 'orders.checkout', label: 'Cobrar pedidos en caja', group: 'Pedidos' },
  { code: 'orders.cancel', label: 'Cancelar pedidos', group: 'Pedidos' },
  // Caja
  { code: 'cash.operate', label: 'Abrir/cerrar caja y movimientos', group: 'Caja' },
  { code: 'cash.view', label: 'Ver cajas y turnos', group: 'Caja' },
  // Catálogo / Inventario
  { code: 'catalog.view', label: 'Ver productos y categorías', group: 'Inventario' },
  { code: 'catalog.create', label: 'Alta rápida de productos', group: 'Inventario' },
  { code: 'catalog.manage', label: 'Editar/eliminar productos y categorías', group: 'Inventario' },
  { code: 'inventory.cost.view', label: 'Ver costos de productos', group: 'Inventario' },
  // Finanzas / Reportes
  { code: 'finance.view', label: 'Ver finanzas', group: 'Reportes' },
  { code: 'finance.manage', label: 'Cerrar caja diaria / acciones de finanzas', group: 'Reportes' },
  { code: 'analytics.view', label: 'Ver analíticas', group: 'Reportes' },
  { code: 'reports.view', label: 'Ver reportes', group: 'Reportes' },
  // Contabilidad
  { code: 'accounting.view', label: 'Ver contabilidad', group: 'Contabilidad' },
  { code: 'accounting.manage', label: 'Registrar compras, conciliar y cerrar período', group: 'Contabilidad' },
  { code: 'accounting.period.reopen', label: 'Reabrir período contable', group: 'Contabilidad' },
  // e-CF
  { code: 'ecf.view', label: 'Ver envíos e-CF', group: 'Facturación electrónica' },
  { code: 'ecf.manage', label: 'Configurar e-CF y reintentar', group: 'Facturación electrónica' },
  // Clientes y cotizaciones
  { code: 'customers.view', label: 'Ver clientes', group: 'Clientes' },
  { code: 'customers.manage', label: 'Crear/editar clientes', group: 'Clientes' },
  { code: 'quotes.view', label: 'Ver cotizaciones', group: 'Clientes' },
  { code: 'quotes.manage', label: 'Crear/editar cotizaciones', group: 'Clientes' },
  { code: 'quotes.convert', label: 'Convertir cotización en venta/pedido', group: 'Clientes' },
  // Administración del comercio
  { code: 'tenant.manage', label: 'Editar datos del comercio', group: 'Administración' },
  { code: 'users.manage', label: 'Gestionar empleados', group: 'Administración' },
  { code: 'roles.manage', label: 'Gestionar roles y permisos', group: 'Administración' },
];

/** Permiso exclusivo de plataforma (solo SUPER_ADMIN, vía '*'). No asignable a comercios. */
export const PLATFORM_ADMIN = 'platform.admin';

/** Códigos que un admin de comercio puede asignar en roles personalizados. */
export const TENANT_ASSIGNABLE_CODES: string[] = PERMISSIONS.map((p) => p.code);

const ALL_TENANT = TENANT_ASSIGNABLE_CODES;

/** Permisos por defecto de cada rol base del enum. */
export const ROLE_DEFAULTS: Record<string, string[]> = {
  SUPER_ADMIN: [WILDCARD],
  ADMIN: [...ALL_TENANT],
  CASHIER: [
    'pos.sell',
    'sales.view',
    'orders.create',
    'orders.checkout',
    'orders.cancel',
    'cash.operate',
    'cash.view',
    'catalog.view',
    'catalog.create',
    'customers.view',
    'customers.manage',
    'quotes.view',
    'quotes.manage',
    'quotes.convert',
  ],
  BILLER: [
    'orders.create',
    'orders.cancel',
    'catalog.view',
    'catalog.create',
    'customers.view',
    'customers.manage',
    'quotes.view',
    'quotes.manage',
    'quotes.convert',
  ],
  ACCOUNTANT: [
    'sales.view',
    'cash.view',
    'catalog.view',
    'inventory.cost.view',
    'finance.view',
    'analytics.view',
    'reports.view',
    'accounting.view',
    'accounting.manage',
    'ecf.view',
    'customers.view',
    'quotes.view',
  ],
};

/** Permisos efectivos = defaults del rol base ∪ permisos del rol personalizado. */
export function effectivePermissions(role: string, customPermissionCodes?: string[] | null): string[] {
  const base = ROLE_DEFAULTS[role] ?? [];
  if (base.includes(WILDCARD)) return [WILDCARD];
  const set = new Set<string>(base);
  for (const code of customPermissionCodes ?? []) {
    // Un rol de comercio nunca puede otorgarse permisos de plataforma.
    if (TENANT_ASSIGNABLE_CODES.includes(code)) set.add(code);
  }
  return [...set];
}

/** ¿`granted` satisface al menos uno de `required`? '*' satisface todo. */
export function hasAnyPermission(granted: string[] | undefined, required: string[]): boolean {
  if (!required.length) return true;
  if (!granted?.length) return false;
  if (granted.includes(WILDCARD)) return true;
  return required.some((r) => granted.includes(r));
}

/** Agrupa el catálogo por `group` (para la UI). */
export function groupedPermissions(): { group: string; permissions: PermissionDef[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, PermissionDef[]>();
  for (const p of PERMISSIONS) {
    if (!byGroup.has(p.group)) {
      byGroup.set(p.group, []);
      order.push(p.group);
    }
    byGroup.get(p.group)!.push(p);
  }
  return order.map((group) => ({ group, permissions: byGroup.get(group)! }));
}
