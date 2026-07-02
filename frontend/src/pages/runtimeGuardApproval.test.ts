import { describe, expect, it } from 'vitest';
import type { GuardPendingApproval } from '../services/api';
import type { ChatMessage } from '../stores/chatStreamStore';
import {
  buildActiveTimelineRows,
  buildTimelineScrollKey,
  getActiveApprovalCards,
  upsertMiddleApprovalCards,
  type TimelineRow,
  type RuntimeGuardApprovalSession,
} from './runtimeGuardApproval';

function approval(overrides: Partial<GuardPendingApproval> = {}): GuardPendingApproval {
  return {
    id: 'approval-1',
    platform: 'openclaw',
    instance_id: 'instance-1',
    guard_mode: 'prompt',
    session_key: 'session-a',
    tool_name: 'Shell Command',
    params: { command: 'rm -rf ./tmp/cache/*' },
    guard_verdict: 'unsafe',
    guard_raw: '{}',
    session_context: '{}',
    risk_source: 'Command execution',
    failure_mode: 'Deletes files',
    real_world_harm: 'May delete important project data',
    created_at: 1710000000,
    resolved: false,
    resolution: '',
    resolved_at: 0,
    ...overrides,
  };
}

const sessions: RuntimeGuardApprovalSession[] = [
  { sessionKey: 'session-a', platform: 'openclaw', instanceId: 'instance-1' },
  { sessionKey: 'session-b', platform: 'openclaw', instanceId: 'instance-2' },
];

function message(id: string, timestampSeconds: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: id,
    timestamp: new Date(timestampSeconds * 1000),
    ...overrides,
  };
}

function rowKeys(rows: TimelineRow[]): string[] {
  return rows.map(row => (
    row.type === 'approval'
      ? `approval:${row.card.id}`
      : `message:${row.message.id}`
  ));
}

describe('runtime guard middle approval sync', () => {
  it('creates the approval card in the matching session, not the active session', () => {
    const cardsBySession = upsertMiddleApprovalCards(
      {},
      [approval({ id: 'approval-b', session_key: 'session-b', instance_id: 'instance-2' })],
      sessions,
      { preferredSessionKey: 'session-a', nowMs: 1710000000000 },
    );

    expect(getActiveApprovalCards(cardsBySession, 'session-a')).toHaveLength(0);
    expect(getActiveApprovalCards(cardsBySession, 'session-b')).toHaveLength(1);
    expect(getActiveApprovalCards(cardsBySession, 'session-b')[0].id).toBe('approval-b');
  });

  it('does not create a middle card when identity fallback is ambiguous', () => {
    const ambiguousSessions: RuntimeGuardApprovalSession[] = [
      { sessionKey: 'session-a', platform: 'openclaw', instanceId: 'shared-instance' },
      { sessionKey: 'session-b', platform: 'openclaw', instanceId: 'shared-instance' },
    ];

    const cardsBySession = upsertMiddleApprovalCards(
      {},
      [approval({ session_key: '', instance_id: 'shared-instance' })],
      ambiguousSessions,
      { preferredSessionKey: 'session-a', nowMs: 1710000000000 },
    );

    expect(cardsBySession).toEqual({});
  });

  it('keeps repeated same tool and params separate when ids differ', () => {
    const cardsBySession = upsertMiddleApprovalCards(
      {},
      [
        approval({ id: 'approval-1' }),
        approval({ id: 'approval-2' }),
      ],
      sessions,
      { nowMs: 1710000000000 },
    );

    expect(getActiveApprovalCards(cardsBySession, 'session-a').map(card => card.id)).toEqual([
      'approval-1',
      'approval-2',
    ]);
  });

  it('builds the active timeline from only the active session approvals', () => {
    const cardsBySession = upsertMiddleApprovalCards(
      {},
      [
        approval({ id: 'approval-a', session_key: 'session-a' }),
        approval({ id: 'approval-b', session_key: 'session-b', instance_id: 'instance-2' }),
      ],
      sessions,
      { nowMs: 1710000000000 },
    );

    const rows = buildActiveTimelineRows([], getActiveApprovalCards(cardsBySession, 'session-b'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'approval', card: { id: 'approval-b' } });
  });

  it('inserts approvals between messages by approval creation time', () => {
    const cardsBySession = upsertMiddleApprovalCards(
      {},
      [approval({ id: 'approval-mid', created_at: 1710000010 })],
      sessions,
      { nowMs: 1710000010000 },
    );

    const rows = buildActiveTimelineRows(
      [
        message('before', 1710000000, { role: 'user' }),
        message('after', 1710000020),
      ],
      getActiveApprovalCards(cardsBySession, 'session-a'),
    );

    expect(rowKeys(rows)).toEqual([
      'message:before',
      'approval:approval-mid',
      'message:after',
    ]);
  });

  it('sorts Codex realtime messages by item event order without changing other timelines', () => {
    const rows = buildActiveTimelineRows(
      [
        message('tool-1', 1710000010, {
          role: 'tool_call',
          codex_event_order: 2,
          codex_started_at_ms: 1710000001000,
        }),
        message('assistant-1', 1710000005, {
          role: 'assistant',
          codex_event_order: 1,
          codex_started_at_ms: 1710000015000,
        }),
        message('assistant-2', 1710000015, {
          role: 'assistant',
          codex_event_order: 3,
          codex_started_at_ms: 1710000015000,
        }),
      ],
      [],
    );

    expect(rowKeys(rows)).toEqual([
      'message:assistant-1',
      'message:tool-1',
      'message:assistant-2',
    ]);
  });

  it('does not anchor approvals before a pending assistant message', () => {
    const cardsBySession = upsertMiddleApprovalCards(
      {},
      [approval({ id: 'approval-late', created_at: 1710000030 })],
      sessions,
      { nowMs: 1710000030000 },
    );

    const rows = buildActiveTimelineRows(
      [
        message('user', 1710000000, { role: 'user' }),
        message('waiting', 1710000010, { pending: true }),
      ],
      getActiveApprovalCards(cardsBySession, 'session-a'),
    );

    expect(rowKeys(rows)).toEqual([
      'message:user',
      'message:waiting',
      'approval:approval-late',
    ]);
  });

  it('keeps resolved approvals at their original creation-time position', () => {
    const pendingCards = upsertMiddleApprovalCards(
      {},
      [approval({ id: 'approval-resolved', created_at: 1710000010 })],
      sessions,
      { nowMs: 1710000010000 },
    );
    const resolvedCards = upsertMiddleApprovalCards(
      pendingCards,
      [approval({
        id: 'approval-resolved',
        created_at: 1710000010,
        resolved: true,
        resolution: 'approved',
        resolved_at: 1710000100,
      })],
      sessions,
      { createResolvedIds: new Set(['approval-resolved']), nowMs: 1710000100000 },
    );
    const messages = [
      message('before', 1710000000, { role: 'user' }),
      message('after', 1710000020),
    ];

    const pendingRows = buildActiveTimelineRows(messages, getActiveApprovalCards(pendingCards, 'session-a'));
    const resolvedRows = buildActiveTimelineRows(messages, getActiveApprovalCards(resolvedCards, 'session-a'));

    expect(rowKeys(resolvedRows)).toEqual(rowKeys(pendingRows));
    expect(resolvedRows[1]).toMatchObject({
      type: 'approval',
      card: { id: 'approval-resolved', status: 'approved' },
    });
  });

  it('appends approvals later than all messages at the end', () => {
    const cardsBySession = upsertMiddleApprovalCards(
      {},
      [approval({ id: 'approval-last', created_at: 1710000040 })],
      sessions,
      { nowMs: 1710000040000 },
    );

    const rows = buildActiveTimelineRows(
      [
        message('first', 1710000000, { role: 'user' }),
        message('second', 1710000010),
      ],
      getActiveApprovalCards(cardsBySession, 'session-a'),
    );

    expect(rowKeys(rows)).toEqual([
      'message:first',
      'message:second',
      'approval:approval-last',
    ]);
  });

  it('keeps the timeline scroll key stable when approval resolution changes', () => {
    const pendingRows = buildActiveTimelineRows([], getActiveApprovalCards(
      upsertMiddleApprovalCards(
        {},
        [approval({ id: 'approval-key', created_at: 1710000010 })],
        sessions,
        { nowMs: 1710000010000 },
      ),
      'session-a',
    ));
    const resolvedRows = buildActiveTimelineRows([], getActiveApprovalCards(
      upsertMiddleApprovalCards(
        {},
        [approval({
          id: 'approval-key',
          created_at: 1710000010,
          resolved: true,
          resolution: 'approved',
          resolved_at: 1710000100,
        })],
        sessions,
        { createResolvedIds: new Set(['approval-key']), nowMs: 1710000100000 },
      ),
      'session-a',
    ));

    expect(resolvedRows).toHaveLength(pendingRows.length);
    expect(buildTimelineScrollKey(resolvedRows)).toBe(buildTimelineScrollKey(pendingRows));
  });
});
