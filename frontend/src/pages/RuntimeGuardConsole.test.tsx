import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  budgetAPI,
  chatAPI,
  guardAPI,
  sessionsAPI,
  systemAPI,
  type GuardPendingApproval,
} from '../services/api';
import { I18nProvider } from '../i18n';
import RuntimeGuardConsole, {
  AgentIconBadge,
  ApprovalViewAllModal,
  BlockedViewAllModal,
  InlineApprovalCard,
  NewTaskModal,
  SessionHistoryViewAllModal,
  ToolsViewAllModal,
  mergeSessionHistorySessions,
  newTaskOptionsFromAgents,
  promoteRuntimeGuardSession,
  runtimeGuardAgentStatus,
  runtimeGuardStartSessionPayload,
  runtimeSessionRecordToRuntimeGuardSession,
  type NewTaskAgentOption,
  type BlockedModalRange,
  type RuntimeGuardSession,
} from './RuntimeGuardConsole';
import type { ChatMessage } from '../stores/chatStreamStore';
import type { RuntimeInstance } from '../services/api';
import type { RecentBlockedItem } from './runtimeGuardBlocked';
import type { MiddleApprovalCard } from './runtimeGuardApproval';
import {
  buildGuardStatusRows,
  calculateGuardStatusSummary,
  runtimeGuardToolPermissionLabel,
  toolPermissionsFromPolicies,
  toolPoliciesFromPermissions,
  type RuntimeGuardToolPermissions,
} from './runtimeGuardToolPolicy';

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function I18nTestWrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function render(ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) {
  if (!window.localStorage.getItem('xsafeclaw:locale')) {
    window.localStorage.setItem('xsafeclaw:locale', 'en');
  }
  return rtlRender(ui, { wrapper: I18nTestWrapper, ...options });
}

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

function runtimeInstance(overrides: Partial<RuntimeInstance> = {}): RuntimeInstance {
  return {
    instance_id: 'runtime-openclaw',
    platform: 'openclaw',
    display_name: 'OpenClaw',
    config_path: null,
    workspace_path: null,
    sessions_path: null,
    serve_base_url: null,
    gateway_base_url: null,
    discovery_mode: 'auto',
    enabled: true,
    is_default: true,
    capabilities: {},
    attach_state: 'chat_ready',
    health_status: 'healthy',
    meta: {},
    ...overrides,
  };
}

function runtimeBudgetStatus(platform: 'openclaw' | 'hermes' | 'nanobot', overLimit = false) {
  return {
    platform,
    maxCost: overLimit ? 0.01 : null,
    periodValue: 24,
    periodUnit: 'hour',
    periodStartAt: '2026-06-09T00:00:00.000Z',
    periodEndAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    currentCost: overLimit ? 0.01 : 0,
    budgetUsed: overLimit ? 0.01 : 0,
    budgetPercent: overLimit ? 100 : 0,
    overLimit,
    remainingMs: 86_400_000,
    estimatedTokens: 0,
    costUnknownTokens: 0,
    costUnknownModels: 0,
    costBreakdown: [],
  };
}

function mockRuntimeGuardApis() {
  const sendMessageStreamSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
    new Response('data: {"type":"final","text":"Task created"}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  ) as any);
  const startSessionSpy = vi.spyOn(chatAPI, 'startSession').mockResolvedValue({
    data: {
      session_key: 'created-session',
      status: 'ready',
      instance_id: 'runtime-openclaw',
      platform: 'openclaw',
    },
  } as any);
  const smartStartSessionSpy = vi.spyOn(chatAPI, 'smartStartSession').mockResolvedValue({
    data: {
      session_key: 'smart-created-session',
      status: 'ready',
      instance_id: 'runtime-openclaw',
      platform: 'openclaw',
      selected_agent: 'OpenClaw',
      smart: true,
    },
  } as any);

  vi.spyOn(systemAPI, 'instances').mockResolvedValue({
    data: {
      instances: [
        runtimeInstance(),
        runtimeInstance({
          instance_id: 'runtime-nanobot',
          platform: 'nanobot',
          display_name: 'Nanobot',
        }),
      ],
      total: 2,
    },
  } as any);
  vi.spyOn(systemAPI, 'installStatus').mockResolvedValue({
    data: {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: true,
      xsafeclaw_version: '1.0.9',
    },
  } as any);
  vi.spyOn(sessionsAPI, 'listRuntime').mockResolvedValue({ data: { sessions: [] } } as any);
  vi.spyOn(budgetAPI, 'listRuntimeBudgets').mockResolvedValue({ data: { budgets: [] } } as any);
  vi.spyOn(guardAPI, 'pending').mockResolvedValue({ data: [] } as any);
  vi.spyOn(guardAPI, 'observations').mockResolvedValue({ data: [] } as any);
  vi.spyOn(guardAPI, 'getEnabled').mockResolvedValue({ data: { enabled: false } } as any);
  vi.spyOn(guardAPI, 'toolPolicies').mockResolvedValue({
    data: {
      policies: {
        shell: 'guard',
        file_system: 'guard',
        browser: 'guard',
        network: 'guard',
        git: 'guard',
      },
    },
  } as any);

  return { startSessionSpy, smartStartSessionSpy, sendMessageStreamSpy };
}

function renderRuntimeGuardConsole() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/backend']}>
        <RuntimeGuardConsole />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentIconBadge', () => {
  it('uses the shared visual class for each runtime agent', () => {
    const { container } = render(
      <>
        <AgentIconBadge agent="OpenClaw" />
        <AgentIconBadge agent="Hermes" />
        <AgentIconBadge agent="Nanobot" />
      </>,
    );

    expect(container.querySelector('.rg-agent-badge[data-agent="OpenClaw"]')).toHaveClass('agent-openclaw');
    expect(container.querySelector('.rg-agent-badge[data-agent="Hermes"]')).toHaveClass('agent-hermes');
    expect(container.querySelector('.rg-agent-badge[data-agent="Nanobot"]')).toHaveClass('agent-nanobot');
  });
});

describe('NewTaskModal', () => {
  it('builds options from available agents and appends smart only when an agent is available', () => {
    expect(newTaskOptionsFromAgents([
      { name: 'OpenClaw', available: true },
      { name: 'Hermes', available: false },
      { name: 'Nanobot', available: true },
    ])).toEqual(['OpenClaw', 'Nanobot', 'smart']);
    expect(newTaskOptionsFromAgents([
      { name: 'OpenClaw', available: false },
      { name: 'Hermes', available: false },
      { name: 'Nanobot', available: false },
    ])).toEqual([]);
  });

  it('renders the agent picker, request box, and create control', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();

    function Harness() {
      const [agent, setAgent] = useState<NewTaskAgentOption>('smart');
      const [request, setRequest] = useState('');
      return (
        <NewTaskModal
          agentOptions={['OpenClaw', 'Nanobot', 'smart']}
          selectedAgent={agent}
          request={request}
          onAgentChange={setAgent}
          onRequestChange={setRequest}
          onCreate={onCreate}
          onClose={onClose}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    const select = screen.getByLabelText('New task agent') as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.value)).toEqual(['OpenClaw', 'Nanobot', 'smart']);
    expect(select.value).toBe('smart');

    fireEvent.change(select, { target: { value: 'OpenClaw' } });
    expect(select.value).toBe('OpenClaw');

    const createButton = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

    const textarea = screen.getByLabelText('New task request') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Please inspect risky files' } });
    expect(textarea.value).toBe('Please inspect risky files');
    expect(createButton.disabled).toBe(false);

    fireEvent.click(createButton);
    expect(onCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Close new task'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a disabled no-agent picker when no agent is available', () => {
    const onCreate = vi.fn();
    render(
      <NewTaskModal
        agentOptions={[]}
        selectedAgent="smart"
        request="Plan a task"
        onAgentChange={vi.fn()}
        onRequestChange={vi.fn()}
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    );

    const select = screen.getByLabelText('New task agent') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(Array.from(select.options).map(option => option.textContent)).toEqual(['No available agents']);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('opens from the left New Task card and routes smart create through the smart API', async () => {
    const { startSessionSpy, smartStartSessionSpy, sendMessageStreamSpy } = mockRuntimeGuardApis();
    renderRuntimeGuardConsole();

    fireEvent.click(screen.getByText('New Task').closest('button') as HTMLElement);

    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByLabelText('New task agent') as HTMLSelectElement).value).toBe('smart');
    });

    fireEvent.change(screen.getByLabelText('New task request'), { target: { value: 'Create a safe scan task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(smartStartSessionSpy).toHaveBeenCalledWith({ message: 'Create a safe scan task' });
    });
    expect(startSessionSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(sendMessageStreamSpy).toHaveBeenCalledWith('/api/chat/send-message-stream', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          session_key: 'smart-created-session',
          message: 'Create a safe scan task',
          client_context: 'runtime_guard',
        }),
      }));
    });
  });

  it('only shows currently available agents plus smart in the New Task picker', async () => {
    mockRuntimeGuardApis();
    vi.mocked(budgetAPI.listRuntimeBudgets).mockResolvedValue({
      data: {
        budgets: [
          runtimeBudgetStatus('openclaw', false),
          runtimeBudgetStatus('hermes', false),
          runtimeBudgetStatus('nanobot', true),
        ],
      },
    } as any);
    renderRuntimeGuardConsole();

    fireEvent.click(screen.getByText('New Task').closest('button') as HTMLElement);

    await waitFor(() => {
      const select = screen.getByLabelText('New task agent') as HTMLSelectElement;
      expect(Array.from(select.options).map(option => option.value)).toEqual(['OpenClaw', 'smart']);
    });
  });

  it('creates a concrete agent session with the existing start-session API', async () => {
    const { startSessionSpy, smartStartSessionSpy, sendMessageStreamSpy } = mockRuntimeGuardApis();
    const { container } = renderRuntimeGuardConsole();

    fireEvent.click(screen.getByText('New Task').closest('button') as HTMLElement);
    await waitFor(() => {
      const select = screen.getByLabelText('New task agent') as HTMLSelectElement;
      expect(Array.from(select.options).map(option => option.value)).toContain('OpenClaw');
    });
    fireEvent.change(screen.getByLabelText('New task agent'), { target: { value: 'OpenClaw' } });
    fireEvent.change(screen.getByLabelText('New task request'), { target: { value: 'Start an OpenClaw task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(startSessionSpy).toHaveBeenCalledWith({
        instance_id: 'runtime-openclaw',
        label_mode: 'server_timestamp',
      });
    });
    expect(smartStartSessionSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(sendMessageStreamSpy).toHaveBeenCalledWith('/api/chat/send-message-stream', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          session_key: 'created-session',
          message: 'Start an OpenClaw task',
          client_context: 'runtime_guard',
        }),
      }));
    });

    await waitFor(() => {
      const sidebarBadge = container.querySelector('.rg-agent-row .rg-agent-badge[data-agent="OpenClaw"]');
      const tabBadge = container.querySelector('.rg-chat-tab .rg-agent-badge[data-agent="OpenClaw"]');
      expect(sidebarBadge).toHaveClass('agent-openclaw');
      expect(tabBadge).toHaveClass('agent-openclaw');
      expect(tabBadge).toHaveClass('rg-agent-badge-compact');
    });
  });

  it('shows a uniform smart failure toast without exposing router output', async () => {
    const { startSessionSpy, smartStartSessionSpy } = mockRuntimeGuardApis();
    smartStartSessionSpy.mockRejectedValueOnce({
      response: {
        data: {
          detail: {
            reason: 'smart_routing_failed',
            message: 'Nanobot is not available',
          },
        },
      },
    });
    renderRuntimeGuardConsole();

    fireEvent.click(screen.getByText('New Task').closest('button') as HTMLElement);
    await waitFor(() => {
      expect((screen.getByLabelText('New task agent') as HTMLSelectElement).value).toBe('smart');
    });
    fireEvent.change(screen.getByLabelText('New task request'), { target: { value: 'Create a smart task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('Smart routing failed. Please choose an available agent manually.')).toBeTruthy();
    });
    expect(screen.queryByText('Nanobot is not available')).toBeNull();
    expect(startSessionSpy).not.toHaveBeenCalled();
  });
});

describe('RuntimeGuardConsole i18n', () => {
  it('toggles the shared locale from the Language card and localizes budget units', async () => {
    mockRuntimeGuardApis();
    renderRuntimeGuardConsole();

    expect(screen.getByText('New Task')).toBeTruthy();
    expect(screen.getByText('Chinese')).toBeTruthy();

    fireEvent.click(screen.getByText(/^BUDGET - OpenClaw$/).closest('button') as HTMLElement);
    expect(screen.getByRole('option', { name: 'Hour' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Day' })).toBeTruthy();

    fireEvent.click(screen.getByText('Chinese').closest('button') as HTMLElement);

    await waitFor(() => {
      expect(window.localStorage.getItem('xsafeclaw:locale')).toBe('zh');
      expect(screen.getByText('新建任务')).toBeTruthy();
      expect(screen.getByText('工具权限')).toBeTruthy();
      expect(screen.getByRole('option', { name: '小时' })).toBeTruthy();
      expect(screen.getByRole('option', { name: '天' })).toBeTruthy();
    });

    fireEvent.click(screen.getByText('EN').closest('button') as HTMLElement);
    await waitFor(() => {
      expect(window.localStorage.getItem('xsafeclaw:locale')).toBe('en');
      expect(screen.getByText('New Task')).toBeTruthy();
    });
  });
});

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

describe('SessionHistoryViewAllModal', () => {
  const sessions: RuntimeGuardSession[] = [
    {
      sessionKey: 'session-openclaw',
      historySessionId: 'db-session-openclaw',
      agent: 'OpenClaw' as const,
      platform: 'openclaw' as const,
      instanceId: 'openclaw-1',
      displayName: 'OpenClaw',
      title: 'Fix login bug and add rate limit',
      createdAt: '2026-06-05T06:32:00.000Z',
      lastActivityAt: '2026-06-05T06:36:00.000Z',
      status: 'ready' as const,
    },
    {
      sessionKey: 'session-hermes',
      historySessionId: 'db-session-hermes',
      agent: 'Hermes' as const,
      platform: 'hermes' as const,
      instanceId: 'hermes-1',
      displayName: 'Hermes',
      title: 'Review protected file access',
      createdAt: '2026-06-05T05:58:00.000Z',
      lastActivityAt: '2026-06-05T06:01:00.000Z',
      status: 'ready' as const,
    },
  ];

  it('maps backend session records and merges them with open frontend tabs', () => {
    const mapped = runtimeSessionRecordToRuntimeGuardSession({
      session_id: 'db-session-1',
      platform: 'hermes',
      instance_id: 'hermes-main',
      source_session_id: 'source-session-1',
      display_session_id: 'Hermes real session',
      session_key: 'public-session-1',
      first_seen_at: '2026-06-05T04:00:00.000Z',
      last_activity_at: '2026-06-05T05:00:00.000Z',
      cwd: null,
      current_model_provider: null,
      current_model_name: null,
      total_runs: 2,
      total_tokens: 1024,
      created_at: '2026-06-05T04:00:00.000Z',
      updated_at: '2026-06-05T05:00:00.000Z',
    });

    expect(mapped).toMatchObject({
      sessionKey: 'public-session-1',
      historySessionId: 'db-session-1',
      agent: 'Hermes',
      platform: 'hermes',
      title: 'Hermes real session',
      lastActivityAt: '2026-06-05T05:00:00.000Z',
    });

    const merged = mergeSessionHistorySessions([mapped as RuntimeGuardSession], [{
      ...(mapped as RuntimeGuardSession),
      title: 'Frontend title',
      autoTitlePending: true,
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Frontend title');
    expect(merged[0].historySessionId).toBe('db-session-1');
  });

  it('promotes an already opened history session to the first tab position', () => {
    const promoted = promoteRuntimeGuardSession(sessions, sessions[1]);

    expect(promoted.map(session => session.sessionKey)).toEqual(['session-hermes', 'session-openclaw']);
  });

  it('renders existing frontend sessions, filters, and switches the active session', () => {
    const onSelectSession = vi.fn();
    const onDeleteSession = vi.fn();
    const onClose = vi.fn();
    render(
      <SessionHistoryViewAllModal
        sessions={sessions}
        loading={false}
        activeSessionId="session-openclaw"
        messageMap={{}}
        middleApprovalCardsBySession={{}}
        onSelectSession={onSelectSession}
        onDeleteSession={onDeleteSession}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Session history' })).toBeTruthy();
    expect(screen.queryByText('SESSION HISTORY')).toBeNull();
    expect(screen.getByText('Fix login bug and add rate limit')).toBeTruthy();
    expect(screen.getByText('Review protected file access')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search session history'), { target: { value: 'protected' } });
    expect(screen.queryByText('Fix login bug and add rate limit')).toBeNull();
    expect(screen.getByText('Review protected file access')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search session history'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hermes' }));
    expect(screen.queryByText('Fix login bug and add rate limit')).toBeNull();
    expect(screen.getByText('Review protected file access')).toBeTruthy();

    fireEvent.click(screen.getByText('Review protected file access').closest('button') as HTMLElement);
    expect(onSelectSession).toHaveBeenCalledWith(sessions[1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('confirms before deleting a session record', () => {
    const onDeleteSession = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <SessionHistoryViewAllModal
        sessions={sessions}
        loading={false}
        activeSessionId="session-openclaw"
        messageMap={{}}
        middleApprovalCardsBySession={{}}
        onSelectSession={vi.fn()}
        onDeleteSession={onDeleteSession}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Delete Fix login bug and add rate limit'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onDeleteSession).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTitle('Delete Fix login bug and add rate limit'));
    expect(onDeleteSession).toHaveBeenCalledWith(sessions[0]);

    confirmSpy.mockRestore();
  });

  it('shows an empty state and supports close interactions', () => {
    const onClose = vi.fn();
    const { container } = render(
      <SessionHistoryViewAllModal
        sessions={[]}
        loading={false}
        activeSessionId=""
        messageMap={{}}
        middleApprovalCardsBySession={{}}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('No session history')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Session history' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(container.querySelector('.rg-modal-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Close session history'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('runtimeGuardAgentStatus', () => {
  const openclawSession: RuntimeGuardSession = {
    sessionKey: 'session-openclaw',
    agent: 'OpenClaw',
    platform: 'openclaw',
    instanceId: 'openclaw-1',
    title: 'OpenClaw session',
    createdAt: '2026-06-05T06:32:00.000Z',
    status: 'ready',
  };
  const hermesSession: RuntimeGuardSession = {
    sessionKey: 'session-hermes',
    agent: 'Hermes',
    platform: 'hermes',
    instanceId: 'hermes-1',
    title: 'Hermes session',
    createdAt: '2026-06-05T06:33:00.000Z',
    status: 'ready',
  };
  const pendingAssistant: ChatMessage = {
    id: 'pending-assistant',
    role: 'assistant',
    content: '',
    timestamp: new Date('2026-06-05T06:34:00.000Z'),
    pending: true,
  };
  const pendingTool: ChatMessage = {
    id: 'pending-tool',
    role: 'tool_call',
    content: 'terminal',
    timestamp: new Date('2026-06-05T06:35:00.000Z'),
    result_pending: true,
  };

  it('shows Not installed when the framework is unavailable', () => {
    expect(runtimeGuardAgentStatus('OpenClaw', false, [openclawSession], {}, {})).toBe('Not installed');
  });

  it('shows Idle when installed sessions are not actively running', () => {
    expect(runtimeGuardAgentStatus('OpenClaw', true, [openclawSession], {}, {})).toBe('Idle');
    expect(runtimeGuardAgentStatus('OpenClaw', true, [openclawSession], {
      [openclawSession.sessionKey]: [{
        id: 'done',
        role: 'assistant',
        content: 'done',
        timestamp: new Date('2026-06-05T06:36:00.000Z'),
      }],
    }, {})).toBe('Idle');
  });

  it('shows Running only for agents with an active sending or pending session', () => {
    expect(runtimeGuardAgentStatus('OpenClaw', true, [openclawSession, hermesSession], {}, {
      [openclawSession.sessionKey]: true,
    })).toBe('Running');
    expect(runtimeGuardAgentStatus('Hermes', true, [openclawSession, hermesSession], {}, {
      [openclawSession.sessionKey]: true,
    })).toBe('Idle');
    expect(runtimeGuardAgentStatus('Hermes', true, [openclawSession, hermesSession], {
      [hermesSession.sessionKey]: [pendingAssistant],
    }, {})).toBe('Running');
    expect(runtimeGuardAgentStatus('Hermes', true, [openclawSession, hermesSession], {
      [hermesSession.sessionKey]: [pendingTool],
    }, {})).toBe('Running');
  });
});

describe('runtimeGuardStartSessionPayload', () => {
  const baseRuntime = {
    instance_id: 'runtime-1',
    display_name: 'Runtime',
    config_path: null,
    workspace_path: null,
    sessions_path: null,
    serve_base_url: null,
    gateway_base_url: null,
    discovery_mode: 'auto' as const,
    enabled: true,
    is_default: false,
    capabilities: {},
    attach_state: 'chat_ready',
    health_status: 'healthy',
    meta: {},
  };

  it('requests server timestamp labels for OpenClaw and Hermes only', () => {
    expect(runtimeGuardStartSessionPayload({
      ...baseRuntime,
      platform: 'openclaw',
    } as RuntimeInstance)).toEqual({
      instance_id: 'runtime-1',
      label_mode: 'server_timestamp',
    });
    expect(runtimeGuardStartSessionPayload({
      ...baseRuntime,
      platform: 'hermes',
    } as RuntimeInstance)).toEqual({
      instance_id: 'runtime-1',
      label_mode: 'server_timestamp',
    });
    expect(runtimeGuardStartSessionPayload({
      ...baseRuntime,
      platform: 'nanobot',
    } as RuntimeInstance)).toEqual({
      instance_id: 'runtime-1',
    });
  });
});

describe('ToolsViewAllModal', () => {
  it('calculates Guard Status from guard mode, tool permissions, and pending approvals', () => {
    const defaultPermissions: RuntimeGuardToolPermissions = {
      shell: 'Guard',
      fileSystem: 'Guard',
      browser: 'Guard',
      network: 'Guard',
      git: 'Guard',
    };

    expect(calculateGuardStatusSummary('On', defaultPermissions, []).score).toBe(100);
    expect(calculateGuardStatusSummary('Off', defaultPermissions, []).score).toBe(90);
    expect(calculateGuardStatusSummary('On', defaultPermissions, [
      approval({ id: 'pending-1' }),
      approval({ id: 'pending-2' }),
    ]).score).toBe(98);
    expect(calculateGuardStatusSummary('Off', {
      shell: 'Allowed',
      fileSystem: 'Allowed',
      browser: 'Allowed',
      network: 'Allowed',
      git: 'Allowed',
    }, [
      approval({ id: 'pending-1' }),
      approval({ id: 'pending-2' }),
      approval({ id: 'pending-3' }),
      approval({ id: 'pending-4' }),
    ]).score).toBe(77);
  });

  it('builds Guard Status rows from current tool settings', () => {
    const rows = buildGuardStatusRows('Off', {
      shell: 'Allowed',
      fileSystem: 'Asked',
      browser: 'Allowed',
      network: 'Guard',
      git: 'Allowed',
    }, 2);

    expect(rows).toEqual([
      { label: 'Guard Mode', status: 'off', tone: 'warning' },
      { label: 'Pending', status: '2 waiting', tone: 'warning' },
      { label: 'Shell', status: 'Allow', tone: 'success' },
      { label: 'File System', status: 'Ask', tone: 'asked' },
      { label: 'Browser', status: 'Allow', tone: 'success' },
      { label: 'Network/Git', status: 'Guard/Allow', tone: 'warning' },
    ]);
  });

  it('maps backend tool policies to frontend permissions and back', () => {
    const permissions = toolPermissionsFromPolicies({
      shell: 'ask',
      file_system: 'allow',
      browser: 'guard',
      network: 'allow',
      git: 'ask',
    });

    expect(permissions).toEqual({
      shell: 'Asked',
      fileSystem: 'Allowed',
      browser: 'Guard',
      network: 'Allowed',
      git: 'Asked',
    });
    expect(toolPoliciesFromPermissions(permissions)).toEqual({
      shell: 'ask',
      file_system: 'allow',
      browser: 'guard',
      network: 'allow',
      git: 'ask',
    });
  });

  it('renders configurable tool permissions and updates the selected state', () => {
    function Harness() {
      const [permissions, setPermissions] = useState<RuntimeGuardToolPermissions>({
        shell: 'Allowed',
        fileSystem: 'Guard',
        browser: 'Allowed',
        network: 'Guard',
        git: 'Guard',
      });

      return (
        <>
          <span data-testid="sidebar-shell">{runtimeGuardToolPermissionLabel(permissions.shell)}</span>
          <ToolsViewAllModal
            permissions={permissions}
            onClose={vi.fn()}
            onPermissionChange={(toolId, permission) => {
              setPermissions(current => ({ ...current, [toolId]: permission }));
            }}
          />
        </>
      );
    }

    render(<Harness />);

    expect(screen.getByRole('dialog', { name: 'Tool permissions' })).toBeTruthy();
    expect(screen.queryByText('TOOLS')).toBeNull();
    expect(document.querySelectorAll('.rg-tool-permission-mark')).toHaveLength(5);

    const shellGroup = screen.getByRole('group', { name: 'Shell permission' });
    const fileSystemGroup = screen.getByRole('group', { name: 'File System permission' });
    const browserGroup = screen.getByRole('group', { name: 'Browser permission' });
    const networkGroup = screen.getByRole('group', { name: 'Network permission' });
    const gitGroup = screen.getByRole('group', { name: 'Git permission' });

    expect(within(shellGroup).getByRole('button', { name: 'Allow' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(fileSystemGroup).getByRole('button', { name: 'Guard' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(browserGroup).getByRole('button', { name: 'Allow' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(networkGroup).getByRole('button', { name: 'Guard' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(gitGroup).getByRole('button', { name: 'Guard' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(shellGroup).getByRole('button', { name: 'Ask' }));

    expect(screen.getByTestId('sidebar-shell')).toHaveTextContent('Ask');
    expect(within(shellGroup).getByRole('button', { name: 'Ask' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(shellGroup).getByRole('button', { name: 'Allow' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('supports close interactions', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ToolsViewAllModal
        permissions={{ shell: 'Allowed', fileSystem: 'Guard', browser: 'Allowed', network: 'Guard', git: 'Guard' }}
        onClose={onClose}
        onPermissionChange={vi.fn()}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Tool permissions' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(container.querySelector('.rg-modal-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Close tool permissions'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
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
    expect(screen.getByRole('dialog', { name: 'Human approvals' })).toBeTruthy();
    expect(screen.queryByText('APPROVAL CENTER')).toBeNull();
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

    expect(screen.queryByText('RECENT BLOCKED')).toBeNull();

    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Blocked actions' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(container.querySelector('.rg-modal-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Close blocked events'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
