import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import CrewTab from '../src/features/world/agent_town/components/CrewTab.jsx';
import { getAgentTownText } from '../src/features/world/agent_town/i18n.js';

const taskStatusMeta = {
  running: { label: '运行中', className: 'tc-task-flagged' },
  completed: { label: '已完成', className: 'tc-task-ok' },
  failed: { label: '失败', className: 'tc-task-failed' },
  error: { label: '错误', className: 'tc-task-error' },
  pending: { label: '待处理', className: 'tc-task-pending' },
};

const helpers = {
  fmtDate: (value) => value || '---',
  fmtTime: (value) => value || '---',
  getAgentIdentity: (agent) => agent?.id || '',
  getAgentSessionKey: (agent) => agent?.session_key || '',
  shortId: (value) => String(value || '').slice(0, 10),
};

function renderCrewTab() {
  const agent = {
    id: 'openclaw-default',
    session_key: 'openclaw::session-1',
    status: 'working',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    channel: 'webchat',
  };

  const event = {
    id: 'event-1',
    status: 'completed',
    started_at: '2026-06-10T09:48:00Z',
    completed_at: '2026-06-10T09:49:00Z',
    user_message_id: 'msg-1',
    user_message_preview: '现在是北京时间吗?',
    session_id: agent.id,
    total_messages: 2,
    total_tool_calls: 0,
    total_tokens: 120,
  };

  return render(
    <CrewTab
      agents={[agent]}
      filter="working"
      countsByFilter={{ working: 1, pending: 0, offline: 0 }}
      charNameMap={{ [agent.id]: 'Adam' }}
      currentAgent={agent}
      currentSummary={{ running: 0, pending: 0, completed: 1, failed: 0, error: 0 }}
      currentEvents={[event]}
      activeMessages={[
        {
          id: 'chat-1',
          role: 'user',
          content: '现在是北京时间吗?',
          timestamp: '2026-06-10T09:48:00Z',
        },
      ]}
      currentInput=""
      loadingHistory={false}
      sending={false}
      onFilterChange={() => {}}
      onChangeInput={() => {}}
      onSendTask={() => {}}
      onStopTask={() => {}}
      onPreviousAgent={() => {}}
      onNextAgent={() => {}}
      onSelectAgent={() => {}}
      taskStatusMeta={taskStatusMeta}
      pendingApprovals={[]}
      onResolveGuardPending={() => {}}
      guardResolvingId=""
      onDeleteAgent={() => {}}
      tokensByAgent={{ [agent.id]: 120 }}
      helpers={helpers}
      pendingImages={[]}
      onAddImages={() => {}}
      onRemoveImage={() => {}}
      fileInputRef={{ current: null }}
      onTaskDetailChange={() => {}}
      townText={getAgentTownText('zh')}
    />,
  );
}

describe('CrewTab task ledger launcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'event-1',
        status: 'completed',
        messages: [
          {
            message_id: 'detail-1',
            role: 'assistant',
            content_text: '任务详情摘要',
            timestamp: '2026-06-10T09:49:00Z',
          },
        ],
      }),
    })));
  });

  test('replaces the always-visible ledger panel with a launcher and expands the conversation area', async () => {
    const { container } = renderCrewTab();

    expect(container.querySelector('.tc-ledger-panel')).toBeNull();
    expect(container.querySelector('.console-dialog-shell')).toHaveClass('console-dialog-shell-wide');

    const launcher = screen.getByRole('button', { name: /任务账本/ });
    expect(launcher).toHaveClass('tc-ledger-launch');

    fireEvent.click(launcher);

    expect(await screen.findByText('任务详情摘要')).toBeInTheDocument();
  });

  test('localizes the task detail modal chrome in Chinese', async () => {
    renderCrewTab();

    fireEvent.click(screen.getByRole('button', { name: /任务账本/ }));

    expect(await screen.findByText('任务详情摘要')).toBeInTheDocument();
    expect(screen.getByText('任务详情')).toBeInTheDocument();
    expect(screen.getByText(/任务 event-1/)).toBeInTheDocument();
    expect(screen.getByText('任务 ID')).toBeInTheDocument();
    expect(screen.getByText('智能体')).toBeInTheDocument();
    expect(screen.getByText('会话')).toBeInTheDocument();
    expect(screen.getByText('用户消息')).toBeInTheDocument();
    expect(screen.getByText('助手')).toBeInTheDocument();

    expect(screen.queryByText('TASK DETAIL')).not.toBeInTheDocument();
    expect(screen.queryByText('Task ID')).not.toBeInTheDocument();
    expect(screen.queryByText('USER')).not.toBeInTheDocument();
    expect(screen.queryByText('ASSISTANT')).not.toBeInTheDocument();
  });
});
