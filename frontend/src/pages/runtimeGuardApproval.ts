import type { GuardPendingApproval } from '../services/api';
import type { ChatMessage } from '../stores/chatStreamStore';

export type ApprovalDecision = 'approved' | 'rejected';
export type MiddleApprovalStatus = 'pending' | ApprovalDecision;

export type RuntimeGuardApprovalSession = {
  sessionKey: string;
  platform: string;
  instanceId?: string;
};

export type MiddleApprovalCard = {
  id: string;
  sessionKey: string;
  item: GuardPendingApproval;
  status: MiddleApprovalStatus;
  createdAt: number;
  updatedAt: number;
};

export type MiddleApprovalCardsBySession = Record<string, Record<string, MiddleApprovalCard>>;

export type TimelineRow =
  | { type: 'message'; message: ChatMessage }
  | { type: 'approval'; card: MiddleApprovalCard };

export type SyncMiddleApprovalOptions = {
  createResolvedIds?: Set<string>;
  preferredSessionKey?: string;
  nowMs?: number;
};

export function normalizeSessionKey(value: unknown): string {
  return String(value ?? '').trim();
}

export function sessionKeysMatch(left: unknown, right: unknown): boolean {
  const leftKey = normalizeSessionKey(left);
  const rightKey = normalizeSessionKey(right);
  if (!leftKey || !rightKey) return false;
  return leftKey === rightKey || leftKey.endsWith(rightKey) || rightKey.endsWith(leftKey);
}

export function approvalMatchesSessionIdentity(
  item: GuardPendingApproval,
  session: RuntimeGuardApprovalSession,
): boolean {
  if (item.platform && item.platform !== session.platform) return false;
  if (item.instance_id && session.instanceId && item.instance_id !== session.instanceId) return false;
  return true;
}

export function findExistingApprovalSessionKey(
  approvalId: string,
  cardsBySession: MiddleApprovalCardsBySession,
): string {
  for (const [sessionKey, cards] of Object.entries(cardsBySession)) {
    if (cards[approvalId]) return sessionKey;
  }
  return '';
}

export function findApprovalSessionKey(
  item: GuardPendingApproval,
  sessions: RuntimeGuardApprovalSession[],
  cardsBySession: MiddleApprovalCardsBySession,
): string {
  const existingSessionKey = findExistingApprovalSessionKey(item.id, cardsBySession);
  if (existingSessionKey) return existingSessionKey;

  const bySessionKey = sessions.find(session => sessionKeysMatch(item.session_key, session.sessionKey));
  if (bySessionKey) return bySessionKey.sessionKey;

  const identityMatches = sessions.filter(session => approvalMatchesSessionIdentity(item, session));
  return identityMatches.length === 1 ? identityMatches[0].sessionKey : '';
}

export function approvalStatusFromItem(item: GuardPendingApproval): MiddleApprovalStatus {
  if (!item.resolved) return 'pending';
  return item.resolution === 'approved' ? 'approved' : 'rejected';
}

export function sortMiddleApprovalCards(cards: MiddleApprovalCard[]): MiddleApprovalCard[] {
  return [...cards].sort((left, right) => {
    const byCreated = approvalCreatedAtSeconds(left) - approvalCreatedAtSeconds(right);
    if (byCreated !== 0) return byCreated;
    return left.id.localeCompare(right.id);
  });
}

function finiteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function approvalCreatedAtSeconds(card: MiddleApprovalCard): number {
  const createdAt = finiteNumber(card.createdAt);
  if (createdAt > 0) return createdAt;
  const itemCreatedAt = finiteNumber(card.item.created_at);
  if (itemCreatedAt > 0) return itemCreatedAt;
  const updatedAt = finiteNumber(card.updatedAt);
  return updatedAt > 0 ? updatedAt / 1000 : 0;
}

function approvalCreatedAtMs(card: MiddleApprovalCard): number {
  return approvalCreatedAtSeconds(card) * 1000;
}

function messageTimestampMs(message: ChatMessage): number {
  const timestamp = message.timestamp instanceof Date
    ? message.timestamp.getTime()
    : new Date(message.timestamp).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function upsertMiddleApprovalCards(
  current: MiddleApprovalCardsBySession,
  items: GuardPendingApproval[],
  sessions: RuntimeGuardApprovalSession[],
  options: SyncMiddleApprovalOptions = {},
): MiddleApprovalCardsBySession {
  let next = current;
  const nowMs = options.nowMs ?? Date.now();

  const cloneSessionCards = (sessionKey: string) => {
    if (next === current) next = { ...current };
    const currentCards = current[sessionKey] ?? {};
    if (!next[sessionKey] || next[sessionKey] === currentCards) {
      next[sessionKey] = { ...currentCards };
    }
    return next[sessionKey];
  };

  for (const item of items) {
    const hasExistingCard = Boolean(findExistingApprovalSessionKey(item.id, current));
    const canCreateCard = !item.resolved || options.createResolvedIds?.has(item.id);
    if (!hasExistingCard && !canCreateCard) continue;

    const sessionKey = findApprovalSessionKey(
      item,
      sessions,
      current,
    );
    if (!sessionKey) continue;

    const sessionCards = cloneSessionCards(sessionKey);
    const previous = sessionCards[item.id];
    sessionCards[item.id] = {
      id: item.id,
      sessionKey,
      item,
      status: approvalStatusFromItem(item),
      createdAt: Number(item.created_at || previous?.createdAt || nowMs / 1000),
      updatedAt: nowMs,
    };
  }

  return next;
}

export function getActiveApprovalCards(
  cardsBySession: MiddleApprovalCardsBySession,
  activeSessionKey: string,
): MiddleApprovalCard[] {
  if (!activeSessionKey) return [];
  return sortMiddleApprovalCards(Object.values(cardsBySession[activeSessionKey] ?? {}));
}

export function buildActiveTimelineRows(
  activeMessages: ChatMessage[],
  activeApprovalCards: MiddleApprovalCard[],
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const approvals = sortMiddleApprovalCards(activeApprovalCards);
  let approvalIndex = 0;
  const messages = activeMessages.some(message => (
    Number.isFinite(message.codex_event_order)
    || Number.isFinite(message.codex_started_at_ms)
    || Number.isFinite(message.codex_completed_at_ms)
  ))
    ? [...activeMessages].sort((left, right) => {
        const leftOrder = Number.isFinite(left.codex_event_order) ? Number(left.codex_event_order) : Number.NaN;
        const rightOrder = Number.isFinite(right.codex_event_order) ? Number(right.codex_event_order) : Number.NaN;
        if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        const leftMs = Number.isFinite(left.codex_started_at_ms)
          ? Number(left.codex_started_at_ms)
          : Number.isFinite(left.codex_completed_at_ms)
            ? Number(left.codex_completed_at_ms)
            : messageTimestampMs(left);
        const rightMs = Number.isFinite(right.codex_started_at_ms)
          ? Number(right.codex_started_at_ms)
          : Number.isFinite(right.codex_completed_at_ms)
            ? Number(right.codex_completed_at_ms)
            : messageTimestampMs(right);
        if (leftMs !== rightMs) return leftMs - rightMs;
        if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return activeMessages.indexOf(left) - activeMessages.indexOf(right);
      })
    : activeMessages;

  for (const message of messages) {
    const messageMs = messageTimestampMs(message);
    while (
      approvalIndex < approvals.length
      && approvalCreatedAtMs(approvals[approvalIndex]) < messageMs
    ) {
      rows.push({ type: 'approval', card: approvals[approvalIndex] });
      approvalIndex += 1;
    }
    rows.push({ type: 'message', message });
  }

  while (approvalIndex < approvals.length) {
    rows.push({ type: 'approval', card: approvals[approvalIndex] });
    approvalIndex += 1;
  }

  return rows;
}

export function buildTimelineScrollKey(rows: TimelineRow[]): string {
  return rows.map(row => {
    if (row.type === 'approval') {
      return [
        'a',
        row.card.id,
        approvalCreatedAtSeconds(row.card),
      ].join(':');
    }

    const message = row.message;
    return [
      'm',
      message.id,
      messageTimestampMs(message),
      message.role,
      message.pending ? 1 : 0,
      message.result_pending ? 1 : 0,
      message.is_error ? 1 : 0,
      message.content.length,
    ].join(':');
  }).join('|');
}
