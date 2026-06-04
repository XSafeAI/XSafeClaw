import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuardPendingApproval } from '../services/api';
import {
  ApprovalViewAllModal,
  BlockedViewAllModal,
  InlineApprovalCard,
  type BlockedModalRange,
} from './RuntimeGuardConsole';
import type { RecentBlockedItem } from './runtimeGuardBlocked';
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

describe('ApprovalViewAllModal', () => {
  it('renders all pending approvals and removes the handled card while staying open', () => {
    const decisions: Array<{ id: string; resolution: string }> = [];
    function Harness() {
      const [items, setItems] = useState([
        approval({ id: 'approval-1', params: { command: 'cmd-one' }, created_at: 1710000001 }),
        approval({ id: 'approval-2', params: { command: 'cmd-two' }, created_at: 1710000002 }),
        approval({ id: 'approval-3', params: { command: 'cmd-three' }, created_at: 1710000003 }),
      ]);
      return (
        <ApprovalViewAllModal
          items={items}
          loading={false}
          resolvingApprovalId={null}
          onClose={vi.fn()}
          onDecision={(item, resolution) => {
            decisions.push({ id: item.id, resolution });
            setItems(current => current.filter(entry => entry.id !== item.id));
          }}
        />
      );
    }

    const { container } = render(<Harness />);

    expect(container.querySelectorAll('.rg-approval-item.is-modal')).toHaveLength(3);
    expect(screen.getByText('cmd-one')).toBeTruthy();
    expect(screen.getByText('cmd-two')).toBeTruthy();
    expect(screen.getByText('cmd-three')).toBeTruthy();

    const secondCard = screen.getByText('cmd-two').closest('.rg-approval-item');
    expect(secondCard).toBeTruthy();
    fireEvent.click(within(secondCard as HTMLElement).getByRole('button', { name: 'Deny' }));

    expect(decisions).toEqual([{ id: 'approval-2', resolution: 'rejected' }]);
    expect(screen.queryByText('cmd-two')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Pending approvals' })).toBeTruthy();
    expect(container.querySelectorAll('.rg-approval-item.is-modal')).toHaveLength(2);
  });

  it('shows loading and empty states', () => {
    const { rerender } = render(
      <ApprovalViewAllModal
        items={[]}
        loading
        resolvingApprovalId={null}
        onClose={vi.fn()}
        onDecision={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading approvals...')).toBeTruthy();

    rerender(
      <ApprovalViewAllModal
        items={[]}
        loading={false}
        resolvingApprovalId={null}
        onClose={vi.fn()}
        onDecision={vi.fn()}
      />,
    );

    expect(screen.getByText('No pending approvals')).toBeTruthy();
  });
});

function blocked(overrides: Partial<RecentBlockedItem> = {}): RecentBlockedItem {
  return {
    id: 'blocked-1',
    source: 'approval',
    dedupeKey: 'session-a|Shell Command|{}',
    timestamp: 1710000000,
    sessionKey: 'session-a',
    toolName: 'Shell Command',
    params: { command: 'rm -rf ./tmp/cache/*' },
    platform: 'openclaw',
    instanceId: 'instance-1',
    reason: 'Deletes files recursively',
    impact: 'May delete important project data',
    ...overrides,
  };
}

describe('BlockedViewAllModal', () => {
  it('defaults to the provided 24h range and switches to 7d and all newest first', () => {
    function Harness() {
      const [range, setRange] = useState<BlockedModalRange>('24h');
      return (
        <BlockedViewAllModal
          items={[
            blocked({ id: 'recent', timestamp: 1710000000, toolName: 'Recent Shell' }),
            blocked({ id: 'week', timestamp: 1709827200, toolName: 'Week Shell' }),
            blocked({ id: 'old', timestamp: 1709220000, toolName: 'Old Shell' }),
          ]}
          loading={false}
          nowMs={1710000000 * 1000}
          range={range}
          onClose={vi.fn()}
          onRangeChange={setRange}
        />
      );
    }

    const { container } = render(<Harness />);

    expect(screen.getByText('Recent Shell')).toBeTruthy();
    expect(screen.queryByText('Week Shell')).toBeNull();
    expect(screen.queryByText('Old Shell')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(screen.getByText('Recent Shell')).toBeTruthy();
    expect(screen.getByText('Week Shell')).toBeTruthy();
    expect(screen.queryByText('Old Shell')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const titles = Array.from(container.querySelectorAll('.rg-block-detail-title')).map(node => node.textContent);
    expect(titles).toEqual(['Recent Shell', 'Week Shell', 'Old Shell']);
  });

  it('renders blocked detail fields and close interactions', () => {
    const onClose = vi.fn();
    const { container } = render(
      <BlockedViewAllModal
        items={[blocked({ source: 'observation' })]}
        loading={false}
        nowMs={1710000000 * 1000}
        range="all"
        onClose={onClose}
        onRangeChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('Observation')).toBeTruthy();
    expect(screen.getByText('By: openclaw / instance-1')).toBeTruthy();
    expect(screen.getByText('Session: session-a')).toBeTruthy();
    expect(screen.getByText('Reason: Deletes files recursively')).toBeTruthy();
    expect(screen.getByText('Impact: May delete important project data')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Blocked events' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(container.querySelector('.rg-modal-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Close blocked events'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
