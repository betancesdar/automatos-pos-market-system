// Lightweight IndexedDB wrapper (Dexie.js) powering the offline-first POS.
//
// IMPORTANT: never instantiate Dexie at module scope — Next.js prerenders
// `/pos` on the server (Node has no `indexedDB` global), so the database is
// created lazily on first client-side use via `getOfflineDb()`.

import Dexie, { type Table } from 'dexie';

export interface CachedProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  barcode: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  updatedAt: number;
}

export interface CachedCategory {
  id: string;
  name: string;
  slug: string;
  updatedAt: number;
}

export interface CachedCustomer {
  id: string;
  name: string;
  rnc?: string | null;
  phone?: string | null;
  updatedAt: number;
}

export type SyncStatus = 'pending' | 'syncing' | 'failed';

/** Matches the `/sales/checkout` (and `/sales/sync`) request body, plus offline metadata. */
export interface PendingSalePayload {
  items: { productId: string; quantity: number; unitPrice?: number; isLoose?: boolean }[];
  cashReceived: number;
  ncfType: string;
  applyItbis?: boolean;
  clientRnc?: string;
  clientName?: string;
  paymentMethod?: string;
  discountAmount?: number;
  offlineId: string;
  offlineCreatedAt: string;
}

export interface PendingSale {
  offlineId: string;
  tenantId: string;
  payload: PendingSalePayload;
  createdAt: number;
  syncStatus: SyncStatus;
  lastError?: string;
  /** Snapshot used to reprint the receipt / show sale history while offline. */
  displaySnapshot: {
    total: number;
    totalReceived: number;
    totalChange: number;
    itemCount: number;
  };
}

class OfflineDatabase extends Dexie {
  cached_products!: Table<CachedProduct, string>;
  cached_categories!: Table<CachedCategory, string>;
  cached_customers!: Table<CachedCustomer, string>;
  pending_sales!: Table<PendingSale, string>;

  constructor() {
    super('minimarket_offline_db');
    this.version(1).stores({
      cached_products: 'id, barcode, categoryId, name',
      cached_categories: 'id, slug',
      cached_customers: 'id, rnc',
      pending_sales: 'offlineId, tenantId, syncStatus, createdAt',
    });
  }
}

let dbInstance: OfflineDatabase | null = null;

function getOfflineDb(): OfflineDatabase | null {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return null;
  if (!dbInstance) dbInstance = new OfflineDatabase();
  return dbInstance;
}

function generateOfflineId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Product / category cache (populated whenever the POS is online) ──

export async function cacheProducts(products: Omit<CachedProduct, 'updatedAt'>[]): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  const now = Date.now();
  await db.cached_products.bulkPut(products.map((p) => ({ ...p, updatedAt: now })));
}

export async function cacheCategories(categories: Omit<CachedCategory, 'updatedAt'>[]): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  const now = Date.now();
  await db.cached_categories.bulkPut(categories.map((c) => ({ ...c, updatedAt: now })));
}

export async function getCachedProducts(): Promise<CachedProduct[]> {
  const db = getOfflineDb();
  if (!db) return [];
  return db.cached_products.toArray();
}

export async function getCachedCategories(): Promise<CachedCategory[]> {
  const db = getOfflineDb();
  if (!db) return [];
  return db.cached_categories.toArray();
}

export async function cacheCustomers(customers: Omit<CachedCustomer, 'updatedAt'>[]): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  const now = Date.now();
  await db.cached_customers.bulkPut(customers.map((c) => ({ ...c, updatedAt: now })));
}

export async function getCachedCustomers(): Promise<CachedCustomer[]> {
  const db = getOfflineDb();
  if (!db) return [];
  return db.cached_customers.toArray();
}

// ── Offline sales queue ──

export async function queuePendingSale(
  tenantId: string,
  basePayload: Omit<PendingSalePayload, 'offlineId' | 'offlineCreatedAt'>,
  displaySnapshot: PendingSale['displaySnapshot'],
): Promise<string> {
  const db = getOfflineDb();
  const offlineId = generateOfflineId();
  const offlineCreatedAt = new Date().toISOString();
  if (!db) return offlineId; // Extremely old browser w/o IndexedDB — best effort, nothing persisted.

  await db.pending_sales.put({
    offlineId,
    tenantId,
    payload: { ...basePayload, offlineId, offlineCreatedAt },
    createdAt: Date.now(),
    syncStatus: 'pending',
    displaySnapshot,
  });
  return offlineId;
}

export async function listPendingSales(tenantId: string): Promise<PendingSale[]> {
  const db = getOfflineDb();
  if (!db) return [];
  return db.pending_sales.where('tenantId').equals(tenantId).sortBy('createdAt');
}

export async function countPendingSales(tenantId: string): Promise<number> {
  const db = getOfflineDb();
  if (!db) return 0;
  return db.pending_sales.where('tenantId').equals(tenantId).count();
}

export async function updatePendingSaleStatus(offlineId: string, status: SyncStatus, lastError?: string): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  await db.pending_sales.update(offlineId, { syncStatus: status, lastError });
}

export async function removePendingSale(offlineId: string): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  await db.pending_sales.delete(offlineId);
}
