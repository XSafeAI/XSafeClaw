import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuardPendingApproval } from '../services/api';
import { InlineApprovalCard } from './RuntimeGuardConsole';
import type { MiddleApprovalCard } from './runtimeGuardApproval';

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
    failure_mode: 'Deletes files recursively',
    real_world_harm: 'May delete important project data',
    created_at: 1710000000,
    resolved: false,
    resolution: '',
    resolved_at: 0,
    ...overrides,
  };
}

function middleCard(overrides: Partial<MiddleApprovalCard> = {}): MiddleApprovalCard {
  const item = approval(overrides.item ? overrides.item : {});
  return {
    id: item.id,
    sessionKey: item.session_key,
    item,
    status: item.resolved ? (item.resolution === 'approved' ? 'approved' : 'rejected') : 'pending',
    createdAt: item.created_at,
    updatedAt: 1710000000000,
    ...overrides,
  };
}

describe('InlineApprovalCard', () => {
  it('renders as a timeline row with timestamp, icon, request details, and actions', () => {
    const { container } = render(
      <InlineApprovalCard card={middleCard()} resolving={false} onDecision={vi.fn()} />,
    );

    expect(container.querySelector('.rg-stream-row')).toBeTruthy();
    expect(container.querySelector('.rg-stream-time')?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(container.querySelector('.rg-stream-icon')).toBeTruthy();
    expect(screen.getByText('Shell Command Request')).toBeTruthy();
    expect(screen.getByText('High Risk')).toBeTruthy();
    expect(screen.getByText('rm -rf ./tmp/cache/*')).toBeTruthy();
    expect(screen.getByText('Reason: Deletes files recursively')).toBeTruthy();
    expect(screen.getByText('Impact: May delete important project data')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
  });

  it('keeps the resolved card and hides actions', () => {
    render(
      <InlineApprovalCard
        card={middleCard({
          item: approval({ resolved: true, resolution: 'rejected', resolved_at: 1710000010 }),
          status: 'rejected',
        })}
        resolving={false}
        onDecision={vi.fn()}
      />,
    );

    expect(screen.getByText('Denied')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });
});
