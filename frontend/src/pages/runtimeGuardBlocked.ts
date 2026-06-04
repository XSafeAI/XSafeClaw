import type { GuardPendingApproval, GuardRuntimeObservation } from '../services/api';

export type RecentBlockedSource = 'approval' | 'observation';

export type RecentBlockedItem = {
  id: string;
  source: RecentBlockedSource;
  dedupeKey: string;
  timestamp: number;
  sessionKey: string;
  toolName: string;
  params: Record<string, unknown>;
  platform: string;
  instanceId: string;
  reason?: string | null;
  impact?: string | null;
};

const BLOCKED_DEDUPE_WINDOW_SECONDS = 30;

function normalizeBlockedSessionKey(value: unknown): string {
  return String(value ?? '').trim();
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableJsonValue(entryValue)]),
    );
  }
  return value;
}

function stableParamsKey(params: Record<string, unknown> = {}): string {
  try {
    return JSON.stringify(stableJsonValue(params));
  } catch {
    return String(params);
  }
}

function blockedDedupeKey(
  sessionKey: string,
  toolName: string,
  params: Record<string, unknown>,
): string {
  return [
    normalizeBlockedSessionKey(sessionKey),
    String(toolName || 'tool'),
    stableParamsKey(params),
  ].join('|');
}

function blockedItemFromApproval(item: GuardPendingApproval): RecentBlockedItem | null {
  if (!item.resolved || item.resolution !== 'rejected') return null;
  const timestamp = Number(item.resolved_at || item.created_at || 0);
  return {
    id: `approval-${item.id}`,
    source: 'approval',
    dedupeKey: blockedDedupeKey(item.session_key, item.tool_name, item.params),
    timestamp,
    sessionKey: item.session_key,
    toolName: item.tool_name || 'tool',
    params: item.params ?? {},
    platform: item.platform || 'runtime',
    instanceId: item.instance_id || '',
    reason: item.failure_mode || item.risk_source,
    impact: item.real_world_harm,
  };
}

function blockedItemFromObservation(item: GuardRuntimeObservation): RecentBlockedItem | null {
  if (String(item.action || '').toLowerCase() !== 'block') return null;
  const timestamp = Number(item.created_at || 0);
  return {
    id: `observation-${item.id}`,
    source: 'observation',
    dedupeKey: blockedDedupeKey(item.session_key, item.tool_name, item.params),
    timestamp,
    sessionKey: item.session_key,
    toolName: item.tool_name || 'tool',
    params: item.params ?? {},
    platform: item.platform || 'runtime',
    instanceId: item.instance_id || '',
    reason: item.reason,
    impact: null,
  };
}

export function mergeBlockedItems(
  approvals: GuardPendingApproval[],
  observations: GuardRuntimeObservation[],
): RecentBlockedItem[] {
  const candidates = [
    ...approvals.map(blockedItemFromApproval),
    ...observations.map(blockedItemFromObservation),
  ].filter((item): item is RecentBlockedItem => item !== null && Number.isFinite(item.timestamp));

  const merged: RecentBlockedItem[] = [];
  for (const candidate of candidates) {
    const duplicateIndex = merged.findIndex(item => (
      item.source !== candidate.source
      && item.dedupeKey === candidate.dedupeKey
      && Math.abs(item.timestamp - candidate.timestamp) <= BLOCKED_DEDUPE_WINDOW_SECONDS
    ));

    if (duplicateIndex === -1) {
      merged.push(candidate);
      continue;
    }

    const existing = merged[duplicateIndex];
    const preferred = existing.source === 'observation'
      ? existing
      : candidate.source === 'observation'
        ? candidate
        : existing;
    merged[duplicateIndex] = {
      ...preferred,
      id: `${existing.id}|${candidate.id}`,
      timestamp: Math.max(existing.timestamp, candidate.timestamp),
      reason: preferred.reason || existing.reason || candidate.reason,
      impact: preferred.impact || existing.impact || candidate.impact,
    };
  }

  return merged.sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0));
}
