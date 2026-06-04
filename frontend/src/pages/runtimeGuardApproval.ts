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
    const byCreated = Number(left.createdAt || 0) - Number(right.createdAt || 0);
    if (byCreated !== 0) return byCreated;
    return left.id.localeCompare(right.id);
  });
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
  let approvalsInjected = false;
  for (const message of activeMessages) {
    if (!approvalsInjected && message.role === 'assistant' && message.pending) {
      activeApprovalCards.forEach(card => rows.push({ type: 'approval', card }));
      approvalsInjected = true;
    }
    rows.push({ type: 'message', message });
  }
  if (!approvalsInjected) {
    activeApprovalCards.forEach(card => rows.push({ type: 'approval', card }));
  }
  return rows;
}
