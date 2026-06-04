import { describe, expect, it } from 'vitest';
import type { GuardPendingApproval } from '../services/api';
import {
  buildActiveTimelineRows,
  getActiveApprovalCards,
  upsertMiddleApprovalCards,
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
});
