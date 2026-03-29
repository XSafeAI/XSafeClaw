import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { guardAPI } from '../services/api';

const GUARD_SYNC_EVENT = 'xsafeclaw:guard-sync';
const GUARD_SYNC_STORAGE_KEY = 'xsafeclaw.guard.enabled';
const GUARD_SYNC_CHANNEL = 'xsafeclaw-guard';
const GUARD_REFRESH_MS = 3000;

type GuardSyncPayload = {
  enabled: boolean;
  updatedAt: number;
};

function makePayload(enabled: boolean): GuardSyncPayload {
  return {
    enabled: !!enabled,
    updatedAt: Date.now(),
  };
}

function parsePayload(value: unknown): GuardSyncPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<GuardSyncPayload>;
  if (typeof candidate.enabled !== 'boolean') return null;
  return {
    enabled: candidate.enabled,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
  };
}

function readStoragePayload(raw: string | null): GuardSyncPayload | null {
  if (!raw) return null;
  try {
    return parsePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function useGuardEnabled(initialValue = false) {
  const [guardEnabled, setGuardEnabled] = useState(initialValue);
  const latestUpdateRef = useRef(0);
  const requestIdRef = useRef(0);

  const channel = useMemo(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
    return new BroadcastChannel(GUARD_SYNC_CHANNEL);
  }, []);

  const applyPayload = useCallback((payload: GuardSyncPayload | null) => {
    if (!payload) return;
    if (payload.updatedAt < latestUpdateRef.current) return;
    latestUpdateRef.current = payload.updatedAt;
    setGuardEnabled(payload.enabled);
  }, []);

  const broadcastPayload = useCallback((payload: GuardSyncPayload) => {
    applyPayload(payload);
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(GUARD_SYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures in restricted/private contexts.
    }

    window.dispatchEvent(new CustomEvent(GUARD_SYNC_EVENT, { detail: payload }));

    try {
      channel?.postMessage(payload);
    } catch {
      // Ignore cross-context broadcast failures.
    }
  }, [applyPayload, channel]);

  const refreshGuardEnabled = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const response = await guardAPI.getEnabled();
      if (requestId !== requestIdRef.current) return;
      applyPayload(makePayload(response.data.enabled));
    } catch {
      // Keep the last known UI state if refresh fails.
    }
  }, [applyPayload]);

  const setSharedGuardEnabled = useCallback(async (enabled: boolean) => {
    const next = !!enabled;
    const prev = guardEnabled;
    const payload = makePayload(next);

    applyPayload(payload);

    try {
      const response = await guardAPI.setEnabled(next);
      broadcastPayload(makePayload(response.data.enabled));
    } catch (error) {
      applyPayload(makePayload(prev));
      throw error;
    }
  }, [applyPayload, broadcastPayload, guardEnabled]);

  const toggleGuardEnabled = useCallback(async () => {
    await setSharedGuardEnabled(!guardEnabled);
  }, [guardEnabled, setSharedGuardEnabled]);

  useEffect(() => {
    const storagePayload = readStoragePayload(
      typeof window === 'undefined' ? null : window.localStorage.getItem(GUARD_SYNC_STORAGE_KEY),
    );
    if (storagePayload) applyPayload(storagePayload);

    refreshGuardEnabled();

    if (typeof window === 'undefined') return undefined;

    const onCustomEvent = (event: Event) => {
      applyPayload(parsePayload((event as CustomEvent).detail));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== GUARD_SYNC_STORAGE_KEY) return;
      applyPayload(readStoragePayload(event.newValue));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshGuardEnabled();
    };
    const onFocus = () => {
      refreshGuardEnabled();
    };
    const onChannelMessage = (event: MessageEvent) => {
      applyPayload(parsePayload(event.data));
    };

    window.addEventListener(GUARD_SYNC_EVENT, onCustomEvent);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    channel?.addEventListener('message', onChannelMessage);

    const timer = window.setInterval(() => {
      refreshGuardEnabled();
    }, GUARD_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(GUARD_SYNC_EVENT, onCustomEvent);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      channel?.removeEventListener('message', onChannelMessage);
      channel?.close();
    };
  }, [applyPayload, channel, refreshGuardEnabled]);

  return {
    guardEnabled,
    refreshGuardEnabled,
    setGuardEnabled: setSharedGuardEnabled,
    toggleGuardEnabled,
  };
}
