import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
  TimelineMessage,
  ToolsViewAllModal,
  formatRuntimeGuardSessionTitle,
  getTimelineAppearance,
  mergeSessionHistorySessions,
  promoteRuntimeGuardSession,
  codexSessionRecordToRuntimeGuardSession,
  runtimeGuardAgentStatus,
  runtimeGuardSidebarLayoutMetrics,
  runtimeGuardStartSessionPayload,
  runtimeSessionRecordToRuntimeGuardSession,
  titleFromUserMessage,
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
  vi.useRealTimers();
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

function codexRateLimitsResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      installed: true,
      status: 'ready',
      five_hour: {
        remaining_percent: 68,
        used_percent: 32,
        resets_at: 1781607727,
      },
      seven_day: {
        remaining_percent: 55,
        used_percent: 45,
        resets_at: 1781762114,
      },
      plan_type: 'pro',
      message: '',
      error: null,
      ...overrides,
    },
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

  const getHistorySpy = vi.spyOn(chatAPI, 'getHistory').mockResolvedValue({
    data: {
      session_key: 'created-session',
      messages: [],
      instance_id: 'runtime-openclaw',
      platform: 'openclaw',
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
      xsafeclaw_version: '1.1.1',
    },
  } as any);
  vi.spyOn(sessionsAPI, 'listRuntime').mockResolvedValue({ data: { sessions: [] } } as any);
  vi.spyOn(systemAPI, 'listCodexSessions').mockResolvedValue({
    data: {
      installed: true,
      status: 'ready',
      sessions: [],
      next_cursor: null,
      message: '',
      error: null,
    },
  } as any);
  const getCodexSessionMessagesSpy = vi.spyOn(systemAPI, 'getCodexSessionMessages').mockResolvedValue({
    data: {
      installed: true,
      status: 'ready',
      thread_id: 'thread-empty',
      messages: [],
      message: '',
      error: null,
    },
  } as any);
  const startCodexConversationSpy = vi.spyOn(systemAPI, 'startCodexConversation').mockResolvedValue({
    data: {
      installed: true,
      status: 'ready',
      session_key: 'codex:thread-started',
      thread_id: 'thread-started',
      session_id: 'session-started',
      title: 'Codex',
      cwd: 'E:/configured-codex-workspace',
      instruction_hash: 'instruction-hash',
      instruction_bytes: 123,
      message: '',
      error: null,
    },
  } as any);
  const resumeCodexConversationSpy = vi.spyOn(systemAPI, 'resumeCodexConversation').mockResolvedValue({
    data: {
      installed: true,
      status: 'ready',
      session_key: 'codex:thread-abcdef123456',
      thread_id: 'thread-abcdef123456',
      session_id: 'session-codex-1',
      title: 'Codex CLI history',
      cwd: 'E:/work/codex-demo',
      instruction_hash: 'instruction-hash',
      instruction_bytes: 123,
      message: '',
      error: null,
    },
  } as any);
  const respondCodexUserInputRequestSpy = vi.spyOn(systemAPI, 'respondCodexUserInputRequest').mockResolvedValue({
    data: {
      status: 'sent',
      request_id: 'request-1',
    },
  } as any);
  const clearCodexGoalSpy = vi.spyOn(systemAPI as any, 'clearCodexGoal').mockResolvedValue({
    data: {
      status: 'cleared',
      thread_id: 'thread-started',
      cleared: true,
    },
  } as any);
  const codexRateLimitsSpy = vi.spyOn(systemAPI, 'getCodexRateLimits').mockResolvedValue(codexRateLimitsResponse() as any);
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

  return {
    startSessionSpy,
    smartStartSessionSpy,
    sendMessageStreamSpy,
    getHistorySpy,
    getCodexSessionMessagesSpy,
    startCodexConversationSpy,
    resumeCodexConversationSpy,
    respondCodexUserInputRequestSpy,
    clearCodexGoalSpy,
    codexRateLimitsSpy,
  };
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
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function expectedCodexFiveHourReset(resetsAt = 1781607727) {
  const time = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(resetsAt * 1000));
  return `Refreshes at ${time}`;
}

function expectedCodexWeekReset(resetsAt = 1781762114) {
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(resetsAt * 1000));
  return `Refreshes ${date}`;
}

function expectCodexQuotaRows(budget: HTMLElement, fiveHourPercent = '68%', weekPercent = '55%') {
  const quotaRows = Array.from(budget.querySelectorAll('.rg-codex-quota-row'));
  expect(quotaRows).toHaveLength(2);
  expect(quotaRows.every(row => row.classList.contains('is-centered-columns'))).toBe(true);
  expect(quotaRows[0].querySelector('.rg-codex-quota-percent')?.textContent).toBe(fiveHourPercent);
  expect(quotaRows[0].querySelector('.rg-codex-quota-window')?.textContent).toBe('5 hours');
  expect(quotaRows[0].querySelector('.rg-codex-quota-refresh')?.textContent).toBe(expectedCodexFiveHourReset());
  expect(quotaRows[1].querySelector('.rg-codex-quota-percent')?.textContent).toBe(weekPercent);
  expect(quotaRows[1].querySelector('.rg-codex-quota-window')?.textContent).toBe('1 week');
  expect(quotaRows[1].querySelector('.rg-codex-quota-refresh')?.textContent).toBe(expectedCodexWeekReset());
  expect(quotaRows[0].querySelector('.rg-codex-quota-percent')?.className).toBe(
    quotaRows[1].querySelector('.rg-codex-quota-percent')?.className,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-path" hidden>{location.pathname}</span>;
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

describe('titleFromUserMessage', () => {
  it('falls back when the title model returns explanation text', () => {
    const modelExplanation = '我们需根据用户请求生成UI标题。用户请求是中文：“帮我查一下上海今天的天气怎么样？” 规则要求使用同一种语言。';

    expect(titleFromUserMessage(modelExplanation, '帮我查一下上海今天的天气怎么样？')).toBe('上海天气查询');
  });

  it('compacts raw user requests instead of using them as labels', () => {
    const request = '今年高考数学难度大吗？相比去年，是难了还是简单了？';

    expect(titleFromUserMessage('帮我查一下今天的天气')).toBe('天气查询');
    expect(titleFromUserMessage(request, request)).toBe('高考数学难度对比');
    expect(titleFromUserMessage(request)).toBe('高考数学难度对比');
  });
});

describe('formatRuntimeGuardSessionTitle', () => {
  it('shows generated labels without an agent prefix', () => {
    expect(formatRuntimeGuardSessionTitle({ agent: 'OpenClaw', title: '查询天气' })).toBe('查询天气');
    expect(formatRuntimeGuardSessionTitle({ agent: 'Hermes', title: 'Hermes:查询天气' })).toBe('查询天气');
    expect(formatRuntimeGuardSessionTitle({ agent: 'Nanobot', title: 'Nanobot' })).toBe('Nanobot');
  });
});

describe('NewTaskModal', () => {
  it('renders the smart hint, request box, and bottom-right create control', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();

    function Harness() {
      const [request, setRequest] = useState('');
      return (
        <NewTaskModal
          request={request}
          onRequestChange={setRequest}
          onCreate={onCreate}
          onClose={onClose}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect(screen.queryByLabelText('New task agent')).toBeNull();
    expect(screen.getByText('Automatically uses the most suitable agent for the task.')).toBeTruthy();

    const createButton = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(createButton.className).toContain('rg-new-task-create');
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

  it('opens from the left New Task card and routes smart create through the smart API', async () => {
    const { startSessionSpy, smartStartSessionSpy, sendMessageStreamSpy } = mockRuntimeGuardApis();
    renderRuntimeGuardConsole();

    fireEvent.click(screen.getByText('New Task').closest('button') as HTMLElement);

    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect(screen.queryByLabelText('New task agent')).toBeNull();

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

  it('does not show agent options even when only some agents are available', async () => {
    const { startSessionSpy, smartStartSessionSpy } = mockRuntimeGuardApis();
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
      expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    });
    expect(screen.queryByLabelText('New task agent')).toBeNull();

    fireEvent.change(screen.getByLabelText('New task request'), { target: { value: 'Start an automatically routed task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(smartStartSessionSpy).toHaveBeenCalledWith({ message: 'Start an automatically routed task' });
    });
    expect(startSessionSpy).not.toHaveBeenCalled();
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
    expect(screen.queryByLabelText('New task agent')).toBeNull();
    fireEvent.change(screen.getByLabelText('New task request'), { target: { value: 'Create a smart task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('Smart routing failed. Please choose an available agent manually.')).toBeTruthy();
    });
    expect(screen.queryByText('Nanobot is not available')).toBeNull();
    expect(startSessionSpy).not.toHaveBeenCalled();
  });

  it('opens the installed agent configure page from the left agent row context menu', async () => {
    mockRuntimeGuardApis();
    renderRuntimeGuardConsole();

    const openClawRow = await screen.findByTitle('Left click to select, right click to configure OpenClaw');
    fireEvent.contextMenu(openClawRow);

    await waitFor(() => {
      expect(screen.getByTestId('location-path').textContent).toBe('/openclaw_configure');
    });
  });

  it('opens the Codex configure page from the Codex row context menu', async () => {
    mockRuntimeGuardApis();
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.contextMenu(codexRow);

    await waitFor(() => {
      expect(screen.getByTestId('location-path').textContent).toBe('/codex_configure');
    });
  });

  it('shows Codex as the fourth sidebar agent before tool permissions', async () => {
    mockRuntimeGuardApis();
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    await screen.findByText('Codex');

    const sidebar = container.querySelector('.rg-sidebar') as HTMLElement;
    const agentRows = Array.from(sidebar.querySelectorAll('.rg-agent-row'));
    expect(agentRows.map(row => row.querySelector('.rg-agent-name')?.textContent)).toEqual([
      'OpenClaw',
      'Hermes',
      'Nanobot',
      'Codex',
    ]);
    expect(agentRows[3].querySelector('.rg-agent-badge')).toHaveClass('agent-codex');
    expect((sidebar.textContent ?? '').indexOf('Codex')).toBeLessThan((sidebar.textContent ?? '').indexOf('TOOL PERMISSION'));
  });

  it('switches the budget card to Codex CLI remaining usage when Codex is selected', async () => {
    mockRuntimeGuardApis();
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(codexRow);

    expect(codexRow).toHaveClass('is-selected');
    const budget = container.querySelector('.rg-budget') as HTMLElement;
    expect(within(budget).getByText('BUDGET')).toBeTruthy();
    expect(within(budget).getByText('Refresh')).toBeTruthy();
    await waitFor(() => {
      expectCodexQuotaRows(budget);
    });
    expect(within(budget).queryByText('Remaining Usage')).toBeNull();
    expect(within(budget).queryByText('$0.00')).toBeNull();
    expect(budget.querySelector('.rg-budget-amount-line')).toBeNull();
    expect(budget.querySelector('.rg-budget-bar')).toBeNull();
  });

  it('allows an uninstalled Codex row to be selected for viewing Codex CLI quota', async () => {
    mockRuntimeGuardApis();
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: false,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(codexRow);

    expect(codexRow).toHaveClass('is-selected');
    expect(codexRow).toHaveClass('is-uninstalled');
    const budget = container.querySelector('.rg-budget') as HTMLElement;
    expect(within(budget).getByText('BUDGET')).toBeTruthy();
    expect(within(budget).getByText('Refresh')).toBeTruthy();
    await waitFor(() => {
      expectCodexQuotaRows(budget);
    });
  });

  it('refreshes Codex quota when the details action is clicked', async () => {
    const { codexRateLimitsSpy } = mockRuntimeGuardApis();
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(codexRow);

    await waitFor(() => {
      expect(codexRateLimitsSpy).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(container.querySelector('.rg-budget-settings') as HTMLElement);

    await waitFor(() => {
      expect(codexRateLimitsSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('silently refreshes Codex quota every 60 seconds while Codex is selected', async () => {
    const { codexRateLimitsSpy } = mockRuntimeGuardApis();
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    vi.useFakeTimers();
    fireEvent.click(codexRow);

    await act(async () => {
      await Promise.resolve();
    });
    expect(codexRateLimitsSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    expect(codexRateLimitsSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(codexRateLimitsSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps the Codex quota layout visible when rate limit loading fails', async () => {
    mockRuntimeGuardApis();
    vi.mocked(systemAPI.getCodexRateLimits).mockRejectedValueOnce(new Error('codex app-server failed'));
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(codexRow);

    await waitFor(() => {
      const budget = container.querySelector('.rg-budget') as HTMLElement;
      const quotaRows = Array.from(budget.querySelectorAll('.rg-codex-quota-row'));
      expect(quotaRows).toHaveLength(2);
      expect(quotaRows[0].querySelector('.rg-codex-quota-percent')?.textContent).toBe('--%');
      expect(quotaRows[1].querySelector('.rg-codex-quota-percent')?.textContent).toBe('--%');
      expect(quotaRows[0].querySelector('.rg-codex-quota-refresh')?.textContent).toBe('Not available');
      expect(quotaRows[1].querySelector('.rg-codex-quota-refresh')?.textContent).toBe('Not available');
    });
  });

  it('creates a backend Codex session shell from the Codex open button', async () => {
    const {
      startSessionSpy,
      smartStartSessionSpy,
      getHistorySpy,
      sendMessageStreamSpy,
      startCodexConversationSpy,
    } = mockRuntimeGuardApis();
    window.localStorage.setItem('xsafeclaw:codex_config', JSON.stringify({
      configVersion: 2,
      workspaceDir: 'E:/configured-codex-workspace',
      permissionMode: 'workspace_write',
      defaultModel: 'GPT-5.5',
      defaultReasoning: 'xhigh',
      defaultSpeed: 'standard',
    }));
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    await waitFor(() => {
      expect(container.querySelector('.rg-chat-tab-title')?.textContent).toBe('Codex');
    });

    expect(startCodexConversationSpy).toHaveBeenCalledWith({
      cwd: 'E:/configured-codex-workspace',
      model: 'GPT-5.5',
      permission_mode: 'workspace_write',
    });
    expect(startSessionSpy).not.toHaveBeenCalled();
    expect(smartStartSessionSpy).not.toHaveBeenCalled();
    expect(getHistorySpy).not.toHaveBeenCalled();
    expect(container.querySelector('.rg-task-title h1')?.textContent).toBe('Codex');

    const savedSessions = JSON.parse(window.localStorage.getItem('xsafeclaw:runtime-guard:sessions') ?? '[]');
    expect(savedSessions[0]).toEqual(expect.objectContaining({
      agent: 'Codex',
      displayName: 'Codex CLI',
      historySessionId: 'thread-started',
      instanceId: 'codex-cli',
      platform: 'codex',
      title: 'Codex',
      workspacePath: 'E:/configured-codex-workspace',
    }));
    expect(savedSessions[0].frontendOnly).toBeFalsy();
    expect(savedSessions[0].sessionKey).toBe('codex:thread-started');

    const composer = container.querySelector('.rg-codex-composer') as HTMLElement;
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Ask Codex' }), {
      target: { value: 'hello Codex' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(sendMessageStreamSpy).toHaveBeenCalledWith(
        '/api/system/codex/conversations/codex%3Athread-started/turns/stream',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    const [, codexRequest] = sendMessageStreamSpy.mock.calls[0];
    expect(JSON.parse((codexRequest as RequestInit).body as string)).toEqual({
      message: 'hello Codex',
      thread_id: 'thread-started',
      cwd: 'E:/configured-codex-workspace',
      model: 'gpt-5.5',
      reasoning_effort: 'xhigh',
      speed: 'standard',
      permission_mode: 'workspace_write',
      plan_mode: false,
      goal_mode: false,
      goal_objective: null,
    });
    expect(screen.getByText('hello Codex')).toBeTruthy();
    expect(await screen.findByText('Task created')).toBeTruthy();
    expect(screen.queryByText('This is a Codex frontend preview session. Backend data is not connected yet.')).toBeNull();
  });

  it('sends Codex plan mode and renders streamed plan updates', async () => {
    const { sendMessageStreamSpy } = mockRuntimeGuardApis();
    sendMessageStreamSpy.mockImplementationOnce(async () => (
      new Response(
        `data: ${JSON.stringify({
          type: 'codex_plan_update',
          thread_id: 'thread-started',
          turn_id: 'turn-plan',
          explanation: 'I will inspect first.',
          steps: [
            { step: 'Inspect files', status: 'inProgress' },
            { step: 'Report plan', status: 'pending' },
          ],
        })}\n\ndata: ${JSON.stringify({
          type: 'codex_plan_update',
          thread_id: 'thread-started',
          turn_id: 'turn-plan',
          item_id: 'plan-item-1',
          text: '### Final plan\n\n- **Inspect** files\n- Implement fix',
        })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    ) as any);
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    const composer = await waitFor(() => {
      const node = container.querySelector('.rg-codex-composer') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Composer options' }));
    fireEvent.click(screen.getByRole('button', { name: /Plan Mode/ }));
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Ask Codex' }), {
      target: { value: 'make a plan' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      const [, request] = sendMessageStreamSpy.mock.calls[0];
      expect(JSON.parse((request as RequestInit).body as string)).toEqual(expect.objectContaining({
        message: 'make a plan',
        plan_mode: true,
        goal_mode: false,
        goal_objective: null,
      }));
    });
    expect(await screen.findByText('Codex plan')).toBeTruthy();
    expect(screen.getByText('I will inspect first.')).toBeTruthy();
    expect(screen.getByText('Inspect files')).toBeTruthy();
    expect(container.querySelector('.rg-codex-plan-card h3')?.textContent).toBe('Final plan');
    expect(container.querySelector('.rg-codex-plan-card strong')?.textContent).toBe('Inspect');
    expect(screen.queryByText('### Final plan')).toBeNull();
    expect(await screen.findByText('Execute this plan, or provide changes?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Execute plan' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Type changes to the plan...')).toBeTruthy();
  });

  it('sends a normal Codex turn when the local plan confirmation chooses execution', async () => {
    const { sendMessageStreamSpy } = mockRuntimeGuardApis();
    sendMessageStreamSpy
      .mockImplementationOnce(async () => (
        new Response(
          `data: ${JSON.stringify({
            type: 'codex_plan_update',
            thread_id: 'thread-started',
            turn_id: 'turn-plan',
            item_id: 'plan-item-1',
            text: '### Plan\n\n- Inspect',
          })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      ) as any)
      .mockImplementationOnce(async () => (
        new Response('data: {"type":"final","text":"Executing"}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      ) as any);
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    const composer = await waitFor(() => {
      const node = container.querySelector('.rg-codex-composer') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Composer options' }));
    fireEvent.click(screen.getByRole('button', { name: /Plan Mode/ }));
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Ask Codex' }), {
      target: { value: 'make a plan' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }));

    await screen.findByText('Execute this plan, or provide changes?');
    fireEvent.click(screen.getByRole('button', { name: 'Execute plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));

    await waitFor(() => expect(sendMessageStreamSpy).toHaveBeenCalledTimes(2));
    const [, executeRequest] = sendMessageStreamSpy.mock.calls[1];
    expect(JSON.parse((executeRequest as RequestInit).body as string)).toEqual(expect.objectContaining({
      message: 'Please start executing the plan above.',
      plan_mode: false,
    }));
  });

  it('keeps plan mode when the local plan confirmation sends revision feedback', async () => {
    const { sendMessageStreamSpy } = mockRuntimeGuardApis();
    sendMessageStreamSpy
      .mockImplementationOnce(async () => (
        new Response(
          `data: ${JSON.stringify({
            type: 'codex_plan_update',
            thread_id: 'thread-started',
            turn_id: 'turn-plan',
            item_id: 'plan-item-1',
            text: '### Plan\n\n- Inspect',
          })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      ) as any)
      .mockImplementationOnce(async () => (
        new Response(
          `data: ${JSON.stringify({
            type: 'codex_plan_update',
            thread_id: 'thread-started',
            turn_id: 'turn-plan-revised',
            item_id: 'plan-item-2',
            text: '### Revised plan',
          })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      ) as any);
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    const composer = await waitFor(() => {
      const node = container.querySelector('.rg-codex-composer') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Composer options' }));
    fireEvent.click(screen.getByRole('button', { name: /Plan Mode/ }));
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Ask Codex' }), {
      target: { value: 'make a plan' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }));

    const feedbackInput = await screen.findByPlaceholderText('Type changes to the plan...');
    fireEvent.change(feedbackInput, { target: { value: 'Add a rollback step.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));

    await waitFor(() => expect(sendMessageStreamSpy).toHaveBeenCalledTimes(2));
    const [, revisionRequest] = sendMessageStreamSpy.mock.calls[1];
    expect(JSON.parse((revisionRequest as RequestInit).body as string)).toEqual(expect.objectContaining({
      message: 'Please revise the plan above using this feedback:\nAdd a rollback step.',
      plan_mode: true,
    }));
  });

  it('does not add local plan confirmation when Codex sends a native question for the plan turn', async () => {
    const { sendMessageStreamSpy } = mockRuntimeGuardApis();
    sendMessageStreamSpy.mockImplementationOnce(async () => (
      new Response(
        `data: ${JSON.stringify({
          type: 'codex_plan_update',
          thread_id: 'thread-started',
          turn_id: 'turn-plan',
          item_id: 'plan-item-1',
          text: '### Plan\n\n- Inspect',
        })}\n\ndata: ${JSON.stringify({
          type: 'codex_user_input_request',
          request_id: 'request-plan-native',
          thread_id: 'thread-started',
          turn_id: 'turn-plan',
          item_id: 'item-question-1',
          questions: [{
            id: 'question-1',
            header: 'Plan choice',
            question: 'Should I continue?',
            is_other: true,
            is_secret: false,
            options: [{ label: 'Continue', description: '' }],
          }],
        })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    ) as any);
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    const composer = await waitFor(() => {
      const node = container.querySelector('.rg-codex-composer') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Composer options' }));
    fireEvent.click(screen.getByRole('button', { name: /Plan Mode/ }));
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Ask Codex' }), {
      target: { value: 'make a plan' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Should I continue?')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Execute this plan, or provide changes?')).toBeNull());
  });

  it('sends Codex goal mode with the message as objective and renders goal status', async () => {
    const { sendMessageStreamSpy, clearCodexGoalSpy } = mockRuntimeGuardApis();
    sendMessageStreamSpy.mockImplementationOnce(async () => (
      new Response(
        `data: ${JSON.stringify({
          type: 'codex_goal_update',
          thread_id: 'thread-started',
          goal: {
            thread_id: 'thread-started',
            objective: 'finish migration',
            status: 'active',
          },
        })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    ) as any);
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    const composer = await waitFor(() => {
      const node = container.querySelector('.rg-codex-composer') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Composer options' }));
    fireEvent.click(screen.getByRole('button', { name: /Pursue Goal/ }));
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Ask Codex' }), {
      target: { value: 'finish migration' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      const [, request] = sendMessageStreamSpy.mock.calls[0];
      expect(JSON.parse((request as RequestInit).body as string)).toEqual(expect.objectContaining({
        message: 'finish migration',
        plan_mode: false,
        goal_mode: true,
        goal_objective: 'finish migration',
      }));
    });
    expect(await screen.findByText('Codex goal')).toBeTruthy();
    expect(screen.getAllByText('finish migration').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear goal' }));
    await waitFor(() => expect(clearCodexGoalSpy).toHaveBeenCalledWith('codex:thread-started', { thread_id: 'thread-started' }));
  });

  it('renders Codex user-input requests from the stream and responds through app-server', async () => {
    const { sendMessageStreamSpy, respondCodexUserInputRequestSpy } = mockRuntimeGuardApis();
    sendMessageStreamSpy.mockImplementationOnce(async () => (
      new Response(
        `data: ${JSON.stringify({
          type: 'codex_user_input_request',
          request_id: 'request-1',
          thread_id: 'thread-started',
          turn_id: 'turn-1',
          item_id: 'item-question-1',
          questions: [{
            id: 'question-1',
            header: 'Implementation choice',
            question: 'Which path should Codex take?',
            is_other: true,
            is_secret: false,
            options: [{ label: 'Minimal', description: 'Keep the change small' }],
          }],
        })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    ) as any);
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    const composer = await waitFor(() => {
      const node = container.querySelector('.rg-codex-composer') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Ask Codex' }), {
      target: { value: 'ask a question' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Which path should Codex take?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Minimal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));

    await waitFor(() => expect(respondCodexUserInputRequestSpy).toHaveBeenCalledWith(
      'codex:thread-started',
      'request-1',
      { answers: { 'question-1': { answers: ['Minimal'] } } },
    ));
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
  });

  it('shows Codex-only composer controls with local menus and interrupt action', async () => {
    const { sendMessageStreamSpy } = mockRuntimeGuardApis();
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    const composer = await waitFor(() => {
      const node = container.querySelector('.rg-codex-composer') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    expect(container.querySelector('.rg-command-input')).toBeNull();
    const taskPanel = container.querySelector('.rg-task-panel') as HTMLElement;
    expect(taskPanel).toHaveClass('has-codex-composer');
    expect(taskPanel.querySelector(':scope > .rg-codex-composer')).toBe(composer);
    expect(container.querySelector('.rg-task-scroll .rg-codex-composer')).toBeNull();
    const toolbar = composer.querySelector('.rg-codex-toolbar') as HTMLElement;
    expect(Array.from(toolbar.children).map(child => child.className)).toEqual([
      'rg-codex-left-controls',
      'rg-codex-toolbar-spacer',
      'rg-codex-right-controls',
    ]);
    const rightControls = composer.querySelector('.rg-codex-right-controls') as HTMLElement;
    expect(rightControls.contains(composer.querySelector('.rg-codex-model-wrap'))).toBe(true);
    expect(Array.from(rightControls.children).map(child => child.className)).toEqual([
      'rg-codex-model-wrap',
      expect.stringContaining('rg-codex-send'),
    ]);
    const leftControls = composer.querySelector('.rg-codex-left-controls') as HTMLElement;
    expect(Array.from(leftControls.children).map(child => child.className)).toContain('rg-codex-permission-wrap');
    const permissionButton = within(composer).getByRole('button', { name: 'Select Codex permission: Workspace write' });
    expect(permissionButton.textContent).toContain('Workspace write');
    fireEvent.click(permissionButton);
    expect(within(composer).getByText('Permission')).toBeTruthy();
    const readOnlyPermission = within(composer).getByRole('button', { name: 'Read only' });
    const fullAccessPermission = within(composer).getByRole('button', { name: 'Full access' });
    expect(readOnlyPermission).toBeTruthy();
    expect(fullAccessPermission).toBeTruthy();
    fireEvent.click(readOnlyPermission);
    expect(composer.querySelector('.rg-codex-permission-menu')).toBeNull();
    expect(permissionButton.textContent).toContain('Read only');

    fireEvent.click(within(composer).getByRole('button', { name: 'Composer options' }));
    const planMode = within(composer).getByRole('button', { name: 'Plan Mode' });
    const pursueGoal = within(composer).getByRole('button', { name: 'Pursue Goal' });
    expect(planMode).toHaveAttribute('aria-pressed', 'false');
    expect(pursueGoal).toHaveAttribute('aria-pressed', 'false');
    expect(composer.querySelector('.rg-codex-mode-indicator')).toBeNull();
    fireEvent.click(planMode);
    expect(planMode).toHaveAttribute('aria-pressed', 'true');
    expect(pursueGoal).toHaveAttribute('aria-pressed', 'false');
    expect(composer.querySelector('.rg-codex-mode-indicator.is-plan')).toBeTruthy();
    expect(composer.querySelector('.rg-codex-mode-indicator.is-goal')).toBeNull();
    fireEvent.click(pursueGoal);
    expect(planMode).toHaveAttribute('aria-pressed', 'false');
    expect(pursueGoal).toHaveAttribute('aria-pressed', 'true');
    expect(composer.querySelector('.rg-codex-mode-indicator.is-plan')).toBeNull();
    expect(composer.querySelector('.rg-codex-mode-indicator.is-goal')).toBeTruthy();

    const modelButton = within(composer).getByRole('button', { name: /Select Codex model/ });
    expect(modelButton).toHaveClass('is-standard');
    expect(modelButton).not.toHaveClass('is-fast');
    expect(modelButton.querySelector('.lucide-zap')).toBeNull();
    fireEvent.click(modelButton);
    expect(within(composer).getByText('Reasoning')).toBeTruthy();
    expect(within(composer).queryByRole('button', { name: 'GPT-5.4' })).toBeNull();
    const modelEntry = within(composer).getByRole('button', { name: /GPT-5.5/ });
    expect(modelEntry.querySelector('.lucide-zap')).toBeNull();
    expect(within(composer).getByRole('button', { name: /Speed/ })).toBeTruthy();
    fireEvent.click(modelEntry);
    expect(composer.querySelector('.rg-codex-submenu')).toBeTruthy();
    expect(within(composer).getAllByRole('button', { name: /GPT-5.5/ }).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(within(composer).getByRole('button', { name: 'GPT-5.4' }));
    expect(composer.querySelector('.rg-codex-submenu')).toBeNull();
    fireEvent.click(within(composer).getByRole('button', { name: 'High' }));
    fireEvent.click(within(composer).getByRole('button', { name: /Speed/ }));
    const speedMenu = composer.querySelector('.rg-codex-submenu.is-speed') as HTMLElement;
    expect(speedMenu).toBeTruthy();
    const standardSpeedOption = within(speedMenu).getByRole('button', { name: /^Standard/ });
    const fastSpeedOption = within(speedMenu).getByRole('button', { name: /^Fast/ });
    const standardSpeedCopy = standardSpeedOption.querySelector('.rg-codex-speed-copy') as HTMLElement;
    const fastSpeedCopy = fastSpeedOption.querySelector('.rg-codex-speed-copy') as HTMLElement;
    expect(standardSpeedCopy).toBeTruthy();
    expect(fastSpeedCopy).toBeTruthy();
    fireEvent.click(fastSpeedOption);
    expect(modelButton).toHaveClass('is-fast');
    expect(modelButton).not.toHaveClass('is-standard');
    expect(modelButton.querySelector('.lucide-zap')).toBeTruthy();
    expect(modelButton.textContent).toContain('5.4');
    expect(modelButton.textContent).toContain('High');

    if (!composer.querySelector('.rg-codex-model-menu')) {
      fireEvent.click(modelButton);
    }
    fireEvent.click(within(composer).getByRole('button', { name: /GPT-5.4/ }));
    fireEvent.click(within(composer).getByRole('button', { name: 'GPT-5.4-Mini' }));
    expect(composer.querySelector('.rg-codex-submenu')).toBeNull();
    expect(modelButton).toHaveClass('is-standard');
    expect(modelButton).not.toHaveClass('is-fast');
    fireEvent.click(modelButton);
    expect(within(composer).queryByRole('button', { name: /Speed/ })).toBeNull();

    fireEvent.change(within(composer).getByRole('textbox', { name: 'Ask Codex' }), {
      target: { value: 'draft local Codex action' },
    });
    let closeStream = () => {};
    sendMessageStreamSpy
      .mockImplementationOnce(async () => (
        new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            closeStream = () => controller.close();
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      ) as any)
      .mockImplementationOnce(async () => (
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      ) as any);
    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }));

    const interruptButton = await within(composer).findByRole('button', { name: 'Interrupt response' });
    fireEvent.click(interruptButton);

    await waitFor(() => {
      expect(sendMessageStreamSpy).toHaveBeenCalledWith(
        '/api/system/codex/conversations/codex%3Athread-started/interrupt',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    closeStream();
  });

  it('closes Codex composer option and model menus when clicking outside', async () => {
    mockRuntimeGuardApis();
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    const codexRow = (await screen.findByText('Codex')).closest('.rg-agent-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: /Open/ }));

    const composer = await waitFor(() => {
      const node = container.querySelector('.rg-codex-composer') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    const taskPanel = container.querySelector('.rg-task-panel') as HTMLElement;

    fireEvent.click(within(composer).getByRole('button', { name: 'Composer options' }));
    expect(composer.querySelector('.rg-codex-options-menu')).toBeTruthy();
    fireEvent.click(within(composer).getByRole('button', { name: 'Plan Mode' }));
    expect(composer.querySelector('.rg-codex-options-menu')).toBeTruthy();
    fireEvent.pointerDown(taskPanel);
    expect(composer.querySelector('.rg-codex-options-menu')).toBeNull();

    fireEvent.click(within(composer).getByRole('button', { name: /Select Codex model/ }));
    expect(composer.querySelector('.rg-codex-model-menu')).toBeTruthy();
    fireEvent.click(within(composer).getByRole('button', { name: 'High' }));
    expect(composer.querySelector('.rg-codex-model-menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(composer.querySelector('.rg-codex-model-menu')).toBeNull();
  });

  it('restores a frontend-only Codex session without loading backend history', async () => {
    const { getHistorySpy } = mockRuntimeGuardApis();
    window.localStorage.setItem('xsafeclaw:runtime-guard:sessions', JSON.stringify([{
      sessionKey: 'codex::frontend::saved-session',
      agent: 'Codex',
      platform: 'codex',
      instanceId: 'codex-frontend',
      displayName: 'Codex App',
      frontendOnly: true,
      title: 'Codex',
      createdAt: '2026-06-15T00:00:00.000Z',
      status: 'ready',
    }]));
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
        xsafeclaw_version: '1.1.1',
      },
    } as any);
    const { container } = renderRuntimeGuardConsole();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Codex' })).toBeTruthy();
    });

    expect(getHistorySpy).not.toHaveBeenCalled();
    expect(container.querySelector('.rg-chat-tab-title')?.textContent).toBe('Codex');
    const codexRow = Array.from(container.querySelectorAll('.rg-agent-row'))
      .find(row => row.querySelector('.rg-agent-name')?.textContent === 'Codex') as HTMLElement;
    expect(codexRow).toHaveClass('is-selected');
    expectCodexQuotaRows(container.querySelector('.rg-budget') as HTMLElement);
  });

  it('opens Codex CLI history and renders the real transcript in the middle panel', async () => {
    const { getHistorySpy, getCodexSessionMessagesSpy, resumeCodexConversationSpy } = mockRuntimeGuardApis();
    vi.mocked(systemAPI.listCodexSessions).mockResolvedValue({
      data: {
        installed: true,
        status: 'ready',
        sessions: [
          {
            id: 'thread-abcdef123456',
            session_id: 'session-codex-1',
            title: 'Codex CLI history',
            preview: 'Summarize local changes',
            cwd: 'E:/work/codex-demo',
            created_at: '2026-06-15T12:00:00Z',
            updated_at: '2026-06-15T13:00:00Z',
            status: 'idle',
            source: 'cli',
            path: 'C:/Users/heng/.codex/sessions/thread.jsonl',
            cli_version: '0.139.0',
          },
        ],
        next_cursor: null,
        message: '',
        error: null,
      },
    } as any);
    getCodexSessionMessagesSpy.mockResolvedValueOnce({
      data: {
        installed: true,
        status: 'ready',
        thread_id: 'thread-abcdef123456',
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: '我现在的登录情况',
            timestamp: '2026-06-15T12:00:00Z',
          },
          {
            id: 'command-1',
            role: 'tool_call',
            content: '',
            timestamp: '2026-06-15T12:00:01Z',
            tool_id: 'command-1',
            tool_name: 'Shell',
            args: { command: 'codex login status', cwd: 'E:/work/codex-demo' },
            result: { output: 'Logged in using ChatGPT', exit_code: 0 },
            is_error: false,
            result_pending: false,
            tool_category: 'shell',
            tool_action: 'execute',
            timeline_kind: 'shell_command',
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '当前已经通过 ChatGPT 登录。',
            timestamp: '2026-06-15T12:00:02Z',
          },
        ],
        message: '',
        error: null,
      },
    } as any);

    const { container } = renderRuntimeGuardConsole();

    await waitFor(() => {
      expect(systemAPI.listCodexSessions).toHaveBeenCalledWith({ limit: 100 });
    });

    fireEvent.click(container.querySelector('.rg-session-history-head button') as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: 'Session history' });
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(within(dialog).getByText('Codex CLI history')).toBeTruthy();
    const codexHistoryRow = within(dialog).getByText('Codex CLI history').closest('.rg-session-modal-row') as HTMLElement;
    expect(codexHistoryRow.querySelector('.rg-session-modal-title em')?.textContent).toBe('E:/work/codex-demo');
    expect(codexHistoryRow.querySelector('.rg-session-modal-title em')?.textContent).not.toBe('Codex CLI');
    expect(screen.queryByTitle('Delete Codex CLI history')).toBeNull();

    fireEvent.click(within(dialog).getByText('Codex CLI history').closest('button') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Codex CLI history' })).toBeTruthy();
    });
    expect(resumeCodexConversationSpy).toHaveBeenCalledWith({
      thread_id: 'thread-abcdef123456',
      cwd: 'E:/work/codex-demo',
      model: 'GPT-5.5',
      permission_mode: 'workspace_write',
    });
    await waitFor(() => {
      expect(getCodexSessionMessagesSpy).toHaveBeenCalledWith('thread-abcdef123456');
    });
    expect(getHistorySpy).not.toHaveBeenCalledWith('codex:thread-abcdef123456');
    expect(screen.getByText('我现在的登录情况')).toBeTruthy();
    expect(screen.getByText('当前已经通过 ChatGPT 登录。')).toBeTruthy();
    expect(container.querySelector('.rg-session-meta')?.textContent ?? '').toContain('workspace:E:/work/codex-demo');
  });

  it('reloads Codex CLI history when an older frontend Codex shell already cached the same session key', async () => {
    const { getHistorySpy, getCodexSessionMessagesSpy } = mockRuntimeGuardApis();
    window.localStorage.setItem('xsafeclaw:runtime-guard:sessions', JSON.stringify([
      {
        sessionKey: 'codex:thread-abcdef123456',
        agent: 'Codex',
        platform: 'codex',
        instanceId: 'codex-frontend',
        displayName: 'Codex App',
        frontendOnly: true,
        codexHistory: false,
        title: 'Stale frontend shell',
        createdAt: '2026-06-15T11:00:00.000Z',
        status: 'ready',
      },
    ]));
    vi.mocked(systemAPI.listCodexSessions).mockResolvedValue({
      data: {
        installed: true,
        status: 'ready',
        sessions: [
          {
            id: 'thread-abcdef123456',
            session_id: 'session-codex-1',
            title: 'Codex CLI history',
            preview: 'Summarize local changes',
            cwd: 'E:/work/codex-demo',
            created_at: '2026-06-15T12:00:00Z',
            updated_at: '2026-06-15T13:00:00Z',
            status: 'idle',
            source: 'cli',
            path: 'C:/Users/heng/.codex/sessions/thread.jsonl',
            cli_version: '0.139.0',
          },
        ],
        next_cursor: null,
        message: '',
        error: null,
      },
    } as any);
    getCodexSessionMessagesSpy.mockResolvedValueOnce({
      data: {
        installed: true,
        status: 'ready',
        thread_id: 'thread-abcdef123456',
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '这是重新加载出来的真实 Codex 历史。',
            timestamp: '2026-06-15T12:00:02Z',
          },
        ],
        message: '',
        error: null,
      },
    } as any);

    const { container } = renderRuntimeGuardConsole();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Stale frontend shell' })).toBeTruthy();
    });
    expect(getCodexSessionMessagesSpy).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('.rg-session-history-head button') as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: 'Session history' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Codex' }));
    fireEvent.click(within(dialog).getByText('Codex CLI history').closest('button') as HTMLElement);

    await waitFor(() => {
      expect(getCodexSessionMessagesSpy).toHaveBeenCalledWith('thread-abcdef123456');
    });
    expect(getHistorySpy).not.toHaveBeenCalledWith('codex:thread-abcdef123456');
    await waitFor(() => {
      expect(screen.getByText('这是重新加载出来的真实 Codex 历史。')).toBeTruthy();
    });
    expect(screen.getByRole('heading', { name: 'Codex CLI history' })).toBeTruthy();
  });

  it('keeps runtime history visible when Codex CLI history fails to load', async () => {
    mockRuntimeGuardApis();
    vi.mocked(sessionsAPI.listRuntime).mockResolvedValue({
      data: {
        sessions: [
          {
            session_id: 'db-session-openclaw',
            platform: 'openclaw',
            instance_id: 'runtime-openclaw',
            source_session_id: 'source-openclaw',
            display_session_id: 'OpenClaw real history',
            session_key: 'openclaw::runtime-openclaw::source-openclaw',
            first_seen_at: '2026-06-15T10:00:00.000Z',
            last_activity_at: '2026-06-15T11:00:00.000Z',
            cwd: 'E:/work/openclaw-demo',
            current_model_provider: null,
            current_model_name: null,
            total_runs: 1,
            total_tokens: 10,
            created_at: '2026-06-15T10:00:00.000Z',
            updated_at: '2026-06-15T11:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      },
    } as any);
    vi.mocked(systemAPI.listCodexSessions).mockRejectedValue(new Error('codex app-server failed'));

    const { container } = renderRuntimeGuardConsole();

    await waitFor(() => {
      expect(systemAPI.listCodexSessions).toHaveBeenCalledWith({ limit: 100 });
    });
    fireEvent.click(container.querySelector('.rg-session-history-head button') as HTMLElement);
    expect(within(screen.getByRole('dialog', { name: 'Session history' })).getByText('OpenClaw real history')).toBeTruthy();
  });

  it('previews only active-session approvals in the right approval panel', async () => {
    mockRuntimeGuardApis();
    const activeSessionKey = 'openclaw::runtime-openclaw::active-session';
    const otherSessionKey = 'openclaw::runtime-openclaw::other-session';
    window.localStorage.setItem('xsafeclaw:runtime-guard:sessions', JSON.stringify([
      {
        sessionKey: activeSessionKey,
        agent: 'OpenClaw',
        platform: 'openclaw',
        instanceId: 'runtime-openclaw',
        title: 'Active',
        createdAt: '2026-06-09T00:00:00.000Z',
        status: 'ready',
      },
      {
        sessionKey: otherSessionKey,
        agent: 'OpenClaw',
        platform: 'openclaw',
        instanceId: 'runtime-openclaw',
        title: 'Other',
        createdAt: '2026-06-08T00:00:00.000Z',
        status: 'ready',
      },
    ]));
    vi.mocked(guardAPI.pending).mockResolvedValue({
      data: [
        approval({
          id: 'approval-active',
          session_key: activeSessionKey,
          instance_id: 'runtime-openclaw',
          params: { command: 'active-session-command' },
          created_at: 1710000002,
        }),
        approval({
          id: 'approval-other',
          session_key: otherSessionKey,
          instance_id: 'runtime-openclaw',
          params: { command: 'other-session-command' },
          created_at: 1710000003,
        }),
      ],
    } as any);

    const { container } = renderRuntimeGuardConsole();
    const panel = container.querySelector('.rg-approval-center') as HTMLElement;

    await waitFor(() => {
      expect(within(panel).getByText('active-session-command')).toBeTruthy();
    });
    expect(within(panel).queryByText('other-session-command')).toBeNull();
    expect(panel.querySelector('.rg-count')?.textContent).toBe('1');
  });

  it('renders compact active session metadata with relative start and workspace', async () => {
    mockRuntimeGuardApis();
    window.localStorage.setItem('xsafeclaw:runtime-guard:sessions', JSON.stringify([{
      sessionKey: 'openclaw::runtime-openclaw::weather-session',
      agent: 'OpenClaw',
      platform: 'openclaw',
      instanceId: 'runtime-openclaw',
      displayName: 'OpenClaw Agent',
      workspacePath: '/srv/xsafeclaw/weather',
      title: 'Weather lookup',
      createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      status: 'ready',
    }]));

    const { container } = renderRuntimeGuardConsole();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Weather lookup' })).toBeTruthy();
    });
    expect(container.querySelector('.rg-chat-tab-title')?.textContent).toBe('OpenClaw');
    const meta = container.querySelector('.rg-session-meta')?.textContent ?? '';
    expect(meta).toContain('3 minutes ago workspace:/srv/xsafeclaw/weather');
    expect(meta).not.toContain('OpenClaw Agent');
    expect(meta).not.toContain('openclaw');
    expect(meta).not.toContain('runtime-openclaw');
  });
});

describe('RuntimeGuardConsole i18n', () => {
  it('toggles the shared locale from the Language card and localizes budget units', async () => {
    mockRuntimeGuardApis();
    const { container } = renderRuntimeGuardConsole();

    expect(screen.getByText('New Task')).toBeTruthy();
    expect(screen.getByText('CN')).toBeTruthy();

    expect(screen.getByText('$0.00')).toBeTruthy();
    fireEvent.click(container.querySelector('.rg-budget-settings') as HTMLElement);
    expect(screen.getByRole('option', { name: 'Hour' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Day' })).toBeTruthy();

    fireEvent.click(screen.getByText('CN').closest('button') as HTMLElement);

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

describe('RuntimeGuardConsole sidebar layout', () => {
  it('aligns the budget card with the middle session panel and distributes sidebar gaps evenly', () => {
    const metrics = runtimeGuardSidebarLayoutMetrics();

    expect(metrics.budgetBottom).toBe(metrics.middleSessionPanelBottom);
    expect(Math.max(...metrics.visibleGaps) - Math.min(...metrics.visibleGaps)).toBeLessThanOrEqual(1);
  });
});

describe('getTimelineAppearance', () => {
  function message(overrides: Partial<ChatMessage>): ChatMessage {
    return {
      id: 'message-1',
      role: 'assistant',
      content: '',
      timestamp: new Date('2026-06-10T12:00:00.000Z'),
      ...overrides,
    };
  }

  it('maps user, assistant, trace, and runtime error rows', () => {
    expect(getTimelineAppearance(message({ role: 'user', content: 'hello' })).kind).toBe('user_message');
    expect(getTimelineAppearance(message({ role: 'assistant', content: 'done' })).kind).toBe('assistant_final');
    expect(getTimelineAppearance(message({ role: 'trace', trace_phase: 'planning' })).kind).toBe('assistant_thinking');
    expect(getTimelineAppearance(message({ role: 'error', content: 'boom' })).tone).toBe('red');
  });

  it('maps Codex question rows as user-input requests', () => {
    const appearance = getTimelineAppearance(message({
      role: 'codex_question',
      codex_question: 'Which path should I use?',
    }));

    expect(appearance.kind).toBe('codex_user_input');
    expect(appearance.tone).toBe('cyan');
  });

  it.each([
    ['exec', { command: 'echo hi' }, 'tool_shell', 'green'],
    ['read_file', { path: 'README.md' }, 'tool_file_read', 'yellow'],
    ['write_file', { path: 'README.md' }, 'tool_file_write', 'orange'],
    ['delete_file', { path: 'README.md' }, 'tool_file_delete', 'red'],
    ['browser_navigate', { url: 'https://example.com' }, 'tool_browser', 'purple'],
    ['search_web', { q: 'weather' }, 'tool_network', 'cyan'],
    ['git', { command: 'git status' }, 'tool_git', 'blue'],
    ['mcp_list_tools', { server: 'github' }, 'tool_mcp', 'purple'],
    ['custom_tool', { value: 1 }, 'tool_unknown', 'muted'],
  ])('falls back for legacy %s tool messages', (toolName, args, kind, tone) => {
    const appearance = getTimelineAppearance(message({
      role: 'tool_call',
      tool_name: toolName,
      args,
    }));

    expect(appearance.kind).toBe(kind);
    expect(appearance.tone).toBe(tone);
  });

  it('prefers backend metadata and marks guard-blocked tools red', () => {
    const appearance = getTimelineAppearance(message({
      role: 'tool_call',
      tool_name: 'exec',
      args: { command: 'echo hi' },
      timeline_kind: 'guard_blocked',
      tool_category: 'shell',
      tool_action: 'execute',
      is_error: true,
    }));

    expect(appearance.kind).toBe('guard_blocked');
    expect(appearance.tone).toBe('red');
  });

  it('maps approval state without changing the card identity', () => {
    expect(getTimelineAppearance(middleCard({ status: 'pending' })).kind).toBe('approval_request');
    expect(getTimelineAppearance(middleCard({ status: 'approved' })).kind).toBe('approval_allowed');
    expect(getTimelineAppearance(middleCard({ status: 'rejected' })).kind).toBe('approval_denied');
  });
});

describe('InlineApprovalCard', () => {
  it('renders as a timeline row with timestamp, icon, request details, and actions', () => {
    const { container } = render(
      <InlineApprovalCard card={middleCard()} resolving={false} onDecision={vi.fn()} />,
    );

    expect(container.querySelector('.rg-stream-row')).toBeTruthy();
    expect(container.querySelector('.rg-stream-row')).toHaveAttribute('data-kind', 'approval_request');
    expect(container.querySelector('.rg-stream-row')).toHaveAttribute('data-tone', 'yellow');
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

describe('TimelineMessage Codex question', () => {
  it('submits a selected option with the Codex user-input response shape', async () => {
    const onCodexQuestionSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TimelineMessage
        expanded={false}
        msg={{
          id: 'codex-question-1',
          role: 'codex_question',
          content: '',
          timestamp: new Date('2026-06-10T12:00:00.000Z'),
          codex_request_id: 'request-1',
          codex_questions: [{
            id: 'question-1',
            header: 'Implementation choice',
            question: 'Which approach should Codex use?',
            is_other: true,
            is_secret: false,
            options: [
              { label: 'Minimal change', description: 'Keep the change small' },
              { label: 'Full interaction', description: 'Build the full flow' },
            ],
          }],
          codex_response_status: 'pending',
        }}
        onCodexQuestionSubmit={onCodexQuestionSubmit}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText('Codex question')).toBeTruthy();
    expect(screen.getByText('Which approach should Codex use?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Minimal change' }));
    expect(screen.getByText('Selected: Minimal change')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));

    await waitFor(() => expect(onCodexQuestionSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ codex_request_id: 'request-1' }),
      { answers: { 'question-1': { answers: ['Minimal change'] } } },
    ));
  });

  it('submits a custom secret answer for questions without options', async () => {
    const onCodexQuestionSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TimelineMessage
        expanded={false}
        msg={{
          id: 'codex-question-secret',
          role: 'codex_question',
          content: '',
          timestamp: new Date('2026-06-10T12:00:00.000Z'),
          codex_request_id: 'request-secret',
          codex_questions: [{
            id: 'secret-question',
            header: 'Token',
            question: 'Paste the temporary code.',
            is_other: true,
            is_secret: true,
            options: [],
          }],
          codex_response_status: 'pending',
        }}
        onCodexQuestionSubmit={onCodexQuestionSubmit}
        onToggle={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('Type your answer...');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'temporary-code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));

    await waitFor(() => expect(onCodexQuestionSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ codex_request_id: 'request-secret' }),
      { answers: { 'secret-question': { answers: ['temporary-code'] } } },
    ));
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
    {
      sessionKey: 'session-codex',
      agent: 'Codex' as const,
      platform: 'codex' as const,
      instanceId: 'codex-local',
      displayName: 'Codex',
      title: 'Restore Codex transcript',
      createdAt: '2026-06-05T05:42:00.000Z',
      lastActivityAt: '2026-06-05T05:50:00.000Z',
      status: 'ready' as const,
      frontendOnly: true,
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
      cwd: '/srv/xsafeclaw/history-workspace',
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
      workspacePath: '/srv/xsafeclaw/history-workspace',
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

  it('maps Codex CLI thread summaries as readonly frontend sessions', () => {
    const mapped = codexSessionRecordToRuntimeGuardSession({
      id: 'thread-abcdef123456',
      session_id: 'session-codex-1',
      title: '',
      preview: 'Inspect app-server thread list',
      cwd: 'E:/work/codex-demo',
      created_at: '2026-06-15T12:00:00Z',
      updated_at: '2026-06-15T13:00:00Z',
      status: 'idle',
      source: 'cli',
      path: 'C:/Users/heng/.codex/sessions/thread.jsonl',
      cli_version: '0.139.0',
    });

    expect(mapped).toMatchObject({
      sessionKey: 'codex:thread-abcdef123456',
      historySessionId: 'thread-abcdef123456',
      agent: 'Codex',
      platform: 'codex',
      instanceId: 'codex-cli',
      displayName: 'Codex CLI',
      workspacePath: 'E:/work/codex-demo',
      title: 'Inspect app-server thread list',
      createdAt: '2026-06-15T12:00:00Z',
      lastActivityAt: '2026-06-15T13:00:00Z',
      status: 'ready',
      frontendOnly: true,
      codexHistory: true,
    });
  });

  it('promotes an already opened history session to the first tab position', () => {
    const promoted = promoteRuntimeGuardSession(sessions, sessions[1]);

    expect(promoted.map(session => session.sessionKey)).toEqual(['session-hermes', 'session-openclaw', 'session-codex']);
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
    expect(screen.queryByText('Restore Codex transcript')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.queryByText('Review protected file access')).toBeNull();
    expect(screen.getByText('Restore Codex transcript')).toBeTruthy();

    fireEvent.click(screen.getByText('Restore Codex transcript').closest('button') as HTMLElement);
    expect(onSelectSession).toHaveBeenCalledWith(sessions[2]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides delete controls for readonly Codex CLI history records', () => {
    const codexHistorySession = {
      ...sessions[2],
      sessionKey: 'codex:thread-abcdef123456',
      historySessionId: 'thread-abcdef123456',
      codexHistory: true,
    } as RuntimeGuardSession;
    render(
      <SessionHistoryViewAllModal
        sessions={[codexHistorySession]}
        loading={false}
        activeSessionId=""
        messageMap={{}}
        middleApprovalCardsBySession={{}}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Restore Codex transcript')).toBeTruthy();
    expect(screen.queryByTitle('Delete Restore Codex transcript')).toBeNull();
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
    expect(calculateGuardStatusSummary('Off', defaultPermissions, []).score).toBe(80);
    expect(calculateGuardStatusSummary('On', defaultPermissions, [
      approval({ id: 'pending-1' }),
      approval({ id: 'pending-2' }),
    ]).score).toBe(100);
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
    ]).score).toBe(80);
  });

  it('builds Guard Status display rows from guard mode', () => {
    const rows = buildGuardStatusRows('Off', {
      shell: 'Allowed',
      fileSystem: 'Asked',
      browser: 'Allowed',
      network: 'Guard',
      git: 'Allowed',
    }, 2);

    expect(rows).toEqual([
      { label: 'Prompt Injection', status: 'off', tone: 'muted' },
      { label: 'Data Leakage', status: 'off', tone: 'muted' },
      { label: 'Tool Call', status: 'off', tone: 'muted' },
      { label: 'Skill Injection', status: 'off', tone: 'muted' },
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
