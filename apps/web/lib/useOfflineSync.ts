'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import {
  countPendingSales,
  listPendingSales,
  removePendingSale,
  updatePendingSaleStatus,
} from './offline-db';

interface SyncResult {
  offlineId: string;
  status: 'synced' | 'duplicate' | 'error';
  error?: string;
}

const AUTO_SYNC_INTERVAL_MS = 20_000;

/**
 * Watches connectivity and automatically pushes the offline sales queue to
 * `/sales/sync` whenever the browser regains internet access. Also exposes
 * `pendingCount` and a manual `syncNow()` for the POS header badge/button.
 */
export function useOfflineSync(tenantId: string) {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
  }, []);

  const refreshPendingCount = useCallback(async () => {
    if (!tenantId) return;
    setPendingCount(await countPendingSales(tenantId));
  }, [tenantId]);

  const syncNow = useCallback(async () => {
    if (!tenantId || syncingRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const pending = await listPendingSales(tenantId);
    if (pending.length === 0) {
      setPendingCount(0);
      return;
    }

    syncingRef.current = true;
    setSyncing(true);
    setLastSyncError(null);

    try {
      await Promise.all(pending.map((item) => updatePendingSaleStatus(item.offlineId, 'syncing')));

      const data = await apiFetch<{ results?: SyncResult[] } | SyncResult[]>(
        '/sales/sync',
        tenantId,
        {
          method: 'POST',
          body: JSON.stringify({ sales: pending.map((p) => p.payload) }),
        },
      );

      const results: SyncResult[] = Array.isArray(data) ? data : data.results ?? [];

      for (const result of results) {
        if (result.status === 'synced' || result.status === 'duplicate') {
          await removePendingSale(result.offlineId);
        } else {
          await updatePendingSaleStatus(result.offlineId, 'failed', result.error);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al sincronizar ventas pendientes';
      setLastSyncError(message);
      await Promise.all(pending.map((item) => updatePendingSaleStatus(item.offlineId, 'failed', message)));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshPendingCount();
    }
  }, [tenantId, refreshPendingCount]);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      syncNow();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic check: some networks flap without firing online/offline
    // events reliably, so we also poll navigator.onLine on an interval.
    const interval = setInterval(() => {
      if (navigator.onLine) {
        setIsOnline(true);
        syncNow();
      } else {
        setIsOnline(false);
      }
      refreshPendingCount();
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [syncNow, refreshPendingCount]);

  return { isOnline, pendingCount, syncing, lastSyncError, syncNow, refreshPendingCount };
}
