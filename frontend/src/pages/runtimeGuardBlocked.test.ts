import { describe, expect, it } from 'vitest';
import type { GuardPendingApproval, GuardRuntimeObservation } from '../services/api';
import { mergeBlockedItems } from './runtimeGuardBlocked';

function rejectedApproval(overrides: Partial<GuardPendingApproval> = {}): GuardPendingApproval {
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
    failure_mode: 'Deletes files recursively',
    real_world_harm: 'May delete important project data',
    created_at: 1710000000,
    resolved: true,
    resolution: 'rejected',
    resolved_at: 1710000010,
    ...overrides,
  };
}

function blockObservation(overrides: Partial<GuardRuntimeObservation> = {}): GuardRuntimeObservation {
  return {
    id: 'observation-1',
    platform: 'openclaw',
    instance_id: 'instance-1',
    guard_mode: 'prompt',
    session_key: 'session-a',
    tool_name: 'Shell Command',
    params: { command: 'rm -rf ./tmp/cache/*' },
    action: 'block',
    reason: 'Backend block result',
    guard_verdict: 'unsafe',
    guard_raw: '{}',
    session_context: '{}',
    created_at: 1710000020,
    ...overrides,
  };
}

describe('mergeBlockedItems', () => {
  it('dedupes matching rejected approval and block observation within 30 seconds', () => {
    const items = mergeBlockedItems([rejectedApproval()], [blockObservation()]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'observation',
      timestamp: 1710000020,
      reason: 'Backend block result',
      impact: 'May delete important project data',
    });
  });

  it('keeps repeated matching events separate when outside the dedupe window', () => {
    const items = mergeBlockedItems(
      [rejectedApproval()],
      [blockObservation({ created_at: 1710000100 })],
    );

    expect(items).toHaveLength(2);
    expect(items.map(item => item.timestamp)).toEqual([1710000100, 1710000010]);
  });

  it('does not include approved approvals or non-block observations', () => {
    const items = mergeBlockedItems(
      [rejectedApproval({ resolution: 'approved' })],
      [blockObservation({ action: 'allow' })],
    );

    expect(items).toEqual([]);
  });
});
