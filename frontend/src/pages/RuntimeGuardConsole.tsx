import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  type LucideIcon,
  AlertCircle,
  AlertTriangle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleQuestionMark,
  ClipboardList,
  Cpu,
  FolderOpen,
  GitBranch,
  Globe2,
  Loader2,
  Lock,
  Network,
  Plus,
  Route,
  Send,
  Shield,
  Target,
  Terminal,
  Trash2,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  budgetAPI,
  chatAPI,
  guardAPI,
  sessionsAPI,
  systemAPI,
  type BudgetPeriodUnit,
  type GuardPendingApproval,
  type GuardRuntimeObservation,
  type RuntimeBudgetPlatform,
  type RuntimeBudgetStatus,
  type RuntimeInstance,
  type StartSessionResponse,
  type RuntimeSessionRecord,
  type CodexSessionRecord,
  type CodexRateLimitWindow,
  type CodexRateLimitsResponse,
  type CodexRequestUserInputResponseRequest,
} from '../services/api';
import MarkdownMessage from '../components/MarkdownMessage';
import { useRuntimeInstances } from '../hooks/useAPI';
import { useI18n } from '../i18n';
import { chatStreamStore, type ChatMessage } from '../stores/chatStreamStore';
import {
  buildActiveTimelineRows,
  buildTimelineScrollKey,
  getActiveApprovalCards,
  upsertMiddleApprovalCards,
  type ApprovalDecision,
  type MiddleApprovalCardsBySession,
  type MiddleApprovalCard,
  type MiddleApprovalStatus,
} from './runtimeGuardApproval';
import {
  mergeBlockedItems,
  type RecentBlockedItem,
  type RecentBlockedSource,
} from './runtimeGuardBlocked';
import {
  buildGuardStatusRows,
  calculateGuardStatusSummary,
  defaultToolPermissions,
  toolPermissionsFromPolicies,
  toolPoliciesFromPermissions,
  type GuardStatusRowTone,
  type RuntimeGuardToolId,
  type RuntimeGuardToolPermission,
  type RuntimeGuardToolPermissions,
} from './runtimeGuardToolPolicy';
import { loadCodexConfig, type CodexPermissionMode } from './CodexConfigure';
import './RuntimeGuardConsole.css';

export type AgentName = 'OpenClaw' | 'Hermes' | 'Nanobot' | 'Codex';
type RuntimeAgentName = Exclude<AgentName, 'Codex'>;
type RuntimePlatform = RuntimeInstance['platform'];
type RuntimeGuardSessionPlatform = RuntimePlatform | 'codex';
type RuntimeBudgetStatusMap = Record<RuntimeBudgetPlatform, RuntimeBudgetStatus>;
type GuardMode = 'Off' | 'On';
type AgentStatus = 'Running' | 'Idle' | 'Not installed';
type CodexReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh';
type CodexModelOption = 'GPT-5.5' | 'GPT-5.4' | 'GPT-5.4-Mini' | 'GPT-5.3-Codex-Spark';
type CodexSpeedOption = 'standard' | 'fast';
type CodexComposerMenu = 'options' | 'model' | 'permission' | null;
type CodexSubmenu = 'model' | 'speed' | null;
type CodexRateLimitsState = {
  data: CodexRateLimitsResponse | null;
  loading: boolean;
  error: string | null;
};
export type RuntimeGuardSession = {
  sessionKey: string;
  historySessionId?: string;
  agent: AgentName;
  platform: RuntimeGuardSessionPlatform;
  instanceId: string;
  displayName?: string;
  workspacePath?: string;
  title: string;
  createdAt: string;
  lastActivityAt?: string;
  status: 'ready' | 'error';
  autoTitlePending?: boolean;
  frontendOnly?: boolean;
  codexHistory?: boolean;
};
type InstallMap = Record<AgentName, boolean | null>;
type AgentDisplay = {
  name: AgentName;
  status: AgentStatus;
  className: string;
  installed: boolean;
  runtimeBacked: boolean;
};
type RuntimeGuardModal = 'tools' | 'sessions' | 'approvals' | 'blocked' | null;
type SessionHistoryAgentFilter = 'All' | AgentName;
export type BlockedModalRange = '24h' | '7d' | 'all';

const RUNTIME_GUARD_SESSIONS_KEY = 'xsafeclaw:runtime-guard:sessions';
const RUNTIME_GUARD_DRAFTS_KEY = 'xsafeclaw:runtime-guard:drafts';
const APPROVAL_POLL_INTERVAL_MS = 3000;
const CODEX_QUOTA_REFRESH_INTERVAL_MS = 60_000;
const BUILD_TIME_XSAFECLAW_VERSION = import.meta.env.VITE_XSAFECLAW_VERSION || null;
const RUNTIME_GUARD_DESIGN_HEIGHT = 570;
const RUNTIME_GUARD_LEFT_WIDTH = 156;
const RUNTIME_GUARD_RIGHT_WIDTH = 207;
const RUNTIME_GUARD_MIN_MAIN_WIDTH = 280;
const RUNTIME_GUARD_TOP_GAP = 38;
const RUNTIME_GUARD_MIN_DESIGN_WIDTH = RUNTIME_GUARD_LEFT_WIDTH + RUNTIME_GUARD_MIN_MAIN_WIDTH + RUNTIME_GUARD_RIGHT_WIDTH;
const RUNTIME_GUARD_RIGHT_EDGE_GUARD = 2;

const agentDefinitions: Array<{
  name: RuntimeAgentName;
  platform: RuntimeBudgetPlatform;
  className: string;
}> = [
  { name: 'OpenClaw', platform: 'openclaw', className: 'agent-openclaw' },
  { name: 'Hermes', platform: 'hermes', className: 'agent-hermes' },
  { name: 'Nanobot', platform: 'nanobot', className: 'agent-nanobot' },
];

const sidebarAgentDefinitions: Array<{
  name: AgentName;
  platform?: RuntimeBudgetPlatform;
  className: string;
  runtimeBacked: boolean;
}> = [
  ...agentDefinitions.map(agent => ({ ...agent, runtimeBacked: true })),
  { name: 'Codex', className: 'agent-codex', runtimeBacked: false },
];

const RUNTIME_GUARD_SIDEBAR_LAYOUT = {
  agentsTop: 94,
  agentsHeight: 162,
  agentRowsTop: 18,
  agentRowGap: 36,
  agentRowHeight: 34,
  toolsTop: 263,
  toolRowsTop: 20,
  toolRowGap: 23,
  toolRowHeight: 15,
  toolCount: 3,
  safetyTop: 354,
  safetyLastRowTop: 55,
  safetyRowHeight: 28,
  budgetTop: 446,
  budgetHeight: 92,
  taskPanelTopBase: 88,
  taskPanelHeightBase: 450,
} as const;

export function runtimeGuardSidebarLayoutMetrics() {
  const agentsVisibleBottom = RUNTIME_GUARD_SIDEBAR_LAYOUT.agentsTop
    + RUNTIME_GUARD_SIDEBAR_LAYOUT.agentRowsTop
    + (sidebarAgentDefinitions.length - 1) * RUNTIME_GUARD_SIDEBAR_LAYOUT.agentRowGap
    + RUNTIME_GUARD_SIDEBAR_LAYOUT.agentRowHeight;
  const toolsVisibleBottom = RUNTIME_GUARD_SIDEBAR_LAYOUT.toolsTop
    + RUNTIME_GUARD_SIDEBAR_LAYOUT.toolRowsTop
    + (RUNTIME_GUARD_SIDEBAR_LAYOUT.toolCount - 1) * RUNTIME_GUARD_SIDEBAR_LAYOUT.toolRowGap
    + RUNTIME_GUARD_SIDEBAR_LAYOUT.toolRowHeight;
  const safetyVisibleBottom = RUNTIME_GUARD_SIDEBAR_LAYOUT.safetyTop
    + RUNTIME_GUARD_SIDEBAR_LAYOUT.safetyLastRowTop
    + RUNTIME_GUARD_SIDEBAR_LAYOUT.safetyRowHeight;
  return {
    budgetBottom: RUNTIME_GUARD_SIDEBAR_LAYOUT.budgetTop + RUNTIME_GUARD_SIDEBAR_LAYOUT.budgetHeight,
    middleSessionPanelBottom: RUNTIME_GUARD_SIDEBAR_LAYOUT.taskPanelTopBase + RUNTIME_GUARD_SIDEBAR_LAYOUT.taskPanelHeightBase,
    visibleGaps: [
      RUNTIME_GUARD_SIDEBAR_LAYOUT.toolsTop - agentsVisibleBottom,
      RUNTIME_GUARD_SIDEBAR_LAYOUT.safetyTop - toolsVisibleBottom,
      RUNTIME_GUARD_SIDEBAR_LAYOUT.budgetTop - safetyVisibleBottom,
    ],
  };
}

const sessionHistoryFilters: SessionHistoryAgentFilter[] = ['All', 'OpenClaw', 'Hermes', 'Nanobot', 'Codex'];
const runtimeBudgetPlatforms: RuntimeBudgetPlatform[] = ['openclaw', 'hermes', 'nanobot'];
const codexReasoningOptions: CodexReasoningLevel[] = ['low', 'medium', 'high', 'xhigh'];
const codexModelOptions: CodexModelOption[] = ['GPT-5.5', 'GPT-5.4', 'GPT-5.4-Mini', 'GPT-5.3-Codex-Spark'];
const codexSpeedOptions: CodexSpeedOption[] = ['standard', 'fast'];
const codexPermissionOptions: CodexPermissionMode[] = ['read_only', 'workspace_write', 'full_access'];
const DEFAULT_BUDGET_PERIOD_MS = 24 * 60 * 60 * 1000;

function defaultRuntimeBudgetStatus(platform: RuntimeBudgetPlatform, now = Date.now()): RuntimeBudgetStatus {
  return {
    platform,
    maxCost: null,
    periodValue: 24,
    periodUnit: 'hour',
    periodStartAt: new Date(now).toISOString(),
    periodEndAt: new Date(now + DEFAULT_BUDGET_PERIOD_MS).toISOString(),
    updatedAt: new Date(now).toISOString(),
    currentCost: 0,
    budgetUsed: 0,
    budgetPercent: 0,
    overLimit: false,
    remainingMs: DEFAULT_BUDGET_PERIOD_MS,
    estimatedTokens: 0,
    costUnknownTokens: 0,
    costUnknownModels: 0,
    costBreakdown: [],
  };
}

function defaultRuntimeBudgetStatusMap(now = Date.now()): RuntimeBudgetStatusMap {
  return {
    openclaw: defaultRuntimeBudgetStatus('openclaw', now),
    hermes: defaultRuntimeBudgetStatus('hermes', now),
    nanobot: defaultRuntimeBudgetStatus('nanobot', now),
  };
}

function runtimeBudgetStatusMapFromList(items: RuntimeBudgetStatus[]): RuntimeBudgetStatusMap {
  const next = defaultRuntimeBudgetStatusMap();
  for (const item of items) {
    if (runtimeBudgetPlatforms.includes(item.platform)) {
      next[item.platform] = item;
    }
  }
  return next;
}

function runtimeBudgetRemainingMs(status: RuntimeBudgetStatus, now = Date.now()): number {
  const endMs = Date.parse(status.periodEndAt);
  if (Number.isFinite(endMs)) {
    return Math.max(0, endMs - now);
  }
  return Math.max(0, Number(status.remainingMs) || 0);
}

const toolPermissionOptions: RuntimeGuardToolPermission[] = ['Allowed', 'Guard', 'Asked'];
type RuntimeGuardCopy = ReturnType<typeof useI18n>['t']['runtimeGuard'];

function rgText(template: string, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function formatCodexQuotaPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--%';
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function codexLocale(locale: string): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

function formatCodexClockTime(resetsAt: number, locale: string): string {
  return new Intl.DateTimeFormat(codexLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(resetsAt * 1000)).replace(/^24:/, '00:');
}

function formatCodexCalendarDate(resetsAt: number, locale: string): string {
  return new Intl.DateTimeFormat(codexLocale(locale), {
    month: locale === 'zh' ? 'long' : 'short',
    day: 'numeric',
  }).format(new Date(resetsAt * 1000));
}

function formatCodexQuotaRefresh(
  window: CodexRateLimitWindow | null | undefined,
  kind: 'fiveHour' | 'sevenDay',
  state: CodexRateLimitsState,
  copy: RuntimeGuardCopy,
  locale: string,
): string {
  if (state.loading && !state.data) return copy.sidebar.codexQuotaRefreshing;
  if (state.data?.status === 'logged_out') return copy.sidebar.codexQuotaLoggedOut;
  if (state.error || !state.data || state.data.status !== 'ready') return copy.sidebar.codexQuotaUnavailable;
  const resetsAt = window?.resets_at;
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return copy.sidebar.codexQuotaUnavailable;
  if (kind === 'fiveHour') {
    return rgText(copy.sidebar.codexQuotaFiveHourReset, {
      time: formatCodexClockTime(resetsAt, locale),
    });
  }
  return rgText(copy.sidebar.codexQuotaWeekReset, {
    date: formatCodexCalendarDate(resetsAt, locale),
  });
}

function toolDisplayName(toolId: RuntimeGuardToolId, copy: RuntimeGuardCopy): string {
  return copy.toolsModal.toolNames[toolId];
}

function permissionDisplayLabel(permission: RuntimeGuardToolPermission, copy: RuntimeGuardCopy): string {
  if (permission === 'Allowed') return copy.toolsModal.permissions.allow;
  if (permission === 'Asked') return copy.toolsModal.permissions.ask;
  return copy.toolsModal.permissions.guard;
}

function agentStatusDisplay(status: AgentStatus, copy: RuntimeGuardCopy): string {
  if (status === 'Running') return copy.agentStatus.running;
  if (status === 'Not installed') return copy.agentStatus.notInstalled;
  return copy.agentStatus.idle;
}

function sessionStatusDisplay(status: ReturnType<typeof sessionHistoryStatus>, copy: RuntimeGuardCopy): string {
  if (status === 'Active') return copy.sessionHistory.active;
  if (status === 'Blocked') return copy.sessionHistory.blockedStatus;
  return copy.sessionHistory.idle;
}

function guardSummaryDisplay(label: string, copy: RuntimeGuardCopy): string {
  if (label === 'Manual') return copy.guardStatus.manual;
  if (label === 'Secure') return copy.guardStatus.secure;
  if (label === 'Guarded') return copy.guardStatus.guarded;
  if (label === 'Review') return copy.guardStatus.review;
  return label;
}

function guardStatusRowLabel(label: string, copy: RuntimeGuardCopy): string {
  if (label === 'Guard Mode') return copy.guardStatus.guardMode;
  if (label === 'Pending') return copy.guardStatus.pending;
  if (label === 'Shell') return copy.guardStatus.shell;
  if (label === 'File System') return copy.guardStatus.fileSystem;
  if (label === 'Browser') return copy.guardStatus.browser;
  if (label === 'Network/Git') return copy.guardStatus.networkGit;
  if (label === 'Prompt Injection') return copy.guardStatus.promptInjection;
  if (label === 'Data Leakage') return copy.guardStatus.dataLeakage;
  if (label === 'Tool Call') return copy.guardStatus.toolCall;
  if (label === 'Skill Injection') return copy.guardStatus.skillInjection;
  return label;
}

function guardStatusRowStatus(status: string, copy: RuntimeGuardCopy): string {
  if (status === 'on') return copy.guardStatus.on;
  if (status === 'off') return copy.guardStatus.off;
  if (status === 'Clear') return copy.guardStatus.clear;
  const waiting = status.match(/^(\d+) waiting$/);
  if (waiting) return rgText(copy.guardStatus.waiting, { count: waiting[1] });
  return status
    .split('/')
    .map(part => {
      if (part === 'Allow') return copy.toolsModal.permissions.allow;
      if (part === 'Ask') return copy.toolsModal.permissions.ask;
      if (part === 'Guard') return copy.toolsModal.permissions.guard;
      return part;
    })
    .join('/');
}

function guardScoreTone(score: number): 'green' | 'orange' | 'red' {
  if (score >= 90) return 'green';
  if (score >= 80) return 'orange';
  return 'red';
}

const GUARD_SCORE_RING_BASE_SCORE = 80;
const GUARD_SCORE_RING_BASE_DEGREES = 270;

function guardScoreRingDegrees(score: number): number {
  const clampedScore = Math.min(100, Math.max(GUARD_SCORE_RING_BASE_SCORE, score));
  const scoreRatio = (clampedScore - GUARD_SCORE_RING_BASE_SCORE) / (100 - GUARD_SCORE_RING_BASE_SCORE);
  return GUARD_SCORE_RING_BASE_DEGREES + scoreRatio * (360 - GUARD_SCORE_RING_BASE_DEGREES);
}

const configurableTools: Array<{
  id: RuntimeGuardToolId;
  icon: LucideIcon;
  name: string;
}> = [
  { id: 'shell', icon: Terminal, name: 'Shell' },
  { id: 'fileSystem', icon: FolderOpen, name: 'File System' },
  { id: 'browser', icon: Globe2, name: 'Browser' },
  { id: 'network', icon: Network, name: 'Network' },
  { id: 'git', icon: GitBranch, name: 'Git' },
];

const traceTypes = new Set([
  'trace_start',
  'trace_step',
  'trace_status',
  'reasoning_summary',
  'approval_pending',
  'approval_resolved',
  'trace_end',
]);

const hermesTraceNoisePhases = new Set([
  'start',
  'finish',
  'finished',
  'done',
  'complete',
  'completed',
  'end',
  'status',
  'tool',
  'tool_call',
  'tool_use',
  'tool_start',
  'tool_result',
  'tool_finish',
  'tool_finished',
  'assistant',
  'answer',
  'final',
]);

const hermesTraceThinkingPhases = new Set([
  'thinking',
  'reasoning',
  'reasoning_summary',
  'planning',
  'plan',
  'analysis',
  'analyzing',
  'progress',
  'thought',
]);

function normalizeTraceToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isHermesTraceNoise(event: {
  type?: string;
  text?: string;
  summary?: string;
  phase?: string;
}): boolean {
  const type = normalizeTraceToken(event.type);
  const phase = normalizeTraceToken(event.phase);
  const text = String(event.text || event.summary || '').trim().toLowerCase();

  if (type === 'reasoning_summary' || hermesTraceThinkingPhases.has(phase)) {
    return false;
  }
  if (hermesTraceNoisePhases.has(phase)) {
    return true;
  }
  if (type === 'trace_start' || type === 'trace_end') {
    return true;
  }
  if (type === 'trace_status' && !hermesTraceThinkingPhases.has(phase)) {
    return true;
  }

  if (!text) return false;
  if (
    text === 'start' ||
    text === 'finish' ||
    text === 'finished' ||
    text === 'done' ||
    text === 'complete' ||
    text === 'completed' ||
    text === 'status'
  ) {
    return true;
  }
  return (
    text.startsWith('calling tool:') ||
    text.startsWith('tool finished:') ||
    text.startsWith('tool started:') ||
    text.startsWith('tool result:') ||
    text.startsWith('final answer:') ||
    text.startsWith('assistant final:')
  );
}

function isHermesThinkingTrace(event: {
  type?: string;
  text?: string;
  summary?: string;
  phase?: string;
}): boolean {
  const type = normalizeTraceToken(event.type);
  const phase = normalizeTraceToken(event.phase);
  const text = String(event.text || event.summary || '').trim().toLowerCase();

  if (type === 'reasoning_summary' || hermesTraceThinkingPhases.has(phase)) {
    return true;
  }
  if (isHermesTraceNoise(event)) {
    return false;
  }
  if (type !== 'trace_step') {
    return false;
  }
  return (
    text.includes('thinking') ||
    text.includes('reasoning') ||
    text.includes('planning') ||
    text.includes('analyzing') ||
    text.includes('analysis') ||
    text.includes('progress')
  );
}

function shouldDisplayTraceMessage(platform: RuntimePlatform | undefined, event: {
  type?: string;
  text?: string;
  summary?: string;
  phase?: string;
}): boolean {
  return platform !== 'hermes' || isHermesThinkingTrace(event);
}

function traceDisplayLabel(msg: ChatMessage): string {
  const phase = normalizeTraceToken(msg.trace_phase);
  const type = normalizeTraceToken(msg.trace_type);
  if (type === 'reasoning_summary' || phase === 'reasoning_summary' || phase === 'reasoning') return 'Reasoning';
  if (phase === 'planning' || phase === 'plan') return 'Planning';
  if (phase === 'analysis' || phase === 'analyzing') return 'Analysis';
  if (phase === 'progress') return 'Progress';
  return 'Thinking';
}

export type RuntimeTimelineTone = 'blue' | 'green' | 'yellow' | 'orange' | 'purple' | 'cyan' | 'red' | 'muted';
export type RuntimeTimelineKind =
  | 'user_message'
  | 'assistant_final'
  | 'assistant_thinking'
  | 'runtime_error'
  | 'tool_shell'
  | 'tool_file_read'
  | 'tool_file_write'
  | 'tool_file_delete'
  | 'tool_browser'
  | 'tool_network'
  | 'tool_git'
  | 'tool_mcp'
  | 'tool_unknown'
  | 'codex_user_input'
  | 'codex_plan'
  | 'codex_goal'
  | 'approval_request'
  | 'approval_allowed'
  | 'approval_denied'
  | 'guard_blocked';

export interface RuntimeTimelineAppearance {
  kind: RuntimeTimelineKind;
  tone: RuntimeTimelineTone;
  title: string;
  Icon: LucideIcon;
  statusBadge?: string;
  cardTone?: RuntimeTimelineTone;
}

function normalizeTimelineToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function coerceToolArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args === 'string' && args.trim()) {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { raw: args };
    }
  }
  return {};
}

function firstStringArg(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const nestedKey of ['arguments', 'args', 'params', 'input']) {
    const nested = args[nestedKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const value = firstStringArg(nested as Record<string, unknown>, keys);
      if (value) return value;
    }
  }
  return '';
}

function firstShellCommand(command: string): string {
  const token = command.trim().split(/\s+/)[0] ?? '';
  return token.replace(/^["']|["']$/g, '').replace(/\\/g, '/').split('/').pop()?.replace(/\.exe$/i, '').toLowerCase() ?? '';
}

function inferTimelineToolCategory(toolName?: string, args?: unknown): string {
  const normalized = normalizeTimelineToken(toolName);
  const params = coerceToolArgs(args);
  const command = firstStringArg(params, ['command', 'cmd', 'script']);
  const shellCommand = command ? firstShellCommand(command) : '';
  if (/^(read|read_file|file_read|view_file|open_file)$/.test(normalized)) return 'file_system';
  if (/^(write|write_file|file_write|edit|edit_file|file_edit|replace|append|create|create_file|mkdir|copy|move|rename|delete|delete_file|remove|remove_file|rm|rmdir|unlink)$/.test(normalized)) return 'file_system';
  if (shellCommand === 'git' || normalized === 'git' || normalized.startsWith('git_')) return 'git';
  if (/^(curl|wget|http|https|httpie|iwr|irm|invoke_webrequest|invoke_restmethod)$/.test(shellCommand)) return 'network';
  if (/^(web_search|search_web|web_fetch|fetch|http|http_request|request|download|url_fetch|get_url|curl|wget)$/.test(normalized) || normalized.startsWith('web_') || normalized.startsWith('http_')) return 'network';
  if (normalized === 'browser' || normalized.startsWith('browser_')) return 'browser';
  if (/^(exec|exec_command|shell|bash|terminal|run_command|execute_command|execute_shell_command|ls|pwd|cat|grep|rg|python|python3|node|npm|pip)$/.test(normalized)) return 'shell';
  if (normalized === 'mcp' || normalized.startsWith('mcp_')) return 'mcp';
  return 'unknown';
}

function inferTimelineToolAction(category: string, toolName?: string, args?: unknown): string {
  const normalized = normalizeTimelineToken(toolName);
  const params = coerceToolArgs(args);
  const command = firstStringArg(params, ['command', 'cmd', 'script']).toLowerCase();
  if (/^(delete|delete_file|remove|remove_file|rm|rmdir|unlink)$/.test(normalized) || /\b(rm|del|remove-item)\b/.test(command)) return 'delete';
  if (/^(write|write_file|file_write|append|create|create_file|copy|move|rename|mkdir)$/.test(normalized)) return 'write';
  if (/^(edit|edit_file|file_edit|replace)$/.test(normalized)) return 'modify';
  if (/^(read|read_file|file_read|view_file|open_file|ls)$/.test(normalized)) return 'read';
  if (category === 'browser') {
    if (normalized.includes('navigate') || normalized.includes('open')) return 'navigate';
    if (normalized.includes('search')) return 'search';
    return 'inspect';
  }
  if (category === 'network') return 'request';
  if (category === 'git') return /status|diff|log|show|branch/.test(normalized) ? 'inspect' : 'execute';
  if (category === 'shell') return 'execute';
  if (category === 'mcp') return 'request';
  return 'unknown';
}

function kindFromToolMetadata(row: Pick<ChatMessage, 'tool_name' | 'args' | 'timeline_kind' | 'tool_category' | 'tool_action'>): RuntimeTimelineKind {
  const explicitKind = normalizeTimelineToken(row.timeline_kind) as RuntimeTimelineKind;
  if ([
    'tool_shell', 'tool_file_read', 'tool_file_write', 'tool_file_delete', 'tool_browser',
    'tool_network', 'tool_git', 'tool_mcp', 'tool_unknown', 'guard_blocked',
  ].includes(explicitKind)) {
    return explicitKind;
  }
  const category = normalizeTimelineToken(row.tool_category) || inferTimelineToolCategory(row.tool_name, row.args);
  const action = normalizeTimelineToken(row.tool_action) || inferTimelineToolAction(category, row.tool_name, row.args);
  if (category === 'shell') return 'tool_shell';
  if (category === 'file_system') {
    if (action === 'read') return 'tool_file_read';
    if (action === 'delete') return 'tool_file_delete';
    return 'tool_file_write';
  }
  if (category === 'browser') return 'tool_browser';
  if (category === 'network') return 'tool_network';
  if (category === 'git') return 'tool_git';
  if (category === 'mcp') return 'tool_mcp';
  return 'tool_unknown';
}

function toolAppearanceForKind(kind: RuntimeTimelineKind, titleFallback = 'Tool'): RuntimeTimelineAppearance {
  switch (kind) {
    case 'tool_shell':
      return { kind, tone: 'green', title: 'Shell', Icon: Terminal };
    case 'tool_file_read':
      return { kind, tone: 'yellow', title: 'Read', Icon: FolderOpen };
    case 'tool_file_write':
      return { kind, tone: 'orange', title: 'Edit', Icon: FolderOpen };
    case 'tool_file_delete':
      return { kind, tone: 'red', title: 'Delete', Icon: Trash2 };
    case 'tool_browser':
      return { kind, tone: 'purple', title: 'Browser', Icon: Globe2 };
    case 'tool_network':
      return { kind, tone: 'cyan', title: 'Network', Icon: Network };
    case 'tool_git':
      return { kind, tone: 'blue', title: 'Git', Icon: GitBranch };
    case 'tool_mcp':
      return { kind, tone: 'purple', title: 'MCP', Icon: Wrench };
    case 'guard_blocked':
      return { kind, tone: 'red', title: 'Blocked', Icon: AlertCircle, cardTone: 'red' };
    default:
      return { kind: 'tool_unknown', tone: 'muted', title: titleFallback, Icon: Wrench };
  }
}

function isMiddleApprovalCard(value: unknown): value is MiddleApprovalCard {
  return Boolean(value && typeof value === 'object' && 'item' in value && 'status' in value);
}

function isGuardApproval(value: unknown): value is GuardPendingApproval {
  return Boolean(value && typeof value === 'object' && 'guard_verdict' in value && 'resolved' in value);
}

export function getTimelineAppearance(
  row: ChatMessage | MiddleApprovalCard | GuardPendingApproval | GuardRuntimeObservation,
  copy?: RuntimeGuardCopy,
): RuntimeTimelineAppearance {
  if (isMiddleApprovalCard(row)) {
    if (row.status === 'approved') return { kind: 'approval_allowed', tone: 'green', title: copy?.approvals.allowed ?? 'Allowed', Icon: CheckCircle2, cardTone: 'green' };
    if (row.status === 'rejected') return { kind: 'approval_denied', tone: 'red', title: copy?.approvals.denied ?? 'Denied', Icon: AlertCircle, cardTone: 'red' };
    return { kind: 'approval_request', tone: 'yellow', title: copy?.approvals.toolCall ?? 'Tool Call', Icon: AlertTriangle, cardTone: 'yellow' };
  }
  if (isGuardApproval(row)) {
    if (row.resolved && row.resolution === 'approved') return { kind: 'approval_allowed', tone: 'green', title: copy?.approvals.allowed ?? 'Allowed', Icon: CheckCircle2, cardTone: 'green' };
    if (row.resolved && row.resolution === 'rejected') return { kind: 'approval_denied', tone: 'red', title: copy?.approvals.denied ?? 'Denied', Icon: AlertCircle, cardTone: 'red' };
    return { kind: 'approval_request', tone: 'yellow', title: copy?.approvals.toolCall ?? 'Tool Call', Icon: AlertTriangle, cardTone: 'yellow' };
  }
  if ('action' in row && 'guard_verdict' in row) {
    const toolRow = {
      tool_name: row.tool_name,
      args: row.params,
      tool_category: row.tool_category ?? undefined,
      tool_action: row.tool_action ?? undefined,
      timeline_kind: row.timeline_kind ?? undefined,
    };
    const kind = row.timeline_kind === 'guard_blocked' || row.action === 'block'
      ? 'guard_blocked'
      : kindFromToolMetadata(toolRow);
    return kind === 'guard_blocked'
      ? { kind, tone: 'red', title: 'Blocked', Icon: AlertCircle, cardTone: 'red' }
      : toolAppearanceForKind(kind);
  }
  if (row.role === 'user') return { kind: 'user_message', tone: 'blue', title: copy?.main.you ?? 'You', Icon: User };
  if (row.role === 'assistant') return { kind: 'assistant_final', tone: 'green', title: copy?.main.assistant ?? 'Assistant', Icon: Bot };
  if (row.role === 'codex_question') return { kind: 'codex_user_input', tone: 'cyan', title: 'Codex Question', Icon: CircleQuestionMark, cardTone: 'cyan' };
  if (row.role === 'codex_plan') return { kind: 'codex_plan', tone: 'cyan', title: 'Codex Plan', Icon: ClipboardList, cardTone: 'cyan' };
  if (row.role === 'codex_goal') return { kind: 'codex_goal', tone: 'orange', title: 'Codex Goal', Icon: Target, cardTone: 'orange' };
  if (row.role === 'trace') return { kind: 'assistant_thinking', tone: 'purple', title: traceDisplayLabel(row), Icon: Brain, cardTone: 'purple' };
  if (row.role === 'error') return { kind: 'runtime_error', tone: 'red', title: copy?.main.runtimeError ?? 'Runtime error', Icon: AlertTriangle, cardTone: 'red' };
  const kind = kindFromToolMetadata(row);
  const base = toolAppearanceForKind(kind, row.tool_name || 'Tool');
  return row.is_error ? { ...base, tone: 'red', Icon: kind === 'guard_blocked' ? AlertCircle : base.Icon } : base;
}

function isRuntimePlatform(value: unknown): value is RuntimePlatform {
  return value === 'openclaw' || value === 'hermes' || value === 'nanobot';
}

function isRuntimeBudgetPlatform(value: unknown): value is RuntimeBudgetPlatform {
  return runtimeBudgetPlatforms.includes(value as RuntimeBudgetPlatform);
}

function isRuntimeBackedSession(
  session: RuntimeGuardSession,
): session is RuntimeGuardSession & { platform: RuntimePlatform; frontendOnly?: false } {
  return !session.frontendOnly && isRuntimePlatform(session.platform);
}

function platformToAgent(platform: RuntimePlatform): AgentName {
  if (platform === 'hermes') return 'Hermes';
  if (platform === 'nanobot') return 'Nanobot';
  return 'OpenClaw';
}

function normalizeRuntimePlatform(value: unknown): RuntimePlatform {
  return isRuntimePlatform(value) ? value : 'openclaw';
}

function firstText(...values: unknown[]): string {
  const found = values.find(value => typeof value === 'string' && value.trim());
  return typeof found === 'string' ? found.trim() : '';
}

function runtimeSessionKeyFromRecord(record: RuntimeSessionRecord): string {
  return firstText(
    record.session_key,
    record.display_session_id,
    record.source_session_id,
    record.session_id,
  );
}

export function runtimeSessionRecordToRuntimeGuardSession(
  record: RuntimeSessionRecord,
): RuntimeGuardSession | null {
  const sessionKey = runtimeSessionKeyFromRecord(record);
  if (!sessionKey) return null;
  const platform = normalizeRuntimePlatform(record.platform);
  const agent = platformToAgent(platform);
  const createdAt = firstText(record.first_seen_at, record.created_at, record.updated_at) || new Date().toISOString();
  const lastActivityAt = firstText(record.last_activity_at, record.updated_at, record.created_at, createdAt);
  const title = firstText(record.display_session_id, record.source_session_id, record.session_id) || `${agent} Session`;

  return {
    sessionKey,
    historySessionId: record.session_id,
    agent,
    platform,
    instanceId: firstText(record.instance_id),
    workspacePath: firstText(record.cwd) || undefined,
    title,
    createdAt,
    lastActivityAt,
    status: 'ready',
    autoTitlePending: false,
  };
}

export function codexSessionRecordToRuntimeGuardSession(
  record: CodexSessionRecord,
): RuntimeGuardSession | null {
  const id = firstText(record.id);
  if (!id) return null;
  const createdAt = firstText(record.created_at, record.updated_at) || new Date().toISOString();
  const lastActivityAt = firstText(record.updated_at, record.created_at, createdAt);
  const title = firstText(record.title, record.preview) || `Codex ${id.slice(0, 8)}`;

  return {
    sessionKey: `codex:${id}`,
    historySessionId: id,
    agent: 'Codex',
    platform: 'codex',
    instanceId: 'codex-cli',
    displayName: 'Codex CLI',
    workspacePath: firstText(record.cwd) || undefined,
    title,
    createdAt,
    lastActivityAt,
    status: 'ready',
    autoTitlePending: false,
    frontendOnly: true,
    codexHistory: true,
  };
}

export function mergeSessionHistorySessions(
  historySessions: RuntimeGuardSession[],
  openSessions: RuntimeGuardSession[],
): RuntimeGuardSession[] {
  const byKey = new Map<string, RuntimeGuardSession>();
  historySessions.forEach(session => {
    byKey.set(session.sessionKey, session);
  });
  openSessions.forEach(openSession => {
    const historySession = byKey.get(openSession.sessionKey);
    if (!historySession) {
      byKey.set(openSession.sessionKey, openSession);
      return;
    }
    const mergedSession = {
      ...historySession,
      ...openSession,
      historySessionId: historySession.historySessionId ?? openSession.historySessionId,
      lastActivityAt: historySession.lastActivityAt ?? openSession.lastActivityAt,
      workspacePath: openSession.workspacePath ?? historySession.workspacePath,
    };
    byKey.set(openSession.sessionKey, historySession.codexHistory ? {
      ...mergedSession,
      agent: historySession.agent,
      platform: historySession.platform,
      instanceId: historySession.instanceId,
      displayName: historySession.displayName ?? openSession.displayName,
      workspacePath: historySession.workspacePath ?? openSession.workspacePath,
      title: historySession.title || openSession.title,
      createdAt: historySession.createdAt || openSession.createdAt,
      frontendOnly: historySession.frontendOnly ?? openSession.frontendOnly,
      codexHistory: true,
    } : mergedSession);
  });
  return sortSessionsNewestFirst([...byKey.values()]);
}

export function promoteRuntimeGuardSession(
  current: RuntimeGuardSession[],
  session: RuntimeGuardSession,
): RuntimeGuardSession[] {
  const existing = current.find(item => item.sessionKey === session.sessionKey);
  const front = existing ? (
    session.codexHistory
      ? {
        ...existing,
        ...session,
        historySessionId: session.historySessionId ?? existing.historySessionId,
        lastActivityAt: session.lastActivityAt ?? existing.lastActivityAt,
        workspacePath: session.workspacePath ?? existing.workspacePath,
        title: session.title || existing.title,
        createdAt: session.createdAt || existing.createdAt,
        frontendOnly: true,
        codexHistory: true,
      }
      : {
        ...session,
        ...existing,
        historySessionId: existing.historySessionId ?? session.historySessionId,
        lastActivityAt: session.lastActivityAt ?? existing.lastActivityAt,
        workspacePath: existing.workspacePath ?? session.workspacePath,
      }
  ) : session;
  return [front, ...current.filter(item => item.sessionKey !== session.sessionKey)];
}

function loadRuntimeGuardSessions(): RuntimeGuardSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RUNTIME_GUARD_SESSIONS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item: any): RuntimeGuardSession | null => {
        const sessionKey = typeof item?.sessionKey === 'string' ? item.sessionKey : '';
        const platform = item?.platform;
        const agent = item?.agent;
        const isFrontendCodex = platform === 'codex' && agent === 'Codex';
        const isRuntimeSession = isRuntimePlatform(platform) && ['OpenClaw', 'Hermes', 'Nanobot'].includes(agent);
        if (!sessionKey || (!isRuntimeSession && !isFrontendCodex)) return null;
        const sessionAgent = (isFrontendCodex ? 'Codex' : agent) as AgentName;
        const sessionPlatform = (isFrontendCodex ? 'codex' : platform) as RuntimeGuardSessionPlatform;
        return {
          sessionKey,
          historySessionId: typeof item?.historySessionId === 'string' ? item.historySessionId : undefined,
          agent: sessionAgent,
          platform: sessionPlatform,
          instanceId: typeof item?.instanceId === 'string' ? item.instanceId : '',
          displayName: typeof item?.displayName === 'string' ? item.displayName : undefined,
          workspacePath: typeof item?.workspacePath === 'string' ? item.workspacePath : undefined,
          title: titleFromUserMessage(typeof item?.title === 'string' ? item.title : '', sessionAgent) || sessionAgent,
          createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          lastActivityAt: typeof item?.lastActivityAt === 'string' ? item.lastActivityAt : undefined,
          status: item?.status === 'error' ? 'error' : 'ready',
          autoTitlePending: Boolean(item?.autoTitlePending),
          frontendOnly: isFrontendCodex || Boolean(item?.frontendOnly),
          codexHistory: isFrontendCodex && Boolean(item?.codexHistory),
        };
      })
      .filter((item): item is RuntimeGuardSession => item !== null);
  } catch {
    return [];
  }
}

function saveRuntimeGuardSessions(sessions: RuntimeGuardSession[]) {
  localStorage.setItem(RUNTIME_GUARD_SESSIONS_KEY, JSON.stringify(sessions));
}

function loadRuntimeGuardDrafts(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(RUNTIME_GUARD_DRAFTS_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string] => (
        typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )),
    );
  } catch {
    return {};
  }
}

function saveRuntimeGuardDrafts(drafts: Record<string, string>) {
  localStorage.setItem(RUNTIME_GUARD_DRAFTS_KEY, JSON.stringify(drafts));
}

async function responseErrorMessage(response: Response, copy: RuntimeGuardCopy): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const data = JSON.parse(text);
      const detail = data?.detail;
      if (detail?.reason === 'budget_exceeded') {
        const platform = normalizeRuntimePlatform(detail.platform);
        const resetAtMs = Date.parse(String(detail.resetAt || ''));
        if (Number.isFinite(resetAtMs)) {
          return rgText(copy.toasts.budgetReachedWithReset, {
            agent: platformToAgent(platform),
            time: formatBudgetRefreshTime(resetAtMs - Date.now(), copy),
          });
        }
        return rgText(copy.toasts.budgetReached, { agent: platformToAgent(platform) });
      }
      if (typeof detail === 'string' && detail.trim()) return detail;
      if (detail) return JSON.stringify(detail);
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function formatTime(value: Date) {
  return value.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatSessionStartAgo(iso: string, copy: RuntimeGuardCopy, nowMs = Date.now()) {
  const startedMs = Date.parse(iso);
  if (!Number.isFinite(startedMs)) return copy.time.justNowAgo;
  const elapsedMinutes = Math.floor(Math.max(0, nowMs - startedMs) / 60_000);
  if (elapsedMinutes < 1) return copy.time.justNowAgo;
  if (elapsedMinutes < 60) {
    return rgText(elapsedMinutes === 1 ? copy.time.minuteAgo : copy.time.minutesAgo, {
      count: elapsedMinutes,
    });
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return rgText(elapsedHours === 1 ? copy.time.hourAgo : copy.time.hoursAgo, {
      count: elapsedHours,
    });
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  return rgText(elapsedDays === 1 ? copy.time.dayAgo : copy.time.daysAgo, {
    count: elapsedDays,
  });
}

function sessionWorkspacePath(
  session: RuntimeGuardSession,
  instances: RuntimeInstance[],
  copy: RuntimeGuardCopy,
): string {
  const exactInstance = instances.find(instance => instance.instance_id === session.instanceId);
  const platformInstance = isRuntimePlatform(session.platform)
    ? instances.find(instance => (
      instance.platform === session.platform && instance.enabled && instance.workspace_path
    ))
    : undefined;
  return firstText(
    session.workspacePath,
    exactInstance?.workspace_path,
    platformInstance?.workspace_path,
    copy.time.workspaceUnknown,
  );
}

function formatSessionMeta(
  session: RuntimeGuardSession,
  instances: RuntimeInstance[],
  copy: RuntimeGuardCopy,
  nowMs = Date.now(),
) {
  return `${formatSessionStartAgo(session.createdAt, copy, nowMs)} ${copy.time.workspacePrefix}:${sessionWorkspacePath(session, instances, copy)}`;
}

function formatSessionHistoryTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function sessionHistoryStatus(session: RuntimeGuardSession, activeSessionId: string): 'Active' | 'Idle' | 'Blocked' {
  if (session.sessionKey === activeSessionId) return 'Active';
  return session.status === 'error' ? 'Blocked' : 'Idle';
}

function sessionHistoryMatchesSearch(session: RuntimeGuardSession, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    session.agent,
    session.displayName ?? '',
    session.instanceId,
    session.sessionKey,
    session.title,
    session.platform,
  ].some(value => String(value).toLowerCase().includes(normalizedQuery));
}

function sessionCreatedAtMs(session: RuntimeGuardSession): number {
  const timestamp = new Date(session.lastActivityAt || session.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortSessionsNewestFirst(sessions: RuntimeGuardSession[]): RuntimeGuardSession[] {
  return [...sessions].sort((left, right) => sessionCreatedAtMs(right) - sessionCreatedAtMs(left));
}

export function runtimeGuardSessionIsRunning(
  session: RuntimeGuardSession,
  messageMap: Record<string, ChatMessage[]>,
  sendingMap: Record<string, boolean>,
): boolean {
  if (sendingMap[session.sessionKey]) return true;
  return (messageMap[session.sessionKey] ?? []).some(message => (
    Boolean(message.pending) || Boolean(message.result_pending)
  ));
}

export function runtimeGuardAgentStatus(
  agentName: AgentName,
  installed: boolean,
  sessions: RuntimeGuardSession[],
  messageMap: Record<string, ChatMessage[]>,
  sendingMap: Record<string, boolean>,
): AgentStatus {
  if (!installed) return 'Not installed';
  return sessions.some(session => (
    session.agent === agentName && runtimeGuardSessionIsRunning(session, messageMap, sendingMap)
  ))
    ? 'Running'
    : 'Idle';
}

export function runtimeGuardStartSessionPayload(runtime: RuntimeInstance): {
  instance_id: string;
  label_mode?: 'server_timestamp';
} {
  const payload: { instance_id: string; label_mode?: 'server_timestamp' } = {
    instance_id: runtime.instance_id,
  };
  if (runtime.platform === 'openclaw' || runtime.platform === 'hermes') {
    payload.label_mode = 'server_timestamp';
  }
  return payload;
}

const runtimeTitleExplanationPatterns = [
  /^(we|i)\s+(need|should|must|will)\b.*\b(title|ui title|user request)\b/i,
  /\b(user request|rules?|instruction)\b.*\b(title|ui title)\b/i,
  /^(the\s+)?title\s+(should|can|would|is)\b/i,
  /^(analysis|reasoning)\s*[:：]/i,
  /^(\u6211\u4eec)?\u9700\u8981?.*(\u7528\u6237\u8bf7\u6c42|UI\s*\u6807\u9898|\u6807\u9898)/i,
  /^\u6839\u636e.*(\u7528\u6237\u8bf7\u6c42|\u6807\u9898)/i,
  /\u7528\u6237\u8bf7\u6c42\u662f.*\u6807\u9898/i,
];

const runtimeTitleCjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/g;
const runtimeTitleWordPattern = /[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g;
const runtimeTitleRequestPatterns = [
  /[?？]/i,
  /^(?:帮我|帮忙|请|请问|麻烦|我想|我要|能不能|可以)/i,
  /^(?:查询一下|查一下|查查|看一下|了解一下)/i,
  /(?:哪个更难|怎么样|怎么|为什么|是否|难不难|简单|容易|吗|呢)/i,
  /^(?:please|can you|could you|help me|i want to|i need to|check|look up|find out)\b/i,
  /\b(?:what|why|how|whether)\b/i,
];
const runtimeTitleLeadInPatterns = [
  /^(?:请帮我|麻烦帮我|帮我|帮忙|请问|请|麻烦|我想|我要|能不能|可以)/i,
  /^(?:查询一下|查一下|查查|看一下|了解一下)/i,
  /^(?:please|can you|could you|help me|i want to|i need to|check|look up|find out)\b\s*/i,
];

function runtimeTitleLooksLikeExplanation(input: string): boolean {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  return Boolean(cleaned) && runtimeTitleExplanationPatterns.some(pattern => pattern.test(cleaned));
}

function stripRuntimeTitleLeadIns(input: string): string {
  let compact = input.replace(/\s+/g, ' ').trim().replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, '');
  for (let index = 0; index < 3; index += 1) {
    let next = compact.trim();
    runtimeTitleLeadInPatterns.forEach(pattern => {
      next = next.replace(pattern, '').trim();
    });
    if (next === compact) break;
    compact = next;
  }
  return compact.replace(/[?.!。？！；;，,：:]+$/g, '').trim() || input;
}

function shortenCjkRuntimeTitle(input: string, maxChars = 10): string {
  const chars: string[] = [];
  let cjkCount = 0;
  for (const char of input) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(char)) {
      cjkCount += 1;
      if (cjkCount > maxChars) break;
      chars.push(char);
    } else if (/^[A-Za-z0-9 _./-]$/.test(char)) {
      chars.push(char);
    }
  }
  return chars.join('').replace(/\s+/g, ' ').replace(/^[\s._/-]+|[\s._/-]+$/g, '');
}

function compactRuntimeRequestTitle(input: string): string {
  const normalized = input.replace(/\s+/g, ' ').trim().replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, '');
  if (!normalized) return '';
  const compact = stripRuntimeTitleLeadIns(normalized);
  if (runtimeTitleCjkPattern.test(compact)) {
    runtimeTitleCjkPattern.lastIndex = 0;
    if (compact.includes('天气')) {
      let place = '';
      const weatherMatch = compact.match(/([\u3400-\u9fff\uf900-\ufaff]{2,8})(?:今天|今日|明天|现在|当前)?(?:的)?天气/);
      if (weatherMatch?.[1]) {
        place = weatherMatch[1];
        ['的', '今天', '今日', '明天', '昨天', '现在', '当前', '今年', '去年', '一下'].forEach(word => {
          place = place.split(word).join('');
        });
        place = place.replace(/^(?:查|查询|看|了解)/, '').trim();
      }
      return shortenCjkRuntimeTitle(place ? `${place}天气查询` : '天气查询') || '天气查询';
    }
    if (['相比', '对比', '比较', '哪个更', '更难', '难度', '去年'].some(marker => compact.includes(marker))) {
      if (compact.includes('高考') && compact.includes('数学')) return '高考数学难度对比';
      const topic = shortenCjkRuntimeTitle(
        compact.replace(/(?:今年|去年|相比.*|比.*|哪个更.*|是难了.*|是简单了.*|难不难.*|吗|呢)/g, ''),
        6,
      );
      if (topic) return shortenCjkRuntimeTitle(`${topic}对比`);
    }
    if (compact.includes('登录') && compact.includes('限流')) return '登录限流修复';
    return shortenCjkRuntimeTitle(compact) || compact.slice(0, 10).trim();
  }
  const words = compact.match(runtimeTitleWordPattern);
  if (words?.length) {
    const lower = compact.toLowerCase();
    if (lower.includes('weather')) return lower.includes('shanghai') ? 'Shanghai weather' : 'Weather lookup';
    if ((lower.includes('compare') || lower.includes('comparison')) && lower.includes('math') && lower.includes('exam')) {
      return 'Math exam comparison';
    }
    return words.slice(0, 6).join(' ');
  }
  return compact.slice(0, 48).trim();
}

function runtimeTitleLooksLikeRawRequest(input: string): boolean {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (runtimeTitleRequestPatterns.some(pattern => pattern.test(cleaned))) return true;
  const cjkCount = cleaned.match(runtimeTitleCjkPattern)?.length ?? 0;
  runtimeTitleCjkPattern.lastIndex = 0;
  if (cjkCount > 10 && /[?？]|吗|呢|怎么样|怎么|为什么|是否|难不难|简单|容易|帮我|请/.test(cleaned)) {
    return true;
  }
  const words = cleaned.match(runtimeTitleWordPattern)?.length ?? 0;
  return words > 10 && /\?$|\b(can you|could you|please|help me|what|why|how|whether)\b/i.test(cleaned);
}

export function titleFromUserMessage(input: string, fallback = ''): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  const fallbackCleaned = fallback.replace(/\s+/g, ' ').trim();
  const compactFallback = compactRuntimeRequestTitle(fallbackCleaned);
  const safeTitle = cleaned && !runtimeTitleLooksLikeExplanation(cleaned)
    ? (
      (fallbackCleaned && cleaned === fallbackCleaned) || runtimeTitleLooksLikeRawRequest(cleaned)
        ? compactRuntimeRequestTitle(cleaned)
        : cleaned
    )
    : compactFallback || fallbackCleaned;
  if (!safeTitle) return '';
  return safeTitle.length > 48 ? `${safeTitle.slice(0, 48).trimEnd()}...` : safeTitle;
}

function runtimeGuardSessionBaseTitle(session: Pick<RuntimeGuardSession, 'agent' | 'title'>): string {
  const agent = session.agent;
  const title = titleFromUserMessage(session.title, agent) || agent;
  const prefixed = title.match(/^(OpenClaw|Hermes|Nanobot)\s*[:：]\s*(.*)$/);
  if (prefixed) {
    const rest = prefixed[2]?.trim();
    return rest || prefixed[1];
  }
  return title;
}

export function formatRuntimeGuardSessionTitle(session: Pick<RuntimeGuardSession, 'agent' | 'title'>): string {
  return runtimeGuardSessionBaseTitle(session);
}

function extractMessageText(msg: any): string {
  if (!msg) return '';
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('');
  }
  if (typeof msg.text === 'string') return msg.text;
  return '';
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRuntimeAgentName(agent: AgentName): agent is RuntimeAgentName {
  return agent !== 'Codex';
}

function agentToPlatform(agent: AgentName): RuntimePlatform {
  if (!isRuntimeAgentName(agent)) return 'openclaw';
  return agentDefinitions.find(item => item.name === agent)?.platform ?? 'openclaw';
}

function shortCodexModelLabel(model: CodexModelOption): string {
  if (model === 'GPT-5.5') return '5.5';
  if (model === 'GPT-5.4') return '5.4';
  if (model === 'GPT-5.4-Mini') return '5.4-Mini';
  return '5.3 Spark';
}

function codexModelId(model: CodexModelOption): string {
  if (model === 'GPT-5.5') return 'gpt-5.5';
  if (model === 'GPT-5.4') return 'gpt-5.4';
  if (model === 'GPT-5.4-Mini') return 'gpt-5.4-mini';
  return 'gpt-5.3-codex-spark';
}

function codexModelSupportsFast(model: CodexModelOption): boolean {
  return model === 'GPT-5.5' || model === 'GPT-5.4';
}

function configureRouteForAgent(agent: AgentName): string {
  if (agent === 'Hermes') return '/hermes_configure';
  if (agent === 'Nanobot') return '/nanobot_configure';
  if (agent === 'Codex') return '/codex_configure';
  return '/openclaw_configure';
}

function findRuntimeForAgentInInstances(agent: AgentName, instances: RuntimeInstance[]): RuntimeInstance | null {
  if (!isRuntimeAgentName(agent)) return null;
  const platform = agentToPlatform(agent);
  return instances.find(instance => instance.platform === platform && instance.is_default)
    ?? instances.find(instance => instance.platform === platform)
    ?? null;
}

function agentIconComponent(agent: AgentName): LucideIcon {
  if (agent === 'OpenClaw') return Zap;
  if (agent === 'Hermes') return Route;
  if (agent === 'Nanobot') return Cpu;
  return Brain;
}

function agentClassName(agent: AgentName): string {
  return sidebarAgentDefinitions.find(item => item.name === agent)?.className ?? 'agent-openclaw';
}

export function AgentIconBadge({
  agent,
  size = 'default',
}: {
  agent: AgentName;
  size?: 'default' | 'compact';
}) {
  const Icon = agentIconComponent(agent);
  return (
    <span
      className={`rg-agent-badge rg-agent-badge-${size} ${agentClassName(agent)}`}
      data-agent={agent}
    >
      <Icon />
    </span>
  );
}

function toolPermissionTone(permission: RuntimeGuardToolPermission): 'success' | 'warning' | 'asked' {
  if (permission === 'Allowed') return 'success';
  if (permission === 'Guard') return 'warning';
  return 'asked';
}

function toolPermissionButtonLabel(permission: RuntimeGuardToolPermission, copy: RuntimeGuardCopy): string {
  return permissionDisplayLabel(permission, copy);
}

function runtimeUnavailableMessage(instance: RuntimeInstance, copy?: RuntimeGuardCopy) {
  if (instance.platform === 'nanobot' && instance.health_status !== 'healthy') {
    const name = instance.display_name || 'Nanobot';
    return copy ? rgText(copy.toasts.gatewayOffline, { name }) : `${name} gateway offline.`;
  }
  if ((instance.platform === 'openclaw' || instance.platform === 'hermes') && instance.health_status === 'unreachable') {
    const name = instance.display_name || instance.platform;
    return copy ? rgText(copy.toasts.runtimeUnreachable, { name }) : `${name} is unreachable.`;
  }
  return '';
}

function approvalStatusLabel(status: MiddleApprovalStatus, copy: RuntimeGuardCopy): string {
  if (status === 'approved') return copy.approvals.allowed;
  if (status === 'rejected') return copy.approvals.denied;
  return '';
}

function upsertApprovalItem(
  current: GuardPendingApproval[],
  item: GuardPendingApproval,
): GuardPendingApproval[] {
  const next = current.filter(existing => existing.id !== item.id);
  next.push(item);
  return next;
}

function responseStatus(error: unknown): number | null {
  const response = (error as { response?: { status?: unknown } } | null)?.response;
  return typeof response?.status === 'number' ? response.status : null;
}

function formatBlockedTime(timestamp: number): string {
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '--:--';
  return new Date(timestampMs).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function blockedDisplayText(item: RecentBlockedItem): string {
  const preview = previewApprovalParams(item.params);
  return preview ? `${item.toolName} ${preview}` : item.toolName;
}

function mapHistoryMessage(raw: any, platform?: RuntimePlatform): ChatMessage | null {
  if (raw?.role === 'tool_call') {
    return {
      id: raw.id || uuidv4(),
      role: 'tool_call',
      content: '',
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
      tool_id: raw.tool_id,
      tool_name: raw.tool_name,
      args: raw.args,
      result: raw.result,
      is_error: raw.is_error,
      result_pending: raw.result_pending ?? false,
      tool_category: raw.tool_category ?? undefined,
      tool_action: raw.tool_action ?? undefined,
      timeline_kind: raw.timeline_kind ?? undefined,
      risk_level: raw.risk_level ?? undefined,
    };
  }

  if (raw?.role === 'user' || raw?.role === 'assistant' || raw?.role === 'error') {
    const text = typeof raw.content === 'string' ? raw.content : extractMessageText(raw);
    if (!text.trim()) return null;
    return {
      id: raw.id || uuidv4(),
      role: raw.role,
      content: text,
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
    };
  }

  if (raw?.role === 'trace') {
    const evt = raw.trace_event && typeof raw.trace_event === 'object' ? raw.trace_event : {};
    const traceType = typeof raw.trace_type === 'string'
      ? raw.trace_type
      : typeof evt.type === 'string'
        ? evt.type
        : 'trace_step';
    const tracePhase = typeof raw.trace_phase === 'string'
      ? raw.trace_phase
      : typeof evt.phase === 'string'
        ? evt.phase
        : '';
    const traceSummary = typeof raw.trace_summary === 'string'
      ? raw.trace_summary
      : typeof evt.summary === 'string'
        ? evt.summary
        : '';
    const traceStep = typeof raw.trace_step === 'number'
      ? raw.trace_step
      : typeof evt.step === 'number'
        ? evt.step
        : undefined;
    if (!shouldDisplayTraceMessage(platform, {
      type: traceType,
      text: typeof raw.content === 'string' ? raw.content : '',
      summary: traceSummary,
      phase: tracePhase,
    })) {
      return null;
    }
    return {
      id: raw.id || uuidv4(),
      role: 'trace',
      content: typeof raw.content === 'string' ? raw.content : '',
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
      trace_type: traceType,
      trace_phase: tracePhase,
      trace_step: traceStep,
      trace_summary: traceSummary,
    };
  }

  return null;
}

function StatusDot({ tone }: { tone: GuardStatusRowTone | 'mcp' }) {
  return <span className={`rg-dot rg-dot-${tone}`} />;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  return `$${value.toFixed(2)}`;
}

function formatBudgetInputValue(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
  return (Math.round(Number(value) * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}

function sanitizeBudgetAmountInput(value: string): string | null {
  const normalized = value.replace(',', '.');
  return /^\d*(?:\.\d{0,2})?$/.test(normalized) ? normalized : null;
}

function formatVersionLabel(version: string | null): string {
  const trimmed = version?.trim();
  if (!trimmed) return 'V--';
  return trimmed.toLowerCase().startsWith('v') ? `V${trimmed.slice(1)}` : `V${trimmed}`;
}

function formatBudgetRefreshTime(remainingMs: number, copy: RuntimeGuardCopy): string {
  const clamped = Math.max(0, remainingMs);
  const totalMinutes = Math.ceil(clamped / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return rgText(copy.time.daysHours, { days, hours });
  if (hours > 0) return rgText(copy.time.hoursMinutes, { hours, minutes });
  return rgText(copy.time.minutes, { minutes });
}

function formatApprovalTime(createdAt: number): string {
  const timestampMs = Number(createdAt) * 1000;
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '--:--:--';
  return new Date(timestampMs).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function previewApprovalParams(params: Record<string, unknown> = {}): string {
  const preferred = [params.command, params.path, params.file_path, params.url]
    .find(value => value !== null && value !== undefined && String(value).trim());
  if (preferred !== undefined) return String(preferred);
  try {
    return JSON.stringify(params).replace(/\s+/g, ' ');
  } catch {
    return String(params);
  }
}

function approvalByline(item: GuardPendingApproval): string {
  const platform = item.platform || 'runtime';
  return item.instance_id ? `${platform} / ${item.instance_id}` : platform;
}

function demoRightApprovalItem(): GuardPendingApproval | null {
  if (typeof window === 'undefined') return null;
  if (new URLSearchParams(window.location.search).get('demoApproval') !== '1') return null;
  return {
    id: 'demo-right-approval',
    platform: 'openclaw',
    instance_id: 'openclaw-default',
    guard_mode: 'manual',
    session_key: 'demo-session',
    tool_name: 'write_file',
    params: {
      path: 'workspace/config.json',
      content: '{ "allowExperimentalTools": true }',
    },
    guard_verdict: 'policy_ask',
    guard_raw: 'demo approval',
    session_context: 'Demo approval for right panel visual review.',
    risk_source: 'Demo',
    failure_mode: 'Manual approval required',
    real_world_harm: 'This is temporary demo data shown only with ?demoApproval=1.',
    created_at: Date.now() / 1000,
    resolved: false,
    resolution: '',
    resolved_at: 0,
    tool_category: 'file_system',
    tool_action: 'write',
    timeline_kind: 'approval_request',
    risk_level: 'medium',
  };
}

function demoCodexQuestionMessage(locale: string): ChatMessage | null {
  if (typeof window === 'undefined') return null;
  if (new URLSearchParams(window.location.search).get('demoCodexQuestion') !== '1') return null;

  const isZh = locale === 'zh';
  return {
    id: 'demo-codex-question',
    role: 'codex_question',
    content: '',
    timestamp: new Date(),
    codex_request_id: 'demo-codex-question-request',
    codex_thread_id: 'demo-thread',
    codex_turn_id: 'demo-turn',
    codex_item_id: 'demo-item',
    codex_response_status: 'pending',
    codex_questions: [{
      id: 'demo-choice',
      header: isZh ? '实现方式' : 'Implementation approach',
      question: isZh
        ? '我需要确认这次修改应该优先采用哪一种实现方式？'
        : 'Which implementation approach should I prioritize for this change?',
      is_other: true,
      is_secret: false,
      options: isZh
        ? [
            { label: '保持最小改动', description: '只完成当前交互所需的最小改动' },
            { label: '补齐完整交互', description: '实现真实询问、回复和状态更新' },
            { label: '先只做视觉验证', description: '先确认卡片视觉表现' },
          ]
        : [
            { label: 'Keep the change minimal', description: 'Only implement what this interaction needs' },
            { label: 'Complete the full interaction', description: 'Implement real question, reply, and status updates' },
            { label: 'Only validate the visual first', description: 'Check the card presentation first' },
          ],
    }],
  };
}

function ApprovalCard({
  item,
  slotIndex,
  resolving,
  onDecision,
  modal = false,
}: {
  item: GuardPendingApproval;
  slotIndex: number;
  resolving: boolean;
  onDecision: (item: GuardPendingApproval, resolution: ApprovalDecision) => void;
  modal?: boolean;
}) {
  const { t } = useI18n();
  const copy = t.runtimeGuard;
  const riskTone = item.guard_verdict === 'unsafe' ? 'high' : 'medium';
  const risk = riskTone === 'high' ? copy.approvals.highRisk : copy.approvals.mediumRisk;
  const content = previewApprovalParams(item.params);
  const cardClass = modal ? 'is-modal' : slotIndex === 0 ? 'rg-approval-shell' : 'rg-approval-file';

  return (
    <div className={`rg-approval-item ${cardClass}`}>
      <div className="rg-approval-title">{item.tool_name || copy.approvals.toolCall}</div>
      <div className={`rg-risk-text rg-risk-${riskTone}`}>{risk}</div>
      <div className="rg-code-strip">
        <span>{content}</span>
      </div>
      <div className="rg-meta rg-meta-by">{rgText(copy.approvals.by, { value: approvalByline(item) })}</div>
      <div className="rg-meta rg-meta-time">{rgText(copy.approvals.time, { value: formatApprovalTime(item.created_at) })}</div>
      <button
        className="rg-small-action rg-small-deny"
        disabled={resolving}
        onClick={() => onDecision(item, 'rejected')}
        type="button"
      >
        {copy.approvals.deny}
      </button>
      <button
        className="rg-small-action rg-small-allow"
        disabled={resolving}
        onClick={() => onDecision(item, 'approved')}
        type="button"
      >
        {copy.approvals.allow}
      </button>
    </div>
  );
}

export function InlineApprovalCard({
  card,
  resolving,
  onDecision,
}: {
  card: MiddleApprovalCard;
  resolving: boolean;
  onDecision: (item: GuardPendingApproval, resolution: ApprovalDecision) => void;
}) {
  const { t } = useI18n();
  const copy = t.runtimeGuard;
  const item = card.item;
  const isPending = card.status === 'pending';
  const appearance = getTimelineAppearance(card, copy);
  const AppearanceIcon = appearance.Icon;
  const riskTone = item.guard_verdict === 'unsafe' ? 'high' : 'medium';
  const risk = riskTone === 'high' ? copy.approvals.highRisk : copy.approvals.mediumRisk;
  const statusText = isPending ? risk : approvalStatusLabel(card.status, copy);
  const statusClass = isPending ? `rg-risk-${riskTone}` : '';
  const cardStateClass = card.status === 'pending'
    ? 'is-pending'
    : card.status === 'approved'
      ? 'is-approved'
      : 'is-denied';
  const fallbackToolName = item.tool_name || copy.approvals.toolCall;
  const requestTitle = item.tool_name && /\brequest$/i.test(item.tool_name)
    ? item.tool_name
    : rgText(copy.approvals.requestTitle, { tool: fallbackToolName });
  const content = previewApprovalParams(item.params);
  const reason = item.failure_mode || item.risk_source;
  const impact = item.real_world_harm;

  return (
    <div
      className={`rg-stream-row rg-stream-approval ${cardStateClass}`}
      data-kind={appearance.kind}
      data-tone={appearance.tone}
    >
      <span className="rg-stream-time">{formatApprovalTime(item.created_at)}</span>
      <AppearanceIcon className="rg-stream-icon rg-approval-timeline-icon" />
      <div className="rg-stream-body">
        <div className={`rg-command-card ${cardStateClass}`}>
          <AppearanceIcon />
          <div className="rg-command-title">{requestTitle}</div>
          <div className={`rg-command-risk ${statusClass}`}>{statusText}</div>
          <pre className="rg-command-code">{content}</pre>
          <div className="rg-command-reason">
            {reason && <span>{rgText(copy.approvals.reason, { value: reason })}</span>}
            {impact && <span>{rgText(copy.approvals.impact, { value: impact })}</span>}
          </div>
          {isPending && (
            <div className="rg-command-actions">
              <button
                className="rg-deny"
                disabled={resolving}
                onClick={() => onDecision(item, 'rejected')}
                type="button"
              >
                {copy.approvals.deny}
              </button>
              <button
                className="rg-always"
                disabled={resolving}
                onClick={() => onDecision(item, 'approved')}
                type="button"
              >
                {copy.approvals.allow}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function blockedByline(item: RecentBlockedItem): string {
  return item.instanceId ? `${item.platform} / ${item.instanceId}` : item.platform;
}

function blockedSourceLabel(source: RecentBlockedSource, copy: RuntimeGuardCopy): string {
  return source === 'approval' ? copy.blockedActions.approval : copy.blockedActions.observation;
}

function filterBlockedItemsByRange(
  items: RecentBlockedItem[],
  range: BlockedModalRange,
  nowMs: number,
): RecentBlockedItem[] {
  const nowSeconds = Math.floor(nowMs / 1000);
  const cutoff = range === '24h'
    ? nowSeconds - 24 * 60 * 60
    : range === '7d'
      ? nowSeconds - 7 * 24 * 60 * 60
      : Number.NEGATIVE_INFINITY;
  return items
    .filter(item => Number(item.timestamp || 0) >= cutoff)
    .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0));
}

function useRuntimeGuardModalEscape(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}

export function NewTaskModal({
  request,
  onRequestChange,
  onCreate,
  onClose,
  creating = false,
}: {
  request: string;
  onRequestChange: (request: string) => void;
  onCreate: () => void;
  onClose: () => void;
  creating?: boolean;
}) {
  const { t } = useI18n();
  const copy = t.runtimeGuard;
  useRuntimeGuardModalEscape(onClose);
  const createDisabled = creating || !request.trim();

  return (
    <div className="rg-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="rg-list-modal rg-new-task-modal" role="dialog" aria-modal="true" aria-label={copy.newTask.dialogLabel} onMouseDown={(event) => event.stopPropagation()}>
        <button className="rg-modal-close" type="button" title={copy.newTask.closeTitle} onClick={onClose}>
          <X />
        </button>
        <p className="rg-new-task-smart-hint">{copy.newTask.smartHint}</p>
        <div className="rg-new-task-request-shell">
          <textarea
            aria-label={copy.newTask.requestAria}
            className="rg-new-task-request"
            onChange={event => onRequestChange(event.target.value)}
            placeholder={copy.newTask.requestPlaceholder}
            value={request}
          />
          <button className="rg-new-task-create" disabled={createDisabled} onClick={onCreate} type="button">
            {creating ? copy.newTask.creating : copy.newTask.create}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionHistoryViewAllModal({
  sessions,
  loading,
  activeSessionId,
  messageMap,
  middleApprovalCardsBySession,
  onSelectSession,
  onDeleteSession,
  onClose,
}: {
  sessions: RuntimeGuardSession[];
  loading: boolean;
  activeSessionId: string;
  messageMap: Record<string, ChatMessage[]>;
  middleApprovalCardsBySession: MiddleApprovalCardsBySession;
  onSelectSession: (session: RuntimeGuardSession) => void;
  onDeleteSession: (session: RuntimeGuardSession) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const copy = t.runtimeGuard;
  const [searchQuery, setSearchQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState<SessionHistoryAgentFilter>('All');
  useRuntimeGuardModalEscape(onClose);

  const filteredSessions = useMemo(() => (
    sortSessionsNewestFirst(sessions)
      .filter(session => agentFilter === 'All' || session.agent === agentFilter)
      .filter(session => sessionHistoryMatchesSearch(session, searchQuery))
  ), [agentFilter, searchQuery, sessions]);

  return (
    <div className="rg-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="rg-list-modal rg-session-list-modal" role="dialog" aria-modal="true" aria-labelledby="rg-session-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="rg-modal-close" type="button" title={copy.sessionHistory.closeTitle} onClick={onClose}>
          <X />
        </button>
        <h2 id="rg-session-modal-title">{copy.sessionHistory.title}</h2>
        <div className="rg-list-modal-subtitle">
          {rgText(copy.sessionHistory.sessionCount, {
            count: filteredSessions.length,
            suffix: filteredSessions.length === 1 ? '' : 's',
          })}
        </div>
        <div className="rg-session-modal-controls">
          <input
            aria-label={copy.sessionHistory.searchAria}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder={copy.sessionHistory.searchPlaceholder}
            type="search"
            value={searchQuery}
          />
          <div className="rg-session-agent-tabs" role="group" aria-label={copy.sessionHistory.filterAria}>
            {sessionHistoryFilters.map(filter => (
              <button
                aria-pressed={agentFilter === filter}
                className={agentFilter === filter ? 'is-active' : ''}
                key={filter}
                onClick={() => setAgentFilter(filter)}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
        <div className="rg-list-modal-scroll rg-session-modal-scroll">
          {filteredSessions.length > 0 ? (
            filteredSessions.map(session => {
              const status = sessionHistoryStatus(session, activeSessionId);
              const displayTitle = formatRuntimeGuardSessionTitle(session);
              const baseTitle = runtimeGuardSessionBaseTitle(session);
              const subtitle = session.codexHistory && session.workspacePath
                ? session.workspacePath
                : session.displayName || session.instanceId || session.platform;
              const messages = messageMap[session.sessionKey] ?? [];
              const pendingApprovals = Object.values(middleApprovalCardsBySession[session.sessionKey] ?? {})
                .filter(card => card.status === 'pending').length;
              const blockedCount = messages.filter(message => message.role === 'error').length;
              const statusTone = status === 'Active' ? 'success' : status === 'Blocked' ? 'warning' : 'muted';
              return (
                <article
                  aria-current={status === 'Active' ? 'true' : undefined}
                  className={`rg-session-modal-row ${status === 'Active' ? 'is-active' : ''}`}
                  key={session.sessionKey}
                >
                  <button
                    className="rg-session-modal-open"
                    onClick={() => {
                      onSelectSession(session);
                      onClose();
                    }}
                    type="button"
                  >
                    <span className="rg-session-modal-time">{formatSessionHistoryTime(session.createdAt)}</span>
                    <span className="rg-session-modal-agent">
                      <AgentIconBadge agent={session.agent} size="compact" />
                      {session.agent}:
                    </span>
                    <span className="rg-session-modal-title">
                      <strong>{baseTitle}</strong>
                      <em>{subtitle}</em>
                    </span>
                    <span className="rg-session-modal-stats">
                      <span>{rgText(copy.sessionHistory.events, { count: messages.length })}</span>
                      <span>{rgText(copy.sessionHistory.blocked, { count: blockedCount })}</span>
                      <span>{rgText(copy.sessionHistory.pending, { count: pendingApprovals })}</span>
                    </span>
                    <span className="rg-session-modal-status">
                      <StatusDot tone={statusTone} />
                      {sessionStatusDisplay(status, copy)}
                    </span>
                  </button>
                  {!session.codexHistory ? (
                    <button
                      className="rg-session-modal-delete"
                      onClick={() => {
                        const confirmed = window.confirm(rgText(copy.sessionHistory.deleteConfirm, { title: displayTitle }));
                        if (confirmed) onDeleteSession(session);
                      }}
                      title={rgText(copy.sessionHistory.deleteTitle, { title: displayTitle })}
                      type="button"
                    >
                      <Trash2 />
                    </button>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="rg-list-empty">
              {loading && sessions.length === 0
                ? copy.sessionHistory.loading
                : sessions.length === 0
                  ? copy.sessionHistory.empty
                  : copy.sessionHistory.noMatch}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ToolsViewAllModal({
  permissions,
  onPermissionChange,
  onClose,
}: {
  permissions: RuntimeGuardToolPermissions;
  onPermissionChange: (toolId: RuntimeGuardToolId, permission: RuntimeGuardToolPermission) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const copy = t.runtimeGuard;
  useRuntimeGuardModalEscape(onClose);

  return (
    <div className="rg-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="rg-list-modal rg-tools-list-modal" role="dialog" aria-modal="true" aria-labelledby="rg-tools-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="rg-modal-close" type="button" title={copy.toolsModal.closeTitle} onClick={onClose}>
          <X />
        </button>
        <h2 id="rg-tools-modal-title">{copy.toolsModal.title}</h2>
        <div className="rg-list-modal-scroll rg-tools-modal-scroll">
          {configurableTools.map(tool => {
            const ToolIcon = tool.icon;
            const permission = permissions[tool.id];
            const toolName = toolDisplayName(tool.id, copy);
            return (
              <article className="rg-tool-permission-row" key={tool.id}>
                <span className="rg-tool-permission-mark"><ToolIcon /></span>
                <strong>{toolName}</strong>
                <div className="rg-permission-segment" role="group" aria-label={rgText(copy.toolsModal.permissionAria, { tool: toolName })}>
                  {toolPermissionOptions.map(option => (
                    <button
                      aria-pressed={permission === option}
                      className={permission === option ? 'is-active' : ''}
                      key={option}
                      onClick={() => onPermissionChange(tool.id, option)}
                      type="button"
                    >
                      {toolPermissionButtonLabel(option, copy)}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ApprovalViewAllModal({
  items,
  loading,
  resolvingApprovalId,
  onDecision,
  onClose,
}: {
  items: GuardPendingApproval[];
  loading: boolean;
  resolvingApprovalId: string | null;
  onDecision: (item: GuardPendingApproval, resolution: ApprovalDecision) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const copy = t.runtimeGuard;
  useRuntimeGuardModalEscape(onClose);

  return (
    <div className="rg-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="rg-list-modal" role="dialog" aria-modal="true" aria-labelledby="rg-approval-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="rg-modal-close" type="button" title={copy.approvals.closeTitle} onClick={onClose}>
          <X />
        </button>
        <h2 id="rg-approval-modal-title">{copy.approvals.title}</h2>
        <div className="rg-list-modal-subtitle">
          {rgText(copy.approvals.pendingCount, {
            count: items.length,
            suffix: items.length === 1 ? '' : 's',
          })}
        </div>
        <div className="rg-list-modal-scroll">
          {items.length > 0 ? (
            items.map((item, index) => (
              <ApprovalCard
                item={item}
                key={item.id}
                slotIndex={index}
                resolving={resolvingApprovalId === item.id}
                onDecision={onDecision}
                modal
              />
            ))
          ) : (
            <div className="rg-list-empty">
              {loading ? copy.approvals.loading : copy.approvals.empty}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BlockedViewAllModal({
  items,
  loading,
  range,
  nowMs,
  onRangeChange,
  onClose,
}: {
  items: RecentBlockedItem[];
  loading: boolean;
  range: BlockedModalRange;
  nowMs: number;
  onRangeChange: (range: BlockedModalRange) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const copy = t.runtimeGuard;
  useRuntimeGuardModalEscape(onClose);

  const filteredItems = filterBlockedItemsByRange(items, range, nowMs);
  const rangeOptions: Array<{ value: BlockedModalRange; label: string }> = [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: 'all', label: copy.blockedActions.all },
  ];

  return (
    <div className="rg-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="rg-list-modal rg-blocked-list-modal" role="dialog" aria-modal="true" aria-labelledby="rg-blocked-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="rg-modal-close" type="button" title={copy.blockedActions.closeTitle} onClick={onClose}>
          <X />
        </button>
        <h2 id="rg-blocked-modal-title">{copy.blockedActions.title}</h2>
        <div className="rg-range-tabs" role="tablist" aria-label={copy.blockedActions.rangeAria}>
          {rangeOptions.map(option => (
            <button
              aria-pressed={range === option.value}
              className={range === option.value ? 'is-active' : ''}
              key={option.value}
              onClick={() => onRangeChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="rg-list-modal-scroll">
          {filteredItems.length > 0 ? (
            filteredItems.map(item => (
              <article className="rg-block-detail-card" key={item.id}>
                <div className="rg-block-detail-head">
                  <span>{formatApprovalTime(item.timestamp)}</span>
                  <strong>{copy.blockedActions.blocked}</strong>
                  <em>{blockedSourceLabel(item.source, copy)}</em>
                </div>
                <div className="rg-block-detail-title">{item.toolName}</div>
                <code>{previewApprovalParams(item.params)}</code>
                <div className="rg-block-detail-meta">
                  <span>{rgText(copy.blockedActions.by, { value: blockedByline(item) })}</span>
                  {item.sessionKey && <span>{rgText(copy.blockedActions.session, { value: item.sessionKey })}</span>}
                  {item.reason && <span>{rgText(copy.blockedActions.reason, { value: item.reason })}</span>}
                  {item.impact && <span>{rgText(copy.blockedActions.impact, { value: item.impact })}</span>}
                </div>
              </article>
            ))
          ) : (
            <div className="rg-list-empty">
              {loading && items.length === 0 ? copy.blockedActions.loading : copy.blockedActions.emptyRange}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function codexQuestionsForMessage(msg: ChatMessage) {
  if (msg.codex_questions?.length) return msg.codex_questions;
  const legacyQuestion = msg.codex_question || msg.content;
  if (!legacyQuestion && !(msg.codex_options?.length)) return [];
  return [{
    id: 'answer',
    header: '',
    question: legacyQuestion,
    is_other: Boolean(msg.codex_allow_other),
    is_secret: Boolean(msg.codex_secret),
    options: (msg.codex_options ?? []).map(option => ({ label: option, description: '' })),
  }];
}

function initialCodexQuestionAnswers(msg: ChatMessage): Record<string, string> {
  const questions = codexQuestionsForMessage(msg);
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const answer = msg.codex_answer_values?.[question.id]?.[0];
    if (answer) answers[question.id] = answer;
  }
  if (!Object.keys(answers).length && msg.codex_submitted_answer && questions[0]) {
    answers[questions[0].id] = msg.codex_submitted_answer;
  }
  return answers;
}

function codexPlanStatusLabel(status?: string | null): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'inprogress' || normalized === 'in_progress') return 'In progress';
  if (normalized === 'pending') return 'Pending';
  if (normalized === 'completed' || normalized === 'complete') return 'Done';
  return status ?? '';
}

function codexGoalStatusLabel(status?: string | null): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  if (normalized === 'active') return 'Active';
  if (normalized === 'paused') return 'Paused';
  if (normalized === 'complete' || normalized === 'completed') return 'Complete';
  if (normalized === 'blocked') return 'Blocked';
  if (normalized === 'cleared') return 'Cleared';
  return status ?? 'Unknown';
}

function codexPlanConfirmationQuestion(locale: string) {
  const isZh = locale === 'zh';
  return {
    id: 'plan-confirmation',
    header: '',
    question: isZh ? '是否执行当前计划，或给出修改意见？' : 'Execute this plan, or provide changes?',
    is_other: true,
    is_secret: false,
    options: [{
      label: isZh ? '执行计划' : 'Execute plan',
      description: '',
    }],
  };
}

function codexPlanConfirmationPlaceholder(locale: string) {
  return locale === 'zh' ? '输入修改意见…' : 'Type changes to the plan...';
}

function codexPlanExecutePrompt(locale: string) {
  return locale === 'zh' ? '请按刚才的计划开始执行。' : 'Please start executing the plan above.';
}

function codexPlanRevisionPrompt(locale: string, feedback: string) {
  return locale === 'zh'
    ? `请根据以下意见修改刚才的计划：\n${feedback}`
    : `Please revise the plan above using this feedback:\n${feedback}`;
}

function isCodexPlanExecuteAnswer(answer: string) {
  const trimmed = answer.trim();
  return trimmed.toLowerCase() === 'execute plan' || trimmed === '执行计划';
}

export function TimelineMessage({
  msg,
  expanded,
  onToggle,
  onCodexQuestionSubmit,
  onCodexGoalClear,
}: {
  msg: ChatMessage;
  expanded: boolean;
  onToggle: () => void;
  onCodexQuestionSubmit?: (msg: ChatMessage, payload: CodexRequestUserInputResponseRequest) => void | Promise<void>;
  onCodexGoalClear?: (msg: ChatMessage) => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const copy = t.runtimeGuard;
  const time = formatTime(msg.timestamp);
  const appearance = getTimelineAppearance(msg, copy);
  const AppearanceIcon = appearance.Icon;
  const [codexQuestionAnswers, setCodexQuestionAnswers] = useState<Record<string, string>>(() => initialCodexQuestionAnswers(msg));
  const [localCodexQuestionStatus, setLocalCodexQuestionStatus] = useState<'submitting' | 'submitted' | 'error' | null>(null);
  const [localCodexQuestionError, setLocalCodexQuestionError] = useState('');

  useEffect(() => {
    setCodexQuestionAnswers(initialCodexQuestionAnswers(msg));
    setLocalCodexQuestionStatus(null);
    setLocalCodexQuestionError('');
  }, [msg.codex_answer_values, msg.codex_questions, msg.codex_submitted_answer, msg.id]);

  if (msg.role === 'codex_plan') {
    const steps = msg.codex_plan_steps ?? [];
    const planText = msg.codex_plan_text || msg.content;
    return (
      <div className="rg-stream-row rg-stream-codex-plan" data-kind={appearance.kind} data-tone={appearance.tone}>
        <span className="rg-stream-time">{time}</span>
        <AppearanceIcon className="rg-stream-icon" />
        <div className="rg-stream-body">
          <div className="rg-codex-plan-card">
            <div className="rg-codex-plan-head">
              <span className="rg-stream-title">Codex plan</span>
            </div>
            {msg.codex_plan_explanation && (
              <MarkdownMessage content={msg.codex_plan_explanation} className="rg-codex-plan-markdown rg-codex-plan-explanation" />
            )}
            {steps.length > 0 && (
              <ol className="rg-codex-plan-steps">
                {steps.map((step, index) => (
                  <li key={`${step.step}-${index}`}>
                    <span>{step.step}</span>
                    {step.status && <em>{codexPlanStatusLabel(step.status)}</em>}
                  </li>
                ))}
              </ol>
            )}
            {planText && <MarkdownMessage content={planText} className="rg-codex-plan-markdown" />}
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === 'codex_goal') {
    const goal = msg.codex_goal;
    const objective = goal?.objective || msg.content;
    const status = codexGoalStatusLabel(goal?.status);
    return (
      <div className="rg-stream-row rg-stream-codex-goal" data-kind={appearance.kind} data-tone={appearance.tone}>
        <span className="rg-stream-time">{time}</span>
        <AppearanceIcon className="rg-stream-icon" />
        <div className="rg-stream-body">
          <div className="rg-codex-goal-card">
            <div className="rg-codex-goal-head">
              <span className="rg-stream-title">Codex goal</span>
              <em>{status}</em>
            </div>
            {objective && <p>{objective}</p>}
            {goal?.status && goal.status !== 'cleared' && onCodexGoalClear && (
              <button className="rg-codex-goal-clear" onClick={() => void onCodexGoalClear(msg)} type="button">
                <Target />
                <span>Clear goal</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === 'codex_question') {
    const isZh = locale === 'zh';
    const questions = codexQuestionsForMessage(msg);
    const responseStatus = localCodexQuestionStatus ?? msg.codex_response_status ?? 'pending';
    const isSubmitting = responseStatus === 'submitting';
    const isAnswered = responseStatus === 'submitted' || responseStatus === 'resolved';
    const allQuestionsAnswered = questions.length > 0 && questions.every(question => Boolean((codexQuestionAnswers[question.id] ?? '').trim()));
    const statusText = responseStatus === 'submitting'
      ? (isZh ? '发送中' : 'Sending')
      : isAnswered
        ? (isZh ? '已发送' : 'Sent')
        : responseStatus === 'error'
          ? (isZh ? '发送失败' : 'Failed')
          : (isZh ? '等待用户回应' : 'Waiting for response');

    const submitCodexQuestionAnswer = async () => {
      if (!onCodexQuestionSubmit || !allQuestionsAnswered || isSubmitting || isAnswered) return;
      const payload: CodexRequestUserInputResponseRequest = {
        answers: Object.fromEntries(questions.map(question => [
          question.id,
          { answers: [(codexQuestionAnswers[question.id] ?? '').trim()] },
        ])),
      };
      setLocalCodexQuestionStatus('submitting');
      setLocalCodexQuestionError('');
      try {
        await onCodexQuestionSubmit(msg, payload);
        setLocalCodexQuestionStatus('submitted');
      } catch (error: any) {
        setLocalCodexQuestionStatus('error');
        setLocalCodexQuestionError(error?.message || (isZh ? '发送失败' : 'Failed to send'));
      }
    };

    return (
      <div className="rg-stream-row rg-stream-codex-question" data-kind={appearance.kind} data-tone={appearance.tone}>
        <span className="rg-stream-time">{time}</span>
        <AppearanceIcon className="rg-stream-icon" />
        <div className="rg-stream-body">
          <div className="rg-codex-question-card">
            <div className="rg-codex-question-head">
              <span className="rg-stream-title">{isZh ? 'Codex 询问' : 'Codex question'}</span>
              <em>{statusText}</em>
            </div>
            {questions.map(question => {
              const selectedAnswer = codexQuestionAnswers[question.id] ?? '';
              const answerIsOption = question.options.some(option => option.label === selectedAnswer);
              const controlsDisabled = isSubmitting || isAnswered;
              const inputPlaceholder = msg.codex_question_kind === 'plan_confirmation'
                ? codexPlanConfirmationPlaceholder(locale)
                : question.options.length
                  ? (isZh ? '或输入其他意见...' : 'Or type another answer...')
                  : (isZh ? '输入你的回答...' : 'Type your answer...');
              return (
                <div className="rg-codex-question-block" key={question.id}>
                  {question.header && <strong>{question.header}</strong>}
                  <p>{question.question}</p>
                  {question.options.length > 0 && (
                    <div className="rg-codex-question-options">
                      {question.options.map(option => (
                        <button
                          aria-label={option.label}
                          className={selectedAnswer === option.label ? 'is-selected' : ''}
                          disabled={controlsDisabled}
                          key={option.label}
                          onClick={() => setCodexQuestionAnswers(current => ({ ...current, [question.id]: option.label }))}
                          type="button"
                        >
                          <span>{option.label}</span>
                          {option.description && <small>{option.description}</small>}
                        </button>
                      ))}
                    </div>
                  )}
                  {(question.is_other || question.options.length === 0) && (
                    <input
                      className="rg-codex-question-input"
                      disabled={controlsDisabled}
                      onChange={event => setCodexQuestionAnswers(current => ({ ...current, [question.id]: event.target.value }))}
                      placeholder={inputPlaceholder}
                      type={question.is_secret ? 'password' : 'text'}
                      value={answerIsOption ? '' : selectedAnswer}
                    />
                  )}
                  {selectedAnswer && (
                    <div className="rg-codex-question-state">
                      <CheckCircle2 />
                      <span>{isZh ? '已选择：' : 'Selected: '}{selectedAnswer}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {(msg.codex_error || localCodexQuestionError) && (
              <div className="rg-codex-question-error">
                <AlertCircle />
                <span>{msg.codex_error || localCodexQuestionError}</span>
              </div>
            )}
            <button
              className="rg-codex-question-submit"
              disabled={!allQuestionsAnswered || isSubmitting || isAnswered}
              onClick={submitCodexQuestionAnswer}
              type="button"
            >
              {isSubmitting ? <Loader2 className="is-spinning" /> : isAnswered ? <CheckCircle2 /> : <Send />}
              <span>{isAnswered ? (isZh ? '已发送' : 'Sent') : (isZh ? '确认并发送' : 'Confirm and send')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === 'tool_call') {
    const resultText = formatValue(msg.result);
    const argsText = formatValue(msg.args);
    const summary = argsText.replace(/\s+/g, ' ').slice(0, 100);
    return (
      <div
        className={`rg-stream-row rg-stream-tool ${msg.is_error ? 'is-error' : ''}`}
        data-kind={appearance.kind}
        data-tone={appearance.tone}
      >
        <span className="rg-stream-time">{time}</span>
        <AppearanceIcon className="rg-stream-icon" />
        <div className="rg-stream-body">
          <button className="rg-tool-toggle" type="button" onClick={onToggle}>
            <span className="rg-stream-title">{appearance.title}</span>
            {summary && <code>{summary}</code>}
            {msg.result_pending ? <Loader2 className="rg-stream-state is-spinning" /> : msg.is_error ? <AlertCircle className="rg-stream-state" /> : <CheckCircle2 className="rg-stream-state" />}
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
          {expanded && (
            <div className="rg-tool-detail">
              {argsText && (
                <>
                  <span>Arguments</span>
                  <pre>{argsText}</pre>
                </>
              )}
              {msg.result_pending ? (
                <div className="rg-tool-running"><Loader2 className="is-spinning" /> Running...</div>
              ) : resultText ? (
                <>
                  <span>{msg.is_error ? 'Error' : 'Result'}</span>
                  <pre>{resultText}</pre>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (msg.role === 'trace') {
    return (
      <div className="rg-stream-row rg-stream-trace" data-kind={appearance.kind} data-tone={appearance.tone}>
        <span className="rg-stream-time">{time}</span>
        <AppearanceIcon className="rg-stream-icon" />
        <div className="rg-stream-body">
          <span className="rg-stream-title">{appearance.title}</span>
          {msg.trace_summary && <p>{msg.trace_summary}</p>}
          {msg.content && <p>{msg.content}</p>}
        </div>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';
  return (
    <div
      className={`rg-stream-row ${isUser ? 'rg-stream-user' : isError ? 'rg-stream-error' : 'rg-stream-assistant'}`}
      data-kind={appearance.kind}
      data-tone={appearance.tone}
    >
      <span className="rg-stream-time">{time}</span>
      <AppearanceIcon className="rg-stream-icon" />
      <div className="rg-stream-body">
        <span className="rg-stream-title">{appearance.title}</span>
        {msg.pending && !msg.content ? (
          <span className="rg-stream-pending"><i /><i /><i /></span>
        ) : !isUser && !isError ? (
          <MarkdownMessage content={msg.content} className="rg-stream-markdown" />
        ) : (
          <p>{msg.content}</p>
        )}
      </div>
    </div>
  );
}

export default function RuntimeGuardConsole() {
  const { t, locale, setLocale } = useI18n();
  const copy = t.runtimeGuard;
  const navigate = useNavigate();
  const runtimeInstancesQuery = useRuntimeInstances();
  const subscribeToChatStore = useCallback((listener: () => void) => chatStreamStore.subscribe(listener), []);
  const messageMap = useSyncExternalStore(subscribeToChatStore, () => chatStreamStore.getSnapshot());
  const sendingMap = useSyncExternalStore(subscribeToChatStore, () => chatStreamStore.getSendingSnapshot());

  const [installedAgents, setInstalledAgents] = useState<InstallMap>({
    OpenClaw: null,
    Hermes: null,
    Nanobot: null,
    Codex: null,
  });
  const [installProbeFailed, setInstallProbeFailed] = useState(false);
  const [xsafeclawVersion, setXsafeclawVersion] = useState<string | null>(BUILD_TIME_XSAFECLAW_VERSION);
  const [sessions, setSessions] = useState<RuntimeGuardSession[]>(() => loadRuntimeGuardSessions());
  const [activeSessionId, setActiveSessionId] = useState(() => loadRuntimeGuardSessions()[0]?.sessionKey ?? '');
  const [sessionHistoryItems, setSessionHistoryItems] = useState<RuntimeGuardSession[]>([]);
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<AgentName>(() => loadRuntimeGuardSessions()[0]?.agent ?? 'OpenClaw');
  const [draftBySessionKey, setDraftBySessionKey] = useState<Record<string, string>>(() => loadRuntimeGuardDrafts());
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [creatingAgent, setCreatingAgent] = useState<AgentName | null>(null);
  const [newTaskModalOpen, setNewTaskModalOpen] = useState(false);
  const [newTaskRequest, setNewTaskRequest] = useState('');
  const [newTaskCreating, setNewTaskCreating] = useState(false);
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});
  const [isComposing, setIsComposing] = useState(false);
  const [approvalItems, setApprovalItems] = useState<GuardPendingApproval[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(true);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [middleApprovalCardsBySession, setMiddleApprovalCardsBySession] = useState<MiddleApprovalCardsBySession>({});
  const [blockedObservations, setBlockedObservations] = useState<GuardRuntimeObservation[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [activeRuntimeGuardModal, setActiveRuntimeGuardModal] = useState<RuntimeGuardModal>(null);
  const [blockedModalRange, setBlockedModalRange] = useState<BlockedModalRange>('24h');
  const [toolPermissions, setToolPermissions] = useState<RuntimeGuardToolPermissions>(() => ({ ...defaultToolPermissions }));
  const [placeholder, setPlaceholder] = useState('');
  const [guardMode, setGuardMode] = useState<GuardMode>('Off');
  const [guardModeSyncing, setGuardModeSyncing] = useState(false);
  const [autoApprovalOpen, setAutoApprovalOpen] = useState(false);
  const [runtimeBudgetStatuses, setRuntimeBudgetStatuses] = useState<RuntimeBudgetStatusMap>(() => defaultRuntimeBudgetStatusMap());
  const [selectedBudgetPlatform, setSelectedBudgetPlatform] = useState<RuntimeBudgetPlatform>('openclaw');
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetAmountInput, setBudgetAmountInput] = useState('');
  const [budgetPeriodInput, setBudgetPeriodInput] = useState('');
  const [budgetPeriodUnit, setBudgetPeriodUnit] = useState<BudgetPeriodUnit>('hour');
  const initialCodexConfig = useMemo(() => loadCodexConfig(), []);
  const [codexComposerMenu, setCodexComposerMenu] = useState<CodexComposerMenu>(null);
  const [codexSubmenu, setCodexSubmenu] = useState<CodexSubmenu>(null);
  const [codexPlanMode, setCodexPlanMode] = useState(false);
  const [codexGoalMode, setCodexGoalMode] = useState(false);
  const [codexPermissionMode, setCodexPermissionMode] = useState<CodexPermissionMode>(initialCodexConfig.permissionMode);
  const [codexReasoningLevel, setCodexReasoningLevel] = useState<CodexReasoningLevel>(initialCodexConfig.defaultReasoning);
  const [codexModel, setCodexModel] = useState<CodexModelOption>(initialCodexConfig.defaultModel);
  const [codexSpeed, setCodexSpeed] = useState<CodexSpeedOption>(initialCodexConfig.defaultSpeed);
  const [codexGoalBySessionKey, setCodexGoalBySessionKey] = useState<Record<string, ChatMessage['codex_goal']>>({});
  const [codexRateLimitsState, setCodexRateLimitsState] = useState<CodexRateLimitsState>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!codexModelSupportsFast(codexModel) && codexSpeed !== 'standard') {
      setCodexSpeed('standard');
      setCodexSubmenu(current => (current === 'speed' ? null : current));
    }
  }, [codexModel, codexSpeed]);

  useEffect(() => {
    if (!codexComposerMenu) return undefined;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const composer = codexComposerRef.current;
      if (!composer || !(target instanceof Node) || composer.contains(target)) return;
      setCodexComposerMenu(null);
      setCodexSubmenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
    };
  }, [codexComposerMenu]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'backend';

    return () => {
      document.title = previousTitle;
    };
  }, []);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [layoutFit, setLayoutFit] = useState({
    scale: 1,
    height: 570,
    leftWidth: 156,
    rightWidth: 207,
    mainWidth: 491,
    mainDesignWidth: 491,
  });
  const taskScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const codexComposerRef = useRef<HTMLDivElement>(null);
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const approvalRefreshTimerRef = useRef<number | null>(null);
  const codexRateLimitsRequestRef = useRef(0);

  const refreshCodexRateLimits = useCallback(async () => {
    const requestId = codexRateLimitsRequestRef.current + 1;
    codexRateLimitsRequestRef.current = requestId;
    setCodexRateLimitsState(current => ({ ...current, loading: true, error: null }));
    try {
      const { data } = await systemAPI.getCodexRateLimits();
      if (codexRateLimitsRequestRef.current !== requestId) return null;
      setCodexRateLimitsState({
        data,
        loading: false,
        error: data.status === 'ready' ? null : (data.error || data.message || data.status),
      });
      return data;
    } catch (error) {
      if (codexRateLimitsRequestRef.current !== requestId) return null;
      const message = error instanceof Error ? error.message : 'Failed to load Codex rate limits.';
      setCodexRateLimitsState({ data: null, loading: false, error: message });
      return null;
    }
  }, []);

  const setMessageMap = useCallback((
    updaterOrValue: Record<string, ChatMessage[]> | ((prev: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>),
  ) => {
    if (typeof updaterOrValue === 'function') {
      chatStreamStore.replaceAll(updaterOrValue(chatStreamStore.getSnapshot()));
    } else {
      chatStreamStore.replaceAll(updaterOrValue);
    }
  }, []);

  const activeSession = sessions.find(session => session.sessionKey === activeSessionId) ?? null;
  const activeSessionKey = activeSession?.sessionKey ?? '';
  const activeAgent = activeSession?.agent ?? selectedAgent;
  const activeSessionIsCodex = activeSession?.agent === 'Codex';
  const activeMessages = useMemo(
    () => (activeSessionKey ? (messageMap[activeSessionKey] ?? []) : []),
    [activeSessionKey, messageMap],
  );
  const activeApprovalCards = useMemo(
    () => getActiveApprovalCards(middleApprovalCardsBySession, activeSessionKey),
    [activeSessionKey, middleApprovalCardsBySession],
  );
  const activeTimelineRows = useMemo(() => {
    return buildActiveTimelineRows(activeMessages, activeApprovalCards);
  }, [activeApprovalCards, activeMessages]);
  const activeTimelineScrollKey = useMemo(
    () => buildTimelineScrollKey(activeTimelineRows),
    [activeTimelineRows],
  );
  const demoCodexQuestion = useMemo(() => demoCodexQuestionMessage(locale), [locale]);
  const visibleSessionHistoryItems = useMemo(
    () => mergeSessionHistorySessions(sessionHistoryItems, sessions),
    [sessionHistoryItems, sessions],
  );
  const sessionHistoryPreviewItems = useMemo(
    () => visibleSessionHistoryItems.slice(0, 2),
    [visibleSessionHistoryItems],
  );
  const activeDraft = activeSession ? (draftBySessionKey[activeSession.sessionKey] ?? '') : '';
  const activeSending = activeSession ? (sendingMap[activeSession.sessionKey] ?? false) : false;
  const codexComposerCopy = copy.codexComposer;
  const codexPermissionLabel = codexComposerCopy.permission[codexPermissionMode];
  const codexEffectiveSpeed: CodexSpeedOption = codexModelSupportsFast(codexModel) ? codexSpeed : 'standard';
  const codexModelSummary = `${shortCodexModelLabel(codexModel)} ${codexComposerCopy.reasoning[codexReasoningLevel]}`;
  const activeCodexGoal = activeSessionKey ? codexGoalBySessionKey[activeSessionKey] : null;
  const toggleCodexPlanMode = () => {
    const nextPlanMode = !codexPlanMode;
    setCodexPlanMode(nextPlanMode);
    if (nextPlanMode) {
      setCodexGoalMode(false);
    }
  };
  const toggleCodexGoalMode = () => {
    const nextGoalMode = !codexGoalMode;
    setCodexGoalMode(nextGoalMode);
    if (nextGoalMode) {
      setCodexPlanMode(false);
    }
  };
  const availableInstances = useMemo(
    () => (runtimeInstancesQuery.data?.instances ?? []).filter(instance => instance.enabled),
    [runtimeInstancesQuery.data?.instances],
  );
  const budgetPlatformOptions = useMemo(
    () => agentDefinitions.filter(agent => {
      const installed = installedAgents[agent.name];
      if (installed === true) return true;
      if (installed === false) return false;
      if (installProbeFailed) return true;
      return availableInstances.some(instance => instance.platform === agent.platform);
    }),
    [availableInstances, installProbeFailed, installedAgents],
  );
  const activeBudgetPlatform = isRuntimeBudgetPlatform(activeSession?.platform)
    ? activeSession.platform
    : agentToPlatform(selectedAgent);
  const sidebarTools = useMemo(() => ([
    ...configurableTools.map(tool => {
      const permission = toolPermissions[tool.id];
      return {
        ...tool,
        name: toolDisplayName(tool.id, copy),
        status: permissionDisplayLabel(permission, copy),
        tone: toolPermissionTone(permission),
      };
    }).filter(tool => tool.id === 'shell' || tool.id === 'fileSystem' || tool.id === 'browser'),
  ]), [copy, toolPermissions]);
  const updateToolPermission = useCallback((toolId: RuntimeGuardToolId, permission: RuntimeGuardToolPermission) => {
    if (toolPermissions[toolId] === permission) return;
    const previousPermissions = toolPermissions;
    const nextPermissions = { ...toolPermissions, [toolId]: permission };
    setToolPermissions(nextPermissions);
    guardAPI.setToolPolicies(toolPoliciesFromPermissions(nextPermissions))
      .then(({ data }) => {
        setToolPermissions(toolPermissionsFromPolicies(data.policies));
      })
      .catch(() => {
        setToolPermissions(previousPermissions);
        setPlaceholder('Failed to save tool permission.');
        window.setTimeout(() => setPlaceholder(''), 2600);
      });
  }, [toolPermissions]);

  useEffect(() => {
    const updateLayoutFit = () => {
      const availableWidth = Math.max(1, window.innerWidth - RUNTIME_GUARD_RIGHT_EDGE_GUARD);
      const heightScale = window.innerHeight / RUNTIME_GUARD_DESIGN_HEIGHT;
      const widthScale = availableWidth / RUNTIME_GUARD_MIN_DESIGN_WIDTH;
      const scale = Math.min(heightScale, widthScale);
      const leftWidth = RUNTIME_GUARD_LEFT_WIDTH * scale;
      const rightWidth = RUNTIME_GUARD_RIGHT_WIDTH * scale;
      const mainWidth = Math.max(availableWidth - leftWidth - rightWidth, RUNTIME_GUARD_MIN_MAIN_WIDTH * scale);

      setLayoutFit({
        scale,
        height: window.innerHeight,
        leftWidth,
        rightWidth,
        mainWidth,
        mainDesignWidth: mainWidth / scale,
      });
    };

    updateLayoutFit();
    window.addEventListener('resize', updateLayoutFit);
    return () => window.removeEventListener('resize', updateLayoutFit);
  }, []);

  useEffect(() => {
    saveRuntimeGuardSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    saveRuntimeGuardDrafts(draftBySessionKey);
  }, [draftBySessionKey]);

  useEffect(() => {
    if (budgetPlatformOptions.length > 0 && !budgetPlatformOptions.some(option => option.platform === selectedBudgetPlatform)) {
      setSelectedBudgetPlatform(budgetPlatformOptions[0].platform);
    }
  }, [budgetPlatformOptions, selectedBudgetPlatform]);

  useEffect(() => {
    if (budgetPlatformOptions.some(option => option.platform === activeBudgetPlatform)) {
      setSelectedBudgetPlatform(activeBudgetPlatform);
    }
  }, [activeBudgetPlatform, activeSessionKey, budgetPlatformOptions]);

  const fetchSessionHistory = useCallback(async (showLoading = false): Promise<RuntimeGuardSession[] | null> => {
    if (showLoading) setSessionHistoryLoading(true);
    try {
      const [runtimeResult, codexResult] = await Promise.allSettled([
        sessionsAPI.listRuntime({ page: 1, page_size: 100 }),
        systemAPI.listCodexSessions({ limit: 100 }),
      ]);
      if (runtimeResult.status === 'rejected' && codexResult.status === 'rejected') {
        return null;
      }
      const runtimeSessions = runtimeResult.status === 'fulfilled'
        ? (runtimeResult.value.data.sessions ?? [])
          .map(runtimeSessionRecordToRuntimeGuardSession)
          .filter((session): session is RuntimeGuardSession => session !== null)
        : [];
      const codexSessions = codexResult.status === 'fulfilled'
        ? (codexResult.value.data.sessions ?? [])
          .map(codexSessionRecordToRuntimeGuardSession)
          .filter((session): session is RuntimeGuardSession => session !== null)
        : [];
      const nextSessions = [...runtimeSessions, ...codexSessions];
      setSessionHistoryItems(sortSessionsNewestFirst(nextSessions));
      return nextSessions;
    } catch {
      return null;
    } finally {
      if (showLoading) setSessionHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessionHistory(true);
    const timer = window.setInterval(() => {
      void fetchSessionHistory(false);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [fetchSessionHistory]);

  useEffect(() => {
    let cancelled = false;

    guardAPI.toolPolicies()
      .then(({ data }) => {
        if (!cancelled) {
          setToolPermissions(toolPermissionsFromPolicies(data.policies));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPlaceholder('Failed to load tool permissions.');
        window.setTimeout(() => setPlaceholder(''), 2600);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeSessionId && sessions.some(session => session.sessionKey === activeSessionId)) return;
    const nextActive = sessions[0] ?? null;
    setActiveSessionId(nextActive?.sessionKey ?? '');
    if (nextActive) setSelectedAgent(nextActive.agent);
  }, [activeSessionId, sessions]);

  useEffect(() => {
    let cancelled = false;

    systemAPI.installStatus()
      .then((res) => {
        if (cancelled) return;
        setInstalledAgents({
          OpenClaw: Boolean(res.data.openclaw_installed),
          Hermes: Boolean(res.data.hermes_installed),
          Nanobot: Boolean(res.data.nanobot_installed),
          Codex: Boolean(res.data.codex_installed),
        });
        setXsafeclawVersion(res.data.xsafeclaw_version ?? BUILD_TIME_XSAFECLAW_VERSION);
        setInstallProbeFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInstallProbeFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshRuntimeBudgets = useCallback(async (): Promise<RuntimeBudgetStatusMap | null> => {
    try {
      const { data } = await budgetAPI.listRuntimeBudgets();
      const next = runtimeBudgetStatusMapFromList(data.budgets ?? []);
      setRuntimeBudgetStatuses(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshRuntimeBudgets();
    const timer = window.setInterval(() => {
      void refreshRuntimeBudgets();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshRuntimeBudgets]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scrollNode = taskScrollRef.current;
      if (scrollNode && typeof scrollNode.scrollTo === 'function') {
        scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: 'smooth' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSessionKey, activeTimelineScrollKey]);

  useEffect(() => {
    if (!activeSessionKey) return;
    window.setTimeout(() => textareaRef.current?.focus(), 80);
  }, [activeSessionKey]);

  const loadHistory = useCallback(async (sessionKey: string, force = false) => {
    if (!force && chatStreamStore.hasLoadedMessages(sessionKey)) return;
    const session = sessions.find(session => session.sessionKey === sessionKey);
    if (session?.codexHistory && session.historySessionId) {
      setLoadingHistory(sessionKey);
      try {
        const res = await systemAPI.getCodexSessionMessages(session.historySessionId);
        const loaded = (res.data.messages ?? [])
          .map((message: any) => mapHistoryMessage(message))
          .filter((message): message is ChatMessage => message !== null);
        setMessageMap(prev => ({ ...prev, [sessionKey]: loaded }));
      } catch {
        setMessageMap(prev => ({ ...prev, [sessionKey]: [] }));
      } finally {
        setLoadingHistory(current => (current === sessionKey ? null : current));
      }
      return;
    }
    if (session && !isRuntimeBackedSession(session)) {
      setMessageMap(prev => ({ ...prev, [sessionKey]: prev[sessionKey] ?? [] }));
      return;
    }
    setLoadingHistory(sessionKey);
    try {
      const res = await chatAPI.getHistory(sessionKey);
      const sessionPlatform = session?.platform;
      const loaded = (res.data.messages ?? [])
        .map((message: any) => mapHistoryMessage(message, sessionPlatform))
        .filter((message): message is ChatMessage => message !== null);
      setMessageMap(prev => ({ ...prev, [sessionKey]: loaded }));
    } catch {
      setMessageMap(prev => ({ ...prev, [sessionKey]: [] }));
    } finally {
      setLoadingHistory(current => (current === sessionKey ? null : current));
    }
  }, [sessions, setMessageMap]);

  useEffect(() => {
    if (activeSession?.sessionKey) {
      loadHistory(activeSession.sessionKey);
    }
  }, [activeSession?.sessionKey, activeSession?.codexHistory, activeSession?.historySessionId, loadHistory]);

  useEffect(() => {
    if (!demoCodexQuestion || !activeSession?.sessionKey || activeSession.agent !== 'Codex') return;
    if (activeMessages.some(message => message.id === demoCodexQuestion.id)) return;
    setMessageMap(current => {
      const currentMessages = current[activeSession.sessionKey] ?? [];
      if (currentMessages.some(message => message.id === demoCodexQuestion.id)) return current;
      return {
        ...current,
        [activeSession.sessionKey]: [...currentMessages, demoCodexQuestion],
      };
    });
  }, [activeMessages, activeSession?.agent, activeSession?.sessionKey, demoCodexQuestion, setMessageMap]);

  const syncMiddleApprovalCards = useCallback((
    items: GuardPendingApproval[],
    options: {
      createResolvedIds?: Set<string>;
      preferredSessionKey?: string;
    } = {},
  ) => {
    setMiddleApprovalCardsBySession(current => (
      upsertMiddleApprovalCards(current, items, sessions, options)
    ));
  }, [sessions]);

  const unresolvedApprovalItems = useMemo(
    () => [...approvalItems]
      .filter(item => !item.resolved)
      .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0)),
    [approvalItems],
  );
  const activeUnresolvedApprovalItems = useMemo(
    () => activeApprovalCards
      .filter(card => !card.item.resolved && card.status === 'pending')
      .map(card => card.item),
    [activeApprovalCards],
  );
  const activeApprovalCount = useMemo(
    () => activeUnresolvedApprovalItems.length,
    [activeUnresolvedApprovalItems.length],
  );
  const visibleApprovals = useMemo(
    () => activeUnresolvedApprovalItems.slice(0, 1),
    [activeUnresolvedApprovalItems],
  );
  const demoApproval = useMemo(() => demoRightApprovalItem(), []);
  const rightPanelApprovals = visibleApprovals.length > 0
    ? visibleApprovals
    : demoApproval
      ? [demoApproval]
      : [];
  const rightPanelApprovalCount = visibleApprovals.length > 0
    ? activeApprovalCount
    : demoApproval
      ? 1
      : activeApprovalCount;
  const allBlockedItems = useMemo(
    () => mergeBlockedItems(approvalItems, blockedObservations),
    [approvalItems, blockedObservations],
  );
  const recentBlockedItems = useMemo(
    () => allBlockedItems.slice(0, 2),
    [allBlockedItems],
  );
  const guardStatusSummary = useMemo(
    () => calculateGuardStatusSummary(guardMode, toolPermissions, unresolvedApprovalItems),
    [guardMode, toolPermissions, unresolvedApprovalItems],
  );
  const guardStatusRows = useMemo(
    () => buildGuardStatusRows(guardMode, toolPermissions, unresolvedApprovalItems.length),
    [guardMode, toolPermissions, unresolvedApprovalItems.length],
  );
  const agents: AgentDisplay[] = useMemo(
    () => sidebarAgentDefinitions.map(agent => {
      const installed = installedAgents[agent.name];
      const probeUnknown = installed === null || installProbeFailed;
      const inferredInstalled = agent.runtimeBacked
        ? probeUnknown
          ? availableInstances.some(instance => instance.platform === agent.platform) || installed !== false
          : Boolean(installed)
        : installed === true;
      return {
        name: agent.name,
        className: agent.className,
        installed: inferredInstalled,
        runtimeBacked: agent.runtimeBacked,
        status: runtimeGuardAgentStatus(agent.name, inferredInstalled, sessions, messageMap, sendingMap),
      };
    }),
    [availableInstances, installProbeFailed, installedAgents, messageMap, sendingMap, sessions],
  );
  const budgetStatus = runtimeBudgetStatuses[selectedBudgetPlatform] ?? defaultRuntimeBudgetStatus(selectedBudgetPlatform);
  const activeBudgetStatus = runtimeBudgetStatuses[activeBudgetPlatform] ?? defaultRuntimeBudgetStatus(activeBudgetPlatform);
  const {
    budgetUsed,
    budgetPercent,
  } = budgetStatus;
  const budgetLimit = budgetStatus.maxCost;
  const budgetRemainingMs = runtimeBudgetRemainingMs(budgetStatus, nowTs);
  const selectedBudgetOverLimit = budgetStatus.overLimit;
  const budgetOverLimit = activeBudgetStatus.overLimit;
  const activeBudgetRemainingMs = runtimeBudgetRemainingMs(activeBudgetStatus, nowTs);
  const budgetConfigured = budgetLimit !== null;
  const budgetDisplayCost = budgetConfigured ? budgetUsed : budgetStatus.currentCost;
  const budgetDisplayCostText = formatMoney(budgetDisplayCost);
  const budgetLimitText = budgetLimit !== null ? formatMoney(budgetLimit) : '';
  const budgetBarPercent = budgetConfigured ? Math.max(4, budgetPercent) : 0;
  const selectedBudgetAgentName = agentDefinitions.find(agent => agent.platform === selectedBudgetPlatform)?.name ?? copy.sidebar.runtimeFallback;
  const activeBudgetAgentName = agentDefinitions.find(agent => agent.platform === activeBudgetPlatform)?.name ?? copy.sidebar.runtimeFallback;
  const budgetResetText = budgetConfigured
    ? rgText(copy.sidebar.resetsIn, { time: formatBudgetRefreshTime(budgetRemainingMs, copy) })
    : rgText(copy.sidebar.totalCost, { agent: selectedBudgetAgentName });
  const showCodexQuotaBudget = selectedAgent === 'Codex';
  const codexFiveHourWindow = codexRateLimitsState.data?.five_hour ?? null;
  const codexWeekWindow = codexRateLimitsState.data?.seven_day ?? null;
  const codexFiveHourRemainingPercent = formatCodexQuotaPercent(codexFiveHourWindow?.remaining_percent);
  const codexWeekRemainingPercent = formatCodexQuotaPercent(codexWeekWindow?.remaining_percent);
  const codexFiveHourResetText = formatCodexQuotaRefresh(
    codexFiveHourWindow,
    'fiveHour',
    codexRateLimitsState,
    copy,
    locale,
  );
  const codexWeekResetText = formatCodexQuotaRefresh(
    codexWeekWindow,
    'sevenDay',
    codexRateLimitsState,
    copy,
    locale,
  );

  useEffect(() => {
    if (!showCodexQuotaBudget) return;
    void refreshCodexRateLimits();
  }, [refreshCodexRateLimits, showCodexQuotaBudget]);

  useEffect(() => {
    if (!showCodexQuotaBudget) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshCodexRateLimits();
      }
    }, CODEX_QUOTA_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshCodexRateLimits();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshCodexRateLimits, showCodexQuotaBudget]);

  const showToast = useCallback((message: string, timeout = 2600) => {
    setPlaceholder(message);
    window.setTimeout(() => setPlaceholder(''), timeout);
  }, []);

  const fetchApprovalItems = useCallback(async (showLoading = false): Promise<GuardPendingApproval[] | null> => {
    if (showLoading) setApprovalLoading(true);
    try {
      const { data } = await guardAPI.pending();
      setApprovalItems(data);
      syncMiddleApprovalCards(data);
      return data;
    } catch {
      // Keep the last known approval queue if the poll fails temporarily.
      return null;
    } finally {
      if (showLoading) setApprovalLoading(false);
    }
  }, [syncMiddleApprovalCards]);

  const fetchBlockedObservations = useCallback(async (showLoading = false): Promise<GuardRuntimeObservation[] | null> => {
    if (showLoading) setBlockedLoading(true);
    try {
      const { data } = await guardAPI.observations();
      setBlockedObservations(data);
      return data;
    } catch {
      // Keep the last known blocked list if observations are temporarily unavailable.
      return null;
    } finally {
      if (showLoading) setBlockedLoading(false);
    }
  }, []);

  const refreshApprovalItemsSoon = useCallback(() => {
    void fetchApprovalItems(false);
    void fetchBlockedObservations(false);
    if (approvalRefreshTimerRef.current !== null) {
      window.clearTimeout(approvalRefreshTimerRef.current);
    }
    approvalRefreshTimerRef.current = window.setTimeout(() => {
      approvalRefreshTimerRef.current = null;
      void fetchApprovalItems(false);
      void fetchBlockedObservations(false);
    }, 500);
  }, [fetchApprovalItems, fetchBlockedObservations]);

  useEffect(() => {
    fetchApprovalItems(true);
    fetchBlockedObservations(true);
    const timer = window.setInterval(() => {
      void fetchApprovalItems(false);
      void fetchBlockedObservations(false);
    }, APPROVAL_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchApprovalItems, fetchBlockedObservations]);

  useEffect(() => () => {
    if (approvalRefreshTimerRef.current !== null) {
      window.clearTimeout(approvalRefreshTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    guardAPI.getEnabled()
      .then(res => {
        if (!cancelled) setGuardMode(res.data.enabled ? 'On' : 'Off');
      })
      .catch(() => {
        if (!cancelled) showToast(copy.toasts.failedLoadGuardMode);
      });
    return () => {
      cancelled = true;
    };
  }, [copy, showToast]);

  const resolveApproval = async (item: GuardPendingApproval, resolution: ApprovalDecision) => {
    if (resolvingApprovalId) return;
    setResolvingApprovalId(item.id);
    try {
      const { data } = await guardAPI.resolve(item.id, resolution);
      setApprovalItems(current => upsertApprovalItem(current, data));
      syncMiddleApprovalCards([data], {
        createResolvedIds: new Set([item.id]),
        preferredSessionKey: activeSession?.sessionKey,
      });
      await fetchApprovalItems(false);
      if (resolution === 'rejected') {
        void fetchBlockedObservations(false);
      }
    } catch (err: unknown) {
      const status = responseStatus(err);
      const latest = await fetchApprovalItems(false);
      const latestItem = latest?.find(approval => approval.id === item.id);
      if (status === 404 && latestItem?.resolved) {
        syncMiddleApprovalCards([latestItem], {
          createResolvedIds: new Set([item.id]),
          preferredSessionKey: activeSession?.sessionKey,
        });
      } else if (status === 404) {
        showToast(copy.toasts.approvalGone);
      } else {
        showToast(resolution === 'approved' ? copy.toasts.failedApprovalAllow : copy.toasts.failedApprovalDeny);
      }
    } finally {
      setResolvingApprovalId(null);
    }
  };

  const showInstallHint = useCallback((agent: AgentName) => {
    showToast(rgText(copy.toasts.installHint, { agent }));
  }, [copy, showToast]);

  useEffect(() => {
    if (!budgetModalOpen) return;
    const status = runtimeBudgetStatuses[selectedBudgetPlatform] ?? defaultRuntimeBudgetStatus(selectedBudgetPlatform);
    setBudgetAmountInput(formatBudgetInputValue(status.maxCost));
    setBudgetPeriodInput(status.maxCost && status.periodValue ? String(status.periodValue) : '');
    setBudgetPeriodUnit(status.periodUnit === 'day' ? 'day' : 'hour');
  }, [budgetModalOpen, runtimeBudgetStatuses, selectedBudgetPlatform]);

  const openBudgetModal = () => {
    setBudgetAmountInput(formatBudgetInputValue(budgetLimit));
    setBudgetPeriodInput(budgetLimit && budgetStatus.periodValue ? String(budgetStatus.periodValue) : '');
    setBudgetPeriodUnit(budgetStatus.periodUnit === 'day' ? 'day' : 'hour');
    setBudgetModalOpen(true);
  };

  const saveBudgetLimit = async () => {
    const maxCost = Number(budgetAmountInput);
    const periodValue = Number(budgetPeriodInput);
    if (!Number.isFinite(maxCost) || maxCost <= 0 || !Number.isFinite(periodValue) || periodValue <= 0) return;
    const roundedMaxCost = Math.round(maxCost * 100) / 100;

    setBudgetSaving(true);
    try {
      const { data } = await budgetAPI.updateRuntimeBudget(selectedBudgetPlatform, {
        maxCost: roundedMaxCost,
        periodValue,
        periodUnit: budgetPeriodUnit,
      });
      setRuntimeBudgetStatuses(current => ({ ...current, [selectedBudgetPlatform]: data }));
      setNowTs(Date.now());
      setBudgetModalOpen(false);
    } catch {
      showToast(rgText(copy.toasts.failedSaveBudget, { agent: selectedBudgetAgentName }));
    } finally {
      setBudgetSaving(false);
    }
  };

  const clearBudgetLimit = async () => {
    const periodValue = budgetStatus.periodValue || 24;
    const periodUnit = budgetStatus.periodUnit || 'hour';
    setBudgetSaving(true);
    try {
      const { data } = await budgetAPI.updateRuntimeBudget(selectedBudgetPlatform, {
        maxCost: null,
        periodValue,
        periodUnit,
      });
      setRuntimeBudgetStatuses(current => ({ ...current, [selectedBudgetPlatform]: data }));
      setNowTs(Date.now());
      setBudgetAmountInput('');
      setBudgetPeriodInput('');
      setBudgetModalOpen(false);
    } catch {
      showToast(rgText(copy.toasts.failedClearBudget, { agent: selectedBudgetAgentName }));
    } finally {
      setBudgetSaving(false);
    }
  };

  const findRuntimeForAgent = useCallback((agent: AgentName): RuntimeInstance | null => {
    return findRuntimeForAgentInInstances(agent, availableInstances);
  }, [availableInstances]);

  const addCreatedRuntimeSession = useCallback((
    agent: AgentName,
    data: StartSessionResponse,
    fallbackRuntime?: RuntimeInstance | null,
  ) => {
    const platform = normalizeRuntimePlatform(data.platform);
    const sameAgentCount = sessions.filter(session => session.agent === agent).length + 1;
    const label = sameAgentCount === 1 ? agent : `${agent} ${sameAgentCount}`;
    const session: RuntimeGuardSession = {
      sessionKey: data.session_key,
      agent,
      platform,
      instanceId: data.instance_id,
      displayName: data.instance?.display_name || fallbackRuntime?.display_name,
      workspacePath: data.instance?.workspace_path || fallbackRuntime?.workspace_path || undefined,
      title: label,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status: 'ready',
      autoTitlePending: true,
    };

    setSessions(current => [session, ...current]);
    setSessionHistoryItems(current => sortSessionsNewestFirst([session, ...current.filter(item => item.sessionKey !== session.sessionKey)]));
    setMessageMap(prev => ({ ...prev, [session.sessionKey]: [] }));
    setDraftBySessionKey(current => ({ ...current, [session.sessionKey]: current[session.sessionKey] ?? '' }));
    setActiveSessionId(session.sessionKey);
    setSelectedAgent(agent);
    return session;
  }, [sessions, setMessageMap]);

  const addCodexConversationSession = useCallback(async () => {
    const currentCodexConfig = loadCodexConfig();
    const nextModel = currentCodexConfig.defaultModel;
    const nextSpeed = codexModelSupportsFast(nextModel) ? currentCodexConfig.defaultSpeed : 'standard';
    setCodexModel(nextModel);
    setCodexReasoningLevel(currentCodexConfig.defaultReasoning);
    setCodexSpeed(nextSpeed);
    setCodexPermissionMode(currentCodexConfig.permissionMode);

    const now = new Date().toISOString();
    const sameAgentCount = sessions.filter(session => session.agent === 'Codex').length + 1;
    const fallbackLabel = sameAgentCount === 1 ? 'Codex' : `Codex ${sameAgentCount}`;
    const session: RuntimeGuardSession = {
      sessionKey: `codex:pending:${uuidv4()}`,
      agent: 'Codex',
      platform: 'codex',
      instanceId: 'codex-cli',
      displayName: 'Codex CLI',
      workspacePath: currentCodexConfig.workspaceDir.trim() || undefined,
      title: fallbackLabel,
      createdAt: now,
      lastActivityAt: now,
      status: 'ready',
      autoTitlePending: false,
      frontendOnly: true,
    };

    setSessions(current => [session, ...current]);
    setSessionHistoryItems(current => sortSessionsNewestFirst([session, ...current.filter(item => item.sessionKey !== session.sessionKey)]));
    setMessageMap(prev => ({ ...prev, [session.sessionKey]: [] }));
    setDraftBySessionKey(current => ({ ...current, [session.sessionKey]: current[session.sessionKey] ?? '' }));
    setActiveSessionId(session.sessionKey);
    setSelectedAgent('Codex');
    return session;
  }, [sessions, setMessageMap]);

  const openSession = useCallback(async (agent: AgentName, installed = true) => {
    if (creatingAgent) return;
    if (!installed) {
      showInstallHint(agent);
      return;
    }
    if (agent === 'Codex') {
      setCreatingAgent(agent);
      setSelectedAgent(agent);
      try {
        await addCodexConversationSession();
      } catch (err: any) {
        const detail = String(err?.response?.data?.detail || err?.message || 'Codex safety instructions failed to load.');
        showToast(detail);
      } finally {
        setCreatingAgent(null);
      }
      return;
    }
    if (!isRuntimeAgentName(agent)) {
      showToast(rgText(copy.toasts.noEnabledRuntime, { agent }));
      return;
    }
    if (runtimeInstancesQuery.isLoading) {
      showToast(copy.toasts.runtimeInstancesLoading);
      return;
    }

    const runtime = findRuntimeForAgent(agent);
    if (!runtime) {
      showToast(rgText(copy.toasts.noEnabledRuntime, { agent }));
      return;
    }

    const unavailable = runtimeUnavailableMessage(runtime, copy);
    if (unavailable) {
      showToast(unavailable);
      return;
    }

    setCreatingAgent(agent);
    setSelectedAgent(agent);
    try {
      const res = await chatAPI.startSession(runtimeGuardStartSessionPayload(runtime));
      addCreatedRuntimeSession(agent, res.data, runtime);
    } catch (err: any) {
      const detail = String(err?.response?.data?.detail || err?.message || copy.toasts.failedCreateSession);
      showToast(detail);
    } finally {
      setCreatingAgent(null);
    }
  }, [
    creatingAgent,
    addCreatedRuntimeSession,
    addCodexConversationSession,
    findRuntimeForAgent,
    copy,
    runtimeInstancesQuery.isLoading,
    showInstallHint,
    showToast,
  ]);

  const openSelectedAgentSession = () => {
    openSession(selectedAgent, agents.find(agent => agent.name === selectedAgent)?.installed ?? true);
  };

  const openNewTaskModal = () => {
    setNewTaskRequest('');
    setNewTaskModalOpen(true);
  };

  const closeNewTaskModal = () => {
    setNewTaskModalOpen(false);
    setNewTaskRequest('');
  };

  const createNewTask = async () => {
    const requestText = newTaskRequest.trim();
    if (newTaskCreating || creatingAgent || !requestText) return;

    setNewTaskCreating(true);
    try {
      const res = await chatAPI.smartStartSession({ message: requestText });
      const platform = normalizeRuntimePlatform(res.data.platform);
      const agent = platformToAgent(platform);
      const createdSession = addCreatedRuntimeSession(agent, res.data, findRuntimeForAgent(agent));
      closeNewTaskModal();
      if (createdSession) {
        void sendMessageForSession(createdSession, requestText);
      }
    } catch {
      showToast(copy.toasts.smartFailed);
    } finally {
      setNewTaskCreating(false);
      setCreatingAgent(null);
    }
  };

  const applyGuardMode = async (mode: GuardMode) => {
    if (mode === guardMode || guardModeSyncing) {
      setAutoApprovalOpen(false);
      return;
    }
    const previous = guardMode;
    setGuardMode(mode);
    setAutoApprovalOpen(false);
    setGuardModeSyncing(true);
    try {
      const res = await guardAPI.setEnabled(mode === 'On');
      setGuardMode(res.data.enabled ? 'On' : 'Off');
    } catch {
      setGuardMode(previous);
      showToast(copy.toasts.failedUpdateGuardMode);
    } finally {
      setGuardModeSyncing(false);
    }
  };

  const closeSession = useCallback((sessionKey: string) => {
    setSessions(current => {
      const closingIndex = current.findIndex(session => session.sessionKey === sessionKey);
      const next = current.filter(session => session.sessionKey !== sessionKey);
      if (sessionKey === activeSessionId) {
        const nextActive = next[Math.max(0, closingIndex - 1)] ?? next[0] ?? null;
        setActiveSessionId(nextActive?.sessionKey ?? '');
        if (nextActive) setSelectedAgent(nextActive.agent);
      }
      return next;
    });
    setDraftBySessionKey(current => {
      const next = { ...current };
      delete next[sessionKey];
      return next;
    });
    setMiddleApprovalCardsBySession(current => {
      if (!current[sessionKey]) return current;
      const next = { ...current };
      delete next[sessionKey];
      return next;
    });
    chatStreamStore.deleteMessages(sessionKey);
  }, [activeSessionId]);

  const openHistorySession = useCallback((session: RuntimeGuardSession) => {
    if (session.codexHistory) {
      chatStreamStore.deleteMessages(session.sessionKey);
      if (session.historySessionId) {
        void systemAPI.resumeCodexConversation({
          thread_id: session.historySessionId,
          cwd: session.workspacePath || null,
          model: codexModel,
          permission_mode: codexPermissionMode,
        }).catch((err: any) => {
          const detail = String(err?.response?.data?.detail || err?.message || 'Codex safety instructions failed to load.');
          showToast(detail);
        });
      }
    }
    setSessions(current => promoteRuntimeGuardSession(current, session));
    setDraftBySessionKey(current => ({ ...current, [session.sessionKey]: current[session.sessionKey] ?? '' }));
    setSelectedAgent(session.agent);
    setActiveSessionId(session.sessionKey);
  }, [codexModel, codexPermissionMode, showToast]);

  const deleteHistorySession = async (session: RuntimeGuardSession) => {
    if (session.codexHistory) return;

    const removeLocalSession = () => {
      setSessionHistoryItems(current => current.filter(item => (
        item.sessionKey !== session.sessionKey
        && (!session.historySessionId || item.historySessionId !== session.historySessionId)
      )));
      closeSession(session.sessionKey);
    };

    if (!session.historySessionId) {
      removeLocalSession();
      return;
    }

    try {
      await chatAPI.deleteSession(session.historySessionId);
      removeLocalSession();
      void fetchSessionHistory(false);
    } catch (error: unknown) {
      if (responseStatus(error) === 404) {
        removeLocalSession();
        void fetchSessionHistory(false);
        return;
      }
      showToast('Failed to delete session history.');
    }
  };

  const updateActiveDraft = (value: string) => {
    if (!activeSession) return;
    setDraftBySessionKey(current => ({ ...current, [activeSession.sessionKey]: value }));
  };

  const renameSessionKey = useCallback((previousKey: string, nextKey: string) => {
    if (previousKey === nextKey) return;
    chatStreamStore.renameSession(previousKey, nextKey);
    setSessions(current => current.map(session => (
      session.sessionKey === previousKey ? { ...session, sessionKey: nextKey } : session
    )));
    setSessionHistoryItems(current => current.map(session => (
      session.sessionKey === previousKey ? { ...session, sessionKey: nextKey } : session
    )));
    setDraftBySessionKey(current => {
      const next = { ...current, [nextKey]: current[previousKey] ?? '' };
      delete next[previousKey];
      return next;
    });
    setMiddleApprovalCardsBySession(current => {
      const previousCards = current[previousKey];
      if (!previousCards) return current;
      const nextCards = Object.fromEntries(
        Object.entries(previousCards).map(([id, card]) => [
          id,
          { ...card, sessionKey: nextKey },
        ]),
      );
      const next = { ...current, [nextKey]: { ...(current[nextKey] ?? {}), ...nextCards } };
      delete next[previousKey];
      return next;
    });
    setActiveSessionId(current => (current === previousKey ? nextKey : current));
  }, []);

  const markSessionTitleRequested = useCallback((sessionKey: string) => {
    setSessions(current => current.map(session => (
      session.sessionKey === sessionKey && session.autoTitlePending
        ? { ...session, autoTitlePending: false }
        : session
    )));
    setSessionHistoryItems(current => current.map(session => (
      session.sessionKey === sessionKey && session.autoTitlePending
        ? { ...session, autoTitlePending: false }
        : session
    )));
  }, []);

  const applySessionTitle = useCallback((sessionKey: string, title: string, fallback = '') => {
    const nextTitle = titleFromUserMessage(title, fallback);
    if (!nextTitle) return;
    setSessions(current => current.map(session => (
      session.sessionKey === sessionKey
        ? { ...session, title: nextTitle, autoTitlePending: false }
        : session
    )));
    setSessionHistoryItems(current => current.map(session => (
      session.sessionKey === sessionKey
        ? { ...session, title: nextTitle, autoTitlePending: false }
        : session
    )));
  }, []);

  const submitCodexQuestionResponse = async (
    msg: ChatMessage,
    payload: CodexRequestUserInputResponseRequest,
  ) => {
    if (!activeSession || activeSession.agent !== 'Codex') {
      throw new Error('Codex session is not active.');
    }
    const sessionKey = activeSession.sessionKey;
    const requestId = msg.codex_request_id;
    const isPlanConfirmation = msg.codex_question_kind === 'plan_confirmation';
    if (!requestId && !isPlanConfirmation) {
      throw new Error('Codex request id is missing.');
    }

    const answerValues = Object.fromEntries(
      Object.entries(payload.answers).map(([questionId, answer]) => [questionId, answer.answers]),
    );
    const updateQuestionMessage = (updater: (message: ChatMessage) => ChatMessage) => {
      setMessageMap(prev => ({
        ...prev,
        [sessionKey]: (prev[sessionKey] ?? []).map(message => (
          message.id === msg.id ? updater(message) : message
        )),
      }));
    };

    updateQuestionMessage(message => ({
      ...message,
      codex_response_status: 'submitting',
      codex_answer_values: answerValues,
      codex_error: undefined,
    }));

    if (isPlanConfirmation) {
      const answer = Object.values(answerValues)[0]?.[0]?.trim() ?? '';
      const executePlan = isCodexPlanExecuteAnswer(answer);
      const nextPrompt = executePlan
        ? codexPlanExecutePrompt(locale)
        : codexPlanRevisionPrompt(locale, answer);
      if (executePlan) {
        setCodexPlanMode(false);
      }
      try {
        await sendMessageForSession(activeSession, nextPrompt, {
          codexPlanMode: !executePlan,
          codexGoalMode: false,
        });
        updateQuestionMessage(message => ({
          ...message,
          codex_response_status: 'submitted',
          codex_answer_values: answerValues,
        }));
      } catch (error: any) {
        const detail = String(error?.message || 'Failed to send Codex response.');
        updateQuestionMessage(message => ({
          ...message,
          codex_response_status: 'error',
          codex_answer_values: answerValues,
          codex_error: detail,
        }));
        throw new Error(detail);
      }
      return;
    }

    const nativeRequestId = requestId ?? '';
    if (nativeRequestId.startsWith('demo-')) {
      updateQuestionMessage(message => ({
        ...message,
        codex_response_status: 'submitted',
        codex_answer_values: answerValues,
      }));
      return;
    }

    try {
      await systemAPI.respondCodexUserInputRequest(sessionKey, nativeRequestId, payload);
      updateQuestionMessage(message => ({
        ...message,
        codex_response_status: 'submitted',
        codex_answer_values: answerValues,
      }));
    } catch (error: any) {
      const detail = String(error?.response?.data?.detail || error?.message || 'Failed to send Codex response.');
      updateQuestionMessage(message => ({
        ...message,
        codex_response_status: 'error',
        codex_answer_values: answerValues,
        codex_error: detail,
      }));
      throw new Error(detail);
    }
  };

  const clearCodexGoal = useCallback(async (msg: ChatMessage) => {
    if (!activeSession || activeSession.agent !== 'Codex') {
      throw new Error('Codex session is not active.');
    }
    const sessionKey = activeSession.sessionKey;
    const threadId = msg.codex_goal?.thread_id || activeSession.historySessionId || sessionKey.replace(/^codex:/, '');
    await systemAPI.clearCodexGoal(sessionKey, { thread_id: threadId || null });
    setCodexGoalBySessionKey(current => ({ ...current, [sessionKey]: null }));
    setMessageMap(prev => ({
      ...prev,
      [sessionKey]: (prev[sessionKey] ?? []).map(message => (
        message.id === msg.id
          ? {
              ...message,
              content: message.content || msg.codex_goal?.objective || '',
              codex_goal: { ...(message.codex_goal ?? {}), status: 'cleared' },
            }
          : message
      )),
    }));
  }, [activeSession, setMessageMap]);

  async function sendMessageForSession(
    session: RuntimeGuardSession,
    rawText: string,
    options: { codexPlanMode?: boolean; codexGoalMode?: boolean } = {},
  ) {
    const originalKey = session.sessionKey;
    const text = rawText.trim();
    if (!text || (sendingMap[originalKey] ?? false) || inFlightKeysRef.current.has(originalKey)) return;

    if (session.agent === 'Codex') {
      let activeKey = originalKey;
      let activeThreadId: string | null = session.historySessionId
        || (session.sessionKey.startsWith('codex:pending:') ? null : session.sessionKey.replace(/^codex:/, '') || null);
      const effectiveCodexPlanMode = options.codexPlanMode ?? codexPlanMode;
      const effectiveCodexGoalMode = options.codexGoalMode ?? codexGoalMode;
      const activity = new Date();
      const activityIso = activity.toISOString();
      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: 'user',
        content: text,
        timestamp: activity,
      };
      const pendingId = uuidv4();
      const assistantMsg: ChatMessage = {
        id: pendingId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        pending: true,
      };

      inFlightKeysRef.current.add(originalKey);
      chatStreamStore.setSending(originalKey, true);
      setDraftBySessionKey(current => ({ ...current, [originalKey]: '' }));
      setSessions(current => current.map(session => (
        session.sessionKey === originalKey ? { ...session, lastActivityAt: activityIso } : session
      )));
      setSessionHistoryItems(current => sortSessionsNewestFirst(current.map(session => (
        session.sessionKey === originalKey ? { ...session, lastActivityAt: activityIso } : session
      ))));
      setMessageMap(prev => ({ ...prev, [originalKey]: [...(prev[originalKey] ?? []), userMsg, assistantMsg] }));

      try {
        if (!activeThreadId && !session.sessionKey.startsWith('codex:pending:')) {
          throw new Error('Codex thread id is missing.');
        }
        const response = await fetch(`/api/system/codex/conversations/${encodeURIComponent(activeKey)}/turns/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            thread_id: activeThreadId,
            cwd: session.workspacePath || null,
            model: codexModelId(codexModel),
            reasoning_effort: codexReasoningLevel,
            speed: codexEffectiveSpeed,
            permission_mode: codexPermissionMode,
            plan_mode: effectiveCodexPlanMode,
            goal_mode: effectiveCodexGoalMode,
            goal_objective: effectiveCodexGoalMode ? text : null,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(await responseErrorMessage(response, copy));
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamDone = false;
        let sawCodexPlanUpdate = false;
        let sawCodexNativeUserInputRequest = false;
        let latestCodexPlanTurnId = '';
        let latestCodexPlanItemId = '';

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') {
              streamDone = true;
              break;
            }

            try {
              const chunk = JSON.parse(raw) as {
                type: string;
                text?: string;
                tool_id?: string;
                tool_name?: string;
                args?: any;
                result?: any;
                is_error?: boolean;
                tool_category?: string;
                tool_action?: string;
                timeline_kind?: string;
                risk_level?: string;
                request_id?: string;
                thread_id?: string;
                session_key?: string;
                cwd?: string | null;
                turn_id?: string;
                item_id?: string;
                questions?: ChatMessage['codex_questions'];
                explanation?: string | null;
                steps?: ChatMessage['codex_plan_steps'];
                delta?: string;
                goal?: ChatMessage['codex_goal'];
              };

              const appendBeforeAssistant = (message: ChatMessage) => {
                setMessageMap(prev => {
                  const messages = [...(prev[activeKey] ?? [])];
                  const assistantIndex = messages.findIndex(item => item.id === pendingId);
                  messages.splice(assistantIndex >= 0 ? assistantIndex : messages.length, 0, message);
                  return { ...prev, [activeKey]: messages };
                });
              };

              const upsertBeforeAssistant = (
                messageId: string,
                buildMessage: (existing?: ChatMessage) => ChatMessage,
              ) => {
                setMessageMap(prev => {
                  const messages = [...(prev[activeKey] ?? [])];
                  const existingIndex = messages.findIndex(item => item.id === messageId);
                  if (existingIndex >= 0) {
                    messages[existingIndex] = buildMessage(messages[existingIndex]);
                    return { ...prev, [activeKey]: messages };
                  }
                  const assistantIndex = messages.findIndex(item => item.id === pendingId);
                  messages.splice(assistantIndex >= 0 ? assistantIndex : messages.length, 0, buildMessage());
                  return { ...prev, [activeKey]: messages };
                });
              };

              if (chunk.type === 'codex_session_started') {
                const nextKey = typeof chunk.session_key === 'string' && chunk.session_key ? chunk.session_key : undefined;
                const nextThreadId = typeof chunk.thread_id === 'string' && chunk.thread_id ? chunk.thread_id : undefined;
                if (nextThreadId) {
                  activeThreadId = nextThreadId;
                }
                if (nextKey) {
                  const previousKey = activeKey;
                  if (nextKey !== previousKey) {
                    renameSessionKey(previousKey, nextKey);
                    chatStreamStore.setSending(previousKey, false);
                    chatStreamStore.setSending(nextKey, true);
                    inFlightKeysRef.current.delete(previousKey);
                    inFlightKeysRef.current.add(nextKey);
                    activeKey = nextKey;
                  }
                  setSessions(current => current.map(item => (
                    item.sessionKey === nextKey
                      ? {
                          ...item,
                          historySessionId: nextThreadId || item.historySessionId,
                          frontendOnly: false,
                          codexHistory: false,
                          workspacePath: chunk.cwd || item.workspacePath,
                        }
                      : item
                  )));
                  setSessionHistoryItems(current => sortSessionsNewestFirst(current.map(item => (
                    item.sessionKey === nextKey
                      ? {
                          ...item,
                          historySessionId: nextThreadId || item.historySessionId,
                          frontendOnly: false,
                          codexHistory: false,
                          workspacePath: chunk.cwd || item.workspacePath,
                        }
                      : item
                  ))));
                  setCodexGoalBySessionKey(current => {
                    if (previousKey === nextKey || !(previousKey in current)) return current;
                    const next = { ...current, [nextKey]: current[previousKey] };
                    delete next[previousKey];
                    return next;
                  });
                }
              } else if (chunk.type === 'delta' && typeof chunk.text === 'string') {
                setMessageMap(prev => ({
                  ...prev,
                  [activeKey]: (prev[activeKey] ?? []).map(message => (
                    message.id === pendingId
                      ? { ...message, content: `${message.content || ''}${chunk.text}`, pending: false }
                      : message
                  )),
                }));
              } else if (chunk.type === 'final') {
                setMessageMap(prev => ({
                  ...prev,
                  [activeKey]: (prev[activeKey] ?? []).map(message => (
                    message.id === pendingId
                      ? { ...message, content: chunk.text || message.content || '[No response]', pending: false }
                      : message
                  )),
                }));
              } else if (chunk.type === 'tool_start') {
                appendBeforeAssistant({
                  id: `tool-${chunk.tool_id || uuidv4()}`,
                  role: 'tool_call',
                  content: '',
                  timestamp: new Date(),
                  tool_id: chunk.tool_id,
                  tool_name: chunk.tool_name,
                  args: chunk.args,
                  result_pending: true,
                  tool_category: chunk.tool_category,
                  tool_action: chunk.tool_action,
                  timeline_kind: chunk.timeline_kind,
                  risk_level: chunk.risk_level,
                });
              } else if (chunk.type === 'tool_result') {
                setMessageMap(prev => ({
                  ...prev,
                  [activeKey]: (prev[activeKey] ?? []).map(message => (
                    message.role === 'tool_call' && chunk.tool_id && message.tool_id === chunk.tool_id
                      ? {
                          ...message,
                          result: chunk.result,
                          is_error: chunk.is_error,
                          result_pending: false,
                          tool_category: chunk.tool_category || message.tool_category,
                          tool_action: chunk.tool_action || message.tool_action,
                          timeline_kind: chunk.timeline_kind || message.timeline_kind,
                          risk_level: chunk.risk_level || message.risk_level,
                        }
                      : message
                  )),
                }));
              } else if (chunk.type === 'codex_user_input_request') {
                sawCodexNativeUserInputRequest = true;
                const requestId = String(chunk.request_id || uuidv4());
                appendBeforeAssistant({
                  id: `codex-question-${requestId}`,
                  role: 'codex_question',
                  content: '',
                  timestamp: new Date(),
                  codex_request_id: requestId,
                  codex_question_kind: 'native_request',
                  codex_thread_id: chunk.thread_id,
                  codex_turn_id: chunk.turn_id,
                  codex_item_id: chunk.item_id,
                  codex_questions: chunk.questions ?? [],
                  codex_response_status: 'pending',
                });
              } else if (chunk.type === 'codex_plan_update') {
                sawCodexPlanUpdate = true;
                latestCodexPlanTurnId = chunk.turn_id || latestCodexPlanTurnId;
                latestCodexPlanItemId = chunk.item_id || latestCodexPlanItemId;
                const planId = `codex-plan-${chunk.turn_id || chunk.item_id || pendingId}`;
                upsertBeforeAssistant(planId, existing => {
                  const existingText = existing?.codex_plan_text || existing?.content || '';
                  const nextText = typeof chunk.delta === 'string' && chunk.delta
                    ? `${existingText}${chunk.delta}`
                    : typeof chunk.text === 'string'
                      ? chunk.text
                      : existingText;
                  return {
                    id: planId,
                    role: 'codex_plan',
                    content: nextText,
                    timestamp: existing?.timestamp ?? new Date(),
                    codex_thread_id: chunk.thread_id || existing?.codex_thread_id,
                    codex_turn_id: chunk.turn_id || existing?.codex_turn_id,
                    codex_item_id: chunk.item_id || existing?.codex_item_id,
                    codex_plan_explanation: chunk.explanation ?? existing?.codex_plan_explanation ?? null,
                    codex_plan_steps: Array.isArray(chunk.steps) && chunk.steps.length > 0
                      ? chunk.steps
                      : existing?.codex_plan_steps,
                    codex_plan_text: nextText,
                  };
                });
              } else if (chunk.type === 'codex_goal_update') {
                const goal = {
                  ...(chunk.goal ?? {}),
                  thread_id: chunk.goal?.thread_id || chunk.thread_id || activeThreadId,
                };
                setCodexGoalBySessionKey(current => ({ ...current, [activeKey]: goal }));
                const goalId = `codex-goal-${goal.thread_id || activeThreadId || pendingId}`;
                upsertBeforeAssistant(goalId, existing => ({
                  id: goalId,
                  role: 'codex_goal',
                  content: goal.objective || existing?.content || '',
                  timestamp: existing?.timestamp ?? new Date(),
                  codex_thread_id: goal.thread_id || chunk.thread_id || existing?.codex_thread_id,
                  codex_turn_id: chunk.turn_id || existing?.codex_turn_id,
                  codex_goal: goal,
                }));
              } else if (chunk.type === 'codex_goal_cleared') {
                const clearedThreadId = chunk.thread_id || activeThreadId || undefined;
                setCodexGoalBySessionKey(current => ({ ...current, [activeKey]: null }));
                setMessageMap(prev => ({
                  ...prev,
                  [activeKey]: (prev[activeKey] ?? []).map(message => (
                    message.role === 'codex_goal'
                      && (!clearedThreadId || message.codex_goal?.thread_id === clearedThreadId || message.codex_thread_id === clearedThreadId)
                      ? { ...message, codex_goal: { ...(message.codex_goal ?? {}), thread_id: clearedThreadId, status: 'cleared' } }
                      : message
                  )),
                }));
              } else if (chunk.type === 'codex_request_resolved') {
                const requestId = chunk.request_id ? String(chunk.request_id) : '';
                if (requestId) {
                  setMessageMap(prev => ({
                    ...prev,
                    [activeKey]: (prev[activeKey] ?? []).map(message => (
                      message.role === 'codex_question' && message.codex_request_id === requestId
                        ? { ...message, codex_response_status: 'resolved' }
                        : message
                    )),
                  }));
                }
              } else if (chunk.type === 'status' && chunk.text) {
                appendBeforeAssistant({
                  id: `trace-${uuidv4()}`,
                  role: 'trace',
                  content: chunk.text,
                  timestamp: new Date(),
                  trace_type: 'status',
                  trace_phase: 'codex',
                });
              } else if (chunk.type === 'error') {
                setMessageMap(prev => ({
                  ...prev,
                  [activeKey]: (prev[activeKey] ?? []).map(message => (
                    message.id === pendingId
                      ? { ...message, role: 'error' as const, content: chunk.text || 'Codex error', pending: false }
                      : message
                  )),
                }));
              }
            } catch {
              // Ignore malformed SSE data.
            }
          }
        }

        if (effectiveCodexPlanMode && sawCodexPlanUpdate && !sawCodexNativeUserInputRequest) {
          const confirmationId = `codex-plan-confirm-${latestCodexPlanTurnId || latestCodexPlanItemId || pendingId}`;
          const confirmationMessage: ChatMessage = {
            id: confirmationId,
            role: 'codex_question',
            content: '',
            timestamp: new Date(),
            codex_request_id: `local:${confirmationId}`,
            codex_question_kind: 'plan_confirmation',
            codex_thread_id: activeThreadId || undefined,
            codex_turn_id: latestCodexPlanTurnId || undefined,
            codex_item_id: latestCodexPlanItemId || undefined,
            codex_questions: [codexPlanConfirmationQuestion(locale)],
            codex_response_status: 'pending',
          };
          setMessageMap(prev => {
            const messages = [...(prev[activeKey] ?? [])];
            if (messages.some(message => message.id === confirmationId)) return prev;
            const assistantIndex = messages.findIndex(message => message.id === pendingId);
            messages.splice(assistantIndex >= 0 ? assistantIndex : messages.length, 0, confirmationMessage);
            return { ...prev, [activeKey]: messages };
          });
        }

        setMessageMap(prev => ({
          ...prev,
          [activeKey]: (prev[activeKey] ?? []).map(message => (
            message.id === pendingId && message.pending
              ? { ...message, content: message.content || '[No response]', pending: false }
              : message
          )),
        }));
      } catch (err: any) {
        setMessageMap(prev => ({
          ...prev,
          [activeKey]: (prev[activeKey] ?? prev[originalKey] ?? []).map(message => (
            message.id === pendingId
              ? { ...message, role: 'error' as const, content: `[Error] ${err.message}`, pending: false }
              : message
          )),
        }));
      } finally {
        chatStreamStore.setSending(originalKey, false);
        chatStreamStore.setSending(activeKey, false);
        inFlightKeysRef.current.delete(originalKey);
        inFlightKeysRef.current.delete(activeKey);
        void refreshCodexRateLimits();
      }
      return;
    }

    if (!isRuntimeBackedSession(session)) {
      return;
    }

    const sessionBudgetPlatform = session.platform as RuntimeBudgetPlatform;
    const sessionBudgetStatus = runtimeBudgetStatuses[sessionBudgetPlatform] ?? defaultRuntimeBudgetStatus(sessionBudgetPlatform);
    if (sessionBudgetStatus.overLimit) {
      const sessionBudgetAgentName = agentDefinitions.find(agent => agent.platform === sessionBudgetPlatform)?.name ?? copy.sidebar.runtimeFallback;
      showToast(rgText(copy.toasts.budgetReachedWithReset, {
        agent: sessionBudgetAgentName,
        time: formatBudgetRefreshTime(runtimeBudgetRemainingMs(sessionBudgetStatus, nowTs), copy),
      }));
      return;
    }

    let key = originalKey;
    const streamPlatform = session.platform;
    const titlePlatform = session.platform;
    const titleInstanceId = session.instanceId;
    const shouldGenerateTitle = Boolean(session.autoTitlePending);
    inFlightKeysRef.current.add(key);
    chatStreamStore.setSending(key, true);
    setDraftBySessionKey(current => ({ ...current, [key]: '' }));
    if (shouldGenerateTitle) {
      markSessionTitleRequested(key);
      void chatAPI.sessionTitle({
        session_key: originalKey,
        message: text,
        platform: titlePlatform,
        instance_id: titleInstanceId,
      })
        .then(({ data }) => {
          applySessionTitle(key, data.title, text);
        })
        .catch(() => {
          const fallbackTitle = compactRuntimeRequestTitle(text) || titleFromUserMessage(text, text) || session.agent;
          applySessionTitle(key, fallbackTitle, text);
        });
    }

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    const pendingId = uuidv4();
    const pendingMsg: ChatMessage = {
      id: pendingId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      pending: true,
    };
    const activityIso = userMsg.timestamp.toISOString();
    setSessions(current => current.map(session => (
      session.sessionKey === key ? { ...session, lastActivityAt: activityIso } : session
    )));
    setSessionHistoryItems(current => sortSessionsNewestFirst(current.map(session => (
      session.sessionKey === key ? { ...session, lastActivityAt: activityIso } : session
    ))));
    setMessageMap(prev => ({ ...prev, [key]: [...(prev[key] ?? []), userMsg, pendingMsg] }));

    try {
      const response = await fetch('/api/chat/send-message-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_key: key, message: text, client_context: 'runtime_guard' }),
      });

      if (!response.ok || !response.body) {
        if (response.status === 402) {
          void refreshRuntimeBudgets();
        }
        throw new Error(await responseErrorMessage(response, copy));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;

          try {
            const chunk = JSON.parse(raw) as {
              type: string;
              text?: string;
              session_key?: string;
              tool_id?: string;
              tool_name?: string;
              args?: any;
              result?: any;
              is_error?: boolean;
              reason?: string;
              phase?: string;
              step?: number;
              summary?: string;
              tool_category?: string;
              tool_action?: string;
              timeline_kind?: string;
              risk_level?: string;
            };

            const appendBeforeAssistant = (message: ChatMessage) => {
              setMessageMap(prev => {
                const messages = [...(prev[key] ?? [])];
                const assistantIndex = messages.findIndex(item => item.id === pendingId);
                messages.splice(assistantIndex >= 0 ? assistantIndex : messages.length, 0, message);
                return { ...prev, [key]: messages };
              });
            };

            if (chunk.type === 'session_relinked' && chunk.session_key && chunk.session_key !== key) {
              const previousKey = key;
              key = chunk.session_key;
              inFlightKeysRef.current.delete(previousKey);
              inFlightKeysRef.current.add(key);
              renameSessionKey(previousKey, key);
            } else if (chunk.type === 'delta' && chunk.text) {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => (
                  message.id === pendingId
                    ? { ...message, content: chunk.text!, pending: false }
                    : message
                )),
              }));
            } else if (chunk.type === 'tool_start') {
              appendBeforeAssistant({
                id: `tool-${chunk.tool_id || uuidv4()}`,
                role: 'tool_call',
                content: '',
                timestamp: new Date(),
                tool_id: chunk.tool_id,
                tool_name: chunk.tool_name,
                args: chunk.args,
                result_pending: true,
                tool_category: chunk.tool_category,
                tool_action: chunk.tool_action,
                timeline_kind: chunk.timeline_kind,
                risk_level: chunk.risk_level,
              });
            } else if (chunk.type === 'tool_result') {
              setMessageMap(prev => {
                const messages = [...(prev[key] ?? [])];
                let updated = false;
                if (chunk.tool_id) {
                  for (let i = messages.length - 1; i >= 0; i -= 1) {
                    const message = messages[i];
                    if (message.role === 'tool_call' && message.tool_id === chunk.tool_id) {
                      messages[i] = {
                        ...message,
                        result: chunk.result,
                        is_error: chunk.is_error,
                        result_pending: false,
                        tool_category: chunk.tool_category || message.tool_category,
                        tool_action: chunk.tool_action || message.tool_action,
                        timeline_kind: chunk.timeline_kind || message.timeline_kind,
                        risk_level: chunk.risk_level || message.risk_level,
                      };
                      updated = true;
                      break;
                    }
                  }
                }
                if (!updated && chunk.tool_name) {
                  for (let i = messages.length - 1; i >= 0; i -= 1) {
                    const message = messages[i];
                    if (message.role === 'tool_call' && message.tool_name === chunk.tool_name && message.result_pending) {
                      messages[i] = {
                        ...message,
                        result: chunk.result,
                        is_error: chunk.is_error,
                        result_pending: false,
                        tool_category: chunk.tool_category || message.tool_category,
                        tool_action: chunk.tool_action || message.tool_action,
                        timeline_kind: chunk.timeline_kind || message.timeline_kind,
                        risk_level: chunk.risk_level || message.risk_level,
                      };
                      break;
                    }
                  }
                }
                return { ...prev, [key]: messages };
              });
            } else if (chunk.type === 'status') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => (
                  message.id === pendingId && message.pending && !message.content
                    ? { ...message, content: chunk.text || message.content, pending: false }
                    : message
                )),
              }));
            } else if (chunk.type === 'approval_pending') {
              refreshApprovalItemsSoon();
            } else if (chunk.type === 'approval_resolved') {
              refreshApprovalItemsSoon();
            } else if (traceTypes.has(chunk.type)) {
              if (shouldDisplayTraceMessage(streamPlatform, {
                type: chunk.type,
                text: chunk.text,
                summary: chunk.summary,
                phase: chunk.phase,
              })) {
                appendBeforeAssistant({
                  id: `trace-${uuidv4()}`,
                  role: 'trace',
                  content: chunk.text || '',
                  timestamp: new Date(),
                  trace_type: chunk.type,
                  trace_phase: chunk.phase || '',
                  trace_step: typeof chunk.step === 'number' ? chunk.step : undefined,
                  trace_summary: chunk.summary || '',
                });
              }
            } else if (chunk.type === 'tool_blocked') {
              const toolName = chunk.tool_name || 'tool';
              const reason = chunk.reason || '';
              const blockedText = chunk.text || `安全审核拦截\n\n工具 ${toolName} 的调用已被安全系统拒绝。${reason ? `\n原因：${reason}` : ''}`;
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => {
                  if (message.id === pendingId) {
                    return { ...message, role: 'error' as const, content: blockedText, pending: false };
                  }
                  if (message.role === 'tool_call' && message.result_pending && chunk.tool_name && message.tool_name === chunk.tool_name) {
                    return {
                      ...message,
                      result: reason || blockedText,
                      is_error: true,
                      result_pending: false,
                      tool_category: chunk.tool_category || message.tool_category,
                      tool_action: chunk.tool_action || message.tool_action,
                      timeline_kind: chunk.timeline_kind || 'guard_blocked',
                      risk_level: chunk.risk_level || 'high',
                    };
                  }
                  return message;
                }),
              }));
            } else if (chunk.type === 'final') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => (
                  message.id === pendingId
                    ? { ...message, content: chunk.text || message.content || '[No response]', pending: false }
                    : message
                )),
              }));
            } else if (chunk.type === 'error' || chunk.type === 'timeout' || chunk.type === 'aborted') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => (
                  message.id === pendingId
                    ? {
                        ...message,
                        role: chunk.type === 'error' ? 'error' as const : 'assistant' as const,
                        content: chunk.text || `[${chunk.type}]`,
                        pending: false,
                      }
                    : message
                )),
              }));
            }
          } catch {
            // Ignore malformed SSE data.
          }
        }
      }

      setMessageMap(prev => ({
        ...prev,
        [key]: (prev[key] ?? []).map(message => (
          message.id === pendingId && message.pending
            ? { ...message, content: message.content || '[No response]', pending: false }
            : message
        )),
      }));
      void refreshRuntimeBudgets();
    } catch (err: any) {
      setMessageMap(prev => ({
        ...prev,
        [key]: (prev[key] ?? []).map(message => (
          message.id === pendingId
            ? { ...message, role: 'error' as const, content: `[Error] ${err.message}`, pending: false }
            : message
        )),
      }));
    } finally {
      chatStreamStore.setSending(key, false);
      inFlightKeysRef.current.delete(key);
    }
  }

  const handleSend = async () => {
    if (!activeSession) return;
    await sendMessageForSession(activeSession, activeDraft);
  };

  const handleCodexInterrupt = async () => {
    if (!activeSession || isRuntimeBackedSession(activeSession)) return;
    const key = activeSession.sessionKey;
    try {
      await fetch(`/api/system/codex/conversations/${encodeURIComponent(key)}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: activeSession.historySessionId || key.replace(/^codex:/, ''),
        }),
      });
    } catch {
      // The stream will surface a terminal state if the interrupt cannot be delivered.
    }
    setMessageMap(prev => ({
      ...prev,
      [key]: (prev[key] ?? []).map(message => (
        message.pending
          ? { ...message, content: copy.codexComposer.interrupted, pending: false }
          : message
      )),
    }));
    chatStreamStore.setSending(key, false);
    inFlightKeysRef.current.delete(key);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
    event.preventDefault();
    handleSend();
  };

  const toggleToolExpanded = (id: string) => {
    setExpandedToolIds(current => ({ ...current, [id]: !current[id] }));
  };

  const leftScaleStyle = {
    width: layoutFit.leftWidth,
    height: layoutFit.height,
    '--rg-scale': layoutFit.scale,
  } as CSSProperties;
  const mainFluidStyle = {
    left: layoutFit.leftWidth,
    width: layoutFit.mainWidth,
    height: layoutFit.height,
    '--rg-scale': layoutFit.scale,
    '--rg-main-design-width': `${layoutFit.mainDesignWidth}px`,
  } as CSSProperties;
  const rightScaleStyle = {
    left: layoutFit.leftWidth + layoutFit.mainWidth,
    width: layoutFit.rightWidth + RUNTIME_GUARD_RIGHT_EDGE_GUARD,
    height: layoutFit.height,
    '--rg-scale': layoutFit.scale,
  } as CSSProperties;
  const topShelfStyle = {
    left: layoutFit.leftWidth,
    width: layoutFit.mainWidth + layoutFit.rightWidth,
    height: RUNTIME_GUARD_TOP_GAP * layoutFit.scale,
  } as CSSProperties;
  const runtimeGuardPageStyle = {
    '--rg-scale': layoutFit.scale,
    '--rg-top-gap': `${RUNTIME_GUARD_TOP_GAP}px`,
    '--rg-top-gap-px': `${RUNTIME_GUARD_TOP_GAP * layoutFit.scale}px`,
  } as CSSProperties;
  const xsafeclawVersionLabel = formatVersionLabel(xsafeclawVersion);

  return (
    <div className="runtime-guard-page" style={runtimeGuardPageStyle}>
      {placeholder && <div className="rg-toast">{placeholder}</div>}
      <div className="rg-runtime-top-shelf" style={topShelfStyle} aria-hidden="true" />
      <div className="rg-top-utilities" aria-label={copy.sidebar.topUtilitiesAria}>
        <button
          className="rg-top-utility"
          onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
          type="button"
        >
          <Globe2 />
          <span>{copy.sidebar.languageToggle}</span>
        </button>
        <button className="rg-top-utility rg-top-town" onClick={() => navigate('/agent-town')} type="button">
          <Bot />
          <span>{copy.sidebar.agentTown}</span>
        </button>
        <button className="rg-top-utility rg-top-user" type="button" aria-disabled="true">
          <span>Free</span>
        </button>
      </div>
      {newTaskModalOpen && (
        <NewTaskModal
          request={newTaskRequest}
          onRequestChange={setNewTaskRequest}
          onCreate={() => void createNewTask()}
          onClose={closeNewTaskModal}
          creating={newTaskCreating}
        />
      )}
      {budgetModalOpen && (
        <div className="rg-modal-backdrop" role="presentation">
          <div className="rg-budget-modal" role="dialog" aria-modal="true" aria-labelledby="rg-budget-modal-title">
            <button className="rg-modal-close" type="button" title={copy.budgetModal.closeTitle} onClick={() => setBudgetModalOpen(false)}>
              <X />
            </button>
            <h2 id="rg-budget-modal-title">{copy.budgetModal.title}</h2>
            <label className="rg-budget-runtime-picker">
              <span>{copy.budgetModal.runtime}</span>
              <select
                aria-label={copy.budgetModal.runtimeAria}
                onChange={(event) => setSelectedBudgetPlatform(event.target.value as RuntimeBudgetPlatform)}
                value={selectedBudgetPlatform}
              >
                {budgetPlatformOptions.map(agent => (
                  <option key={agent.platform} value={agent.platform}>{agent.name}</option>
                ))}
              </select>
            </label>
            <div className="rg-budget-sentence">
              <input
                aria-label={copy.budgetModal.maximumUsageAria}
                inputMode="decimal"
                min="0"
                onChange={(event) => {
                  const nextValue = sanitizeBudgetAmountInput(event.target.value);
                  if (nextValue !== null) setBudgetAmountInput(nextValue);
                }}
                pattern="^\d*(?:\.\d{0,2})?$"
                placeholder="__"
                step="0.01"
                type="text"
                value={budgetAmountInput}
              />
              <span>{copy.budgetModal.usd}</span>
              <input
                aria-label={copy.budgetModal.refreshIntervalAria}
                inputMode="numeric"
                min="1"
                onChange={(event) => setBudgetPeriodInput(event.target.value)}
                placeholder="__"
                step="1"
                type="number"
                value={budgetPeriodInput}
              />
              <select
                aria-label={copy.budgetModal.intervalUnitAria}
                onChange={(event) => setBudgetPeriodUnit(event.target.value as BudgetPeriodUnit)}
                value={budgetPeriodUnit}
              >
                <option value="hour">{copy.budgetModal.unitHour}</option>
                <option value="day">{copy.budgetModal.unitDay}</option>
              </select>
            </div>
            <div className="rg-budget-modal-preview">
              {rgText(copy.budgetModal.currentCost, {
                agent: selectedBudgetAgentName,
                cost: formatMoney(budgetStatus.currentCost),
              })}
            </div>
            <div className="rg-budget-modal-actions">
              <button type="button" className="rg-budget-clear" disabled={budgetSaving} onClick={() => void clearBudgetLimit()}>{copy.budgetModal.clear}</button>
              <button
                type="button"
                className="rg-budget-save"
                disabled={
                  budgetSaving
                  ||
                  !Number.isFinite(Number(budgetAmountInput))
                  || Number(budgetAmountInput) <= 0
                  || !Number.isFinite(Number(budgetPeriodInput))
                  || Number(budgetPeriodInput) <= 0
                }
                onClick={() => void saveBudgetLimit()}
              >
                {budgetSaving ? copy.budgetModal.saving : copy.budgetModal.save}
              </button>
            </div>
          </div>
        </div>
      )}
      {activeRuntimeGuardModal === 'tools' && (
        <ToolsViewAllModal
          permissions={toolPermissions}
          onPermissionChange={updateToolPermission}
          onClose={() => setActiveRuntimeGuardModal(null)}
        />
      )}
      {activeRuntimeGuardModal === 'sessions' && (
        <SessionHistoryViewAllModal
          sessions={visibleSessionHistoryItems}
          loading={sessionHistoryLoading}
          activeSessionId={activeSessionId}
          messageMap={messageMap}
          middleApprovalCardsBySession={middleApprovalCardsBySession}
          onSelectSession={openHistorySession}
          onDeleteSession={deleteHistorySession}
          onClose={() => setActiveRuntimeGuardModal(null)}
        />
      )}
      {activeRuntimeGuardModal === 'approvals' && (
        <ApprovalViewAllModal
          items={unresolvedApprovalItems}
          loading={approvalLoading}
          resolvingApprovalId={resolvingApprovalId}
          onDecision={resolveApproval}
          onClose={() => setActiveRuntimeGuardModal(null)}
        />
      )}
      {activeRuntimeGuardModal === 'blocked' && (
        <BlockedViewAllModal
          items={allBlockedItems}
          loading={blockedLoading}
          range={blockedModalRange}
          nowMs={nowTs}
          onRangeChange={setBlockedModalRange}
          onClose={() => setActiveRuntimeGuardModal(null)}
        />
      )}
      <div className="rg-left-scale" style={leftScaleStyle}>
      <aside className="rg-sidebar">
        <div className="rg-brand">
          <span className="rg-brand-name">XSafeClaw</span>
          <span className="rg-pro">{xsafeclawVersionLabel}</span>
          <span className="rg-subtitle">{copy.brandSubtitle}</span>
        </div>

        <button className="rg-new-task" onClick={openNewTaskModal} type="button">
          <span>+</span>
          <span>{copy.sidebar.newTask}</span>
        </button>

        <section
          className="rg-agents"
          style={{
            top: RUNTIME_GUARD_SIDEBAR_LAYOUT.agentsTop,
            height: RUNTIME_GUARD_SIDEBAR_LAYOUT.agentsHeight,
          }}
        >
          <div className="rg-section-title">
            <span>{copy.sidebar.agents}</span>
            <button type="button" title={copy.sidebar.setupTitle} onClick={() => navigate('/setup')}>+</button>
          </div>
          {agents.map((agent, index) => (
            <div
              className={`rg-agent-row ${selectedAgent === agent.name ? 'is-selected' : ''} ${!agent.installed ? 'is-uninstalled' : ''}`}
              key={agent.name}
              aria-disabled={!agent.installed}
              title={agent.installed
                ? rgText(copy.sidebar.runtimeConfigureTitle, { agent: agent.name })
                : rgText(copy.sidebar.notInstalledTitle, { agent: agent.name })}
              onClick={() => {
                if (!agent.runtimeBacked) {
                  setSelectedAgent(agent.name);
                  return;
                }
                if (!agent.installed) {
                  showInstallHint(agent.name);
                  return;
                }
                setSelectedAgent(agent.name);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!agent.installed) {
                  showInstallHint(agent.name);
                  return;
                }
                if (!agent.runtimeBacked) {
                  navigate(configureRouteForAgent(agent.name));
                  return;
                }
                navigate(configureRouteForAgent(agent.name));
              }}
              style={{ top: 18 + index * 36 }}
            >
              <AgentIconBadge agent={agent.name} />
              <span className="rg-agent-copy">
                <span className="rg-agent-name">{agent.name}</span>
                <span className="rg-agent-state">
                  <StatusDot tone={agent.status === 'Running' ? 'success' : agent.installed ? 'muted' : 'warning'} />
                  {agentStatusDisplay(agent.status, copy)}
                </span>
              </span>
              <button
                className="rg-open-agent"
                disabled={creatingAgent === agent.name}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!agent.installed) {
                    showInstallHint(agent.name);
                    navigate('/setup');
                    return;
                  }
                  openSession(agent.name, agent.installed);
                }}
                type="button"
              >
                {agent.installed ? creatingAgent === agent.name ? '...' : copy.sidebar.open : copy.sidebar.setup} <ChevronRight />
              </button>
            </div>
          ))}
        </section>

        <section className="rg-tools" style={{ top: RUNTIME_GUARD_SIDEBAR_LAYOUT.toolsTop }}>
          <div className="rg-tools-title">
            <span>{copy.sidebar.toolPermission}</span>
            <button type="button" onClick={() => setActiveRuntimeGuardModal('tools')}>{copy.sidebar.set}</button>
          </div>
          {sidebarTools.map((tool, index) => {
            const ToolIcon = tool.icon;
            return (
              <div className="rg-tool-row" data-tool={tool.id} key={tool.name} style={{ top: 20 + index * 23 }}>
                <ToolIcon />
                <span>{tool.name}</span>
                <span className={`rg-tool-${tool.tone}`}>{tool.status}</span>
              </div>
            );
          })}
        </section>

        <section className="rg-safety-links" style={{ top: RUNTIME_GUARD_SIDEBAR_LAYOUT.safetyTop }}>
          <div className="rg-section-title">
            <span>{copy.sidebar.safetyTools}</span>
          </div>
          <button className="rg-safety-row rg-safety-row-asset" onClick={() => navigate('/assets')} style={{ top: 22 }} type="button">
            <Shield />
            <span>{copy.sidebar.assetShield}</span>
            <ChevronRight />
          </button>
          <button className="rg-safety-row rg-safety-row-risk" onClick={() => navigate('/risk-test')} style={{ top: 55 }} type="button">
            <AlertTriangle />
            <span>{copy.sidebar.riskTest}</span>
            <ChevronRight />
          </button>
        </section>

        <div
          className={`rg-budget ${showCodexQuotaBudget ? 'rg-budget-codex' : ''} ${!showCodexQuotaBudget && selectedBudgetOverLimit ? 'is-over-limit' : ''}`}
          style={{ top: RUNTIME_GUARD_SIDEBAR_LAYOUT.budgetTop }}
        >
          {showCodexQuotaBudget ? (
            <>
              <div className="rg-budget-title">{copy.sidebar.budget}</div>
              <button className="rg-budget-settings" onClick={() => { void refreshCodexRateLimits(); }} type="button">
                {copy.sidebar.codexQuotaAction}
              </button>
              <div className="rg-codex-quota-rows">
                <div className="rg-codex-quota-row is-centered-columns">
                  <strong className="rg-codex-quota-percent">{codexFiveHourRemainingPercent}</strong>
                  <span className="rg-codex-quota-window">{copy.sidebar.codexQuotaFiveHour}</span>
                  <span className="rg-codex-quota-refresh">{codexFiveHourResetText}</span>
                </div>
                <div className="rg-codex-quota-row is-centered-columns">
                  <strong className="rg-codex-quota-percent">{codexWeekRemainingPercent}</strong>
                  <span className="rg-codex-quota-window">{copy.sidebar.codexQuotaWeek}</span>
                  <span className="rg-codex-quota-refresh">{codexWeekResetText}</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rg-budget-title">{copy.sidebar.budget}</div>
              <button className="rg-budget-settings" type="button" onClick={openBudgetModal}>{copy.sidebar.set}</button>
              <div className="rg-budget-amount-line">
                <strong className="rg-budget-used">{budgetDisplayCostText}</strong>
                {budgetConfigured && (
                  <>
                    <span className="rg-budget-slash">/</span>
                    <span className="rg-budget-limit">{budgetLimitText}</span>
                  </>
                )}
              </div>
              <div className="rg-budget-bar"><span style={{ width: `${budgetBarPercent}%` }} /></div>
              <div className="rg-budget-percent">{budgetConfigured ? `${Math.round(budgetPercent)}%` : ''}</div>
              <div className="rg-budget-reset">
                {selectedBudgetOverLimit ? rgText(copy.sidebar.budgetReached, { agent: selectedBudgetAgentName }) : budgetResetText}
              </div>
            </>
          )}
        </div>

      </aside>
      </div>

      <div className="rg-main-fluid" style={mainFluidStyle}>
      <main className="rg-main">
        <div className="rg-tabs">
          <div className="rg-session-tabs">
            {sessions.map(session => (
                <button
                  className={`rg-chat-tab ${session.sessionKey === activeSessionId ? 'is-active' : ''}`}
                  key={session.sessionKey}
                  onClick={() => {
                    setActiveSessionId(session.sessionKey);
                    setSelectedAgent(session.agent);
                  }}
                  type="button"
                >
                  <span className="rg-chat-tab-agent">
                    <AgentIconBadge agent={session.agent} size="compact" />
                  </span>
                  <span className="rg-chat-tab-title">{session.agent}</span>
                  <span
                    className="rg-chat-tab-close"
                    role="button"
                    tabIndex={0}
                    title={copy.main.closeSessionTitle}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeSession(session.sessionKey);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeSession(session.sessionKey);
                      }
                    }}
                  >
                    <X />
                  </span>
                </button>
            ))}
            <button className="rg-tab-add" type="button" onClick={openSelectedAgentSession} disabled={Boolean(creatingAgent)}>+</button>
          </div>
        </div>

        <section className="rg-task-title">
          <h1>{activeSession ? formatRuntimeGuardSessionTitle(activeSession) : copy.main.noSessionTitle}</h1>
          <p className="rg-session-meta">
            {activeSession
              ? formatSessionMeta(activeSession, availableInstances, copy, nowTs)
              : copy.main.noSessionHint}
          </p>
        </section>

        <section className="rg-run-buttons">
          <div className="rg-auto-approval">
            <button
              aria-expanded={autoApprovalOpen}
              aria-haspopup="listbox"
              className="rg-auto-approval-trigger"
              disabled={guardModeSyncing}
              onClick={() => setAutoApprovalOpen(open => !open)}
              type="button"
            >
              <Lock /> {copy.guardStatus.guard}: {guardModeSyncing ? copy.guardStatus.updating : guardMode === 'On' ? copy.guardStatus.on : copy.guardStatus.off} <ChevronDown />
            </button>
            {autoApprovalOpen && (
              <div className="rg-auto-approval-menu" role="listbox" aria-label={copy.guardStatus.modeAria}>
                {(['Off', 'On'] as const).map(mode => (
                  <button
                    className={mode === guardMode ? 'is-selected' : ''}
                    disabled={guardModeSyncing}
                    key={mode}
                    onClick={() => void applyGuardMode(mode)}
                    role="option"
                    aria-selected={mode === guardMode}
                    type="button"
                  >
                    <span>{mode === 'On' ? copy.guardStatus.on : copy.guardStatus.off}</span>
                    {mode === guardMode && <Check />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={`rg-task-panel ${activeSessionIsCodex ? 'has-codex-composer' : ''}`}>
          {!activeSession ? (
            <div className="rg-empty-task">
              <strong>{copy.main.noSessionTitle}</strong>
              <span>{copy.main.noSessionHintShort}</span>
            </div>
          ) : (
            <>
              <div className="rg-task-scroll" ref={taskScrollRef}>
                {loadingHistory === activeSession.sessionKey ? (
                  <div className="rg-loading-history"><Loader2 className="is-spinning" /> {copy.main.loadingHistory}</div>
                ) : activeMessages.length === 0 && activeApprovalCards.length === 0 ? (
                  <div className="rg-session-empty">
                    <Bot />
                    <strong>{rgText(copy.main.sessionReady, { agent: activeSession.agent })}</strong>
                    <span>{copy.main.sessionReadyHint}</span>
                  </div>
                ) : (
                  activeTimelineRows.map(row => (
                    row.type === 'approval' ? (
                      <InlineApprovalCard
                        card={row.card}
                        key={`approval-${row.card.id}`}
                        resolving={resolvingApprovalId === row.card.id}
                        onDecision={resolveApproval}
                      />
                    ) : (
                      <TimelineMessage
                        key={`message-${row.message.id}`}
                        msg={row.message}
                        expanded={Boolean(expandedToolIds[row.message.id])}
                        onToggle={() => toggleToolExpanded(row.message.id)}
                        onCodexQuestionSubmit={submitCodexQuestionResponse}
                        onCodexGoalClear={clearCodexGoal}
                      />
                    )
                  ))
                )}
              </div>

              {activeSessionIsCodex ? (
                <div className={`rg-codex-composer ${budgetOverLimit ? 'is-budget-blocked' : ''}`} ref={codexComposerRef}>
                  <textarea
                    ref={textareaRef}
                    aria-label={rgText(copy.main.askAria, { agent: activeAgent })}
                    disabled={budgetOverLimit}
                    onChange={(event) => updateActiveDraft(event.target.value)}
                    onCompositionEnd={() => setIsComposing(false)}
                    onCompositionStart={() => setIsComposing(true)}
                    onKeyDown={handleInputKeyDown}
                    placeholder={budgetOverLimit
                      ? rgText(copy.sidebar.budgetReached, { agent: activeBudgetAgentName })
                      : rgText(copy.main.askPlaceholder, { agent: activeAgent })}
                    rows={2}
                    value={activeDraft}
                  />
                  <div className="rg-codex-toolbar">
                    <div className="rg-codex-left-controls">
                      <button
                        aria-label={codexComposerCopy.optionsAria}
                        className="rg-codex-icon-button"
                        onClick={() => setCodexComposerMenu(current => (current === 'options' ? null : 'options'))}
                        type="button"
                      >
                        <Plus />
                      </button>
                      <div className="rg-codex-permission-wrap">
                        <button
                          aria-label={`${codexComposerCopy.permissionAria}: ${codexPermissionLabel}`}
                          className="rg-codex-permission-button"
                          onClick={() => {
                            setCodexSubmenu(null);
                            setCodexComposerMenu(current => (current === 'permission' ? null : 'permission'));
                          }}
                          type="button"
                        >
                          <Shield />
                          <span>{codexPermissionLabel}</span>
                          <ChevronDown />
                        </button>
                        {codexComposerMenu === 'permission' && (
                          <div className="rg-codex-menu rg-codex-permission-menu">
                            <span className="rg-codex-menu-label">{codexComposerCopy.permissionSection}</span>
                            {codexPermissionOptions.map(option => (
                              <button
                                className="rg-codex-option-row"
                                key={option}
                                onClick={() => {
                                  setCodexPermissionMode(option);
                                  setCodexComposerMenu(null);
                                }}
                                type="button"
                              >
                                <span>{codexComposerCopy.permission[option]}</span>
                                {codexPermissionMode === option && <Check />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {codexPlanMode && (
                        <span
                          aria-label={codexComposerCopy.planMode}
                          className="rg-codex-mode-indicator is-plan"
                          role="img"
                          title={codexComposerCopy.planMode}
                        >
                          <ClipboardList />
                        </span>
                      )}
                      {(codexGoalMode || activeCodexGoal) && (
                        <span
                          aria-label={codexComposerCopy.pursueGoal}
                          className="rg-codex-mode-indicator is-goal"
                          role="img"
                          title={codexComposerCopy.pursueGoal}
                        >
                          <Target />
                        </span>
                      )}
                      {codexComposerMenu === 'options' && (
                        <div className="rg-codex-menu rg-codex-options-menu">
                          <button
                            aria-pressed={codexPlanMode}
                            className="rg-codex-toggle-row"
                            onClick={toggleCodexPlanMode}
                            type="button"
                          >
                            <span>{codexComposerCopy.planMode}</span>
                            <span className="rg-codex-switch" data-on={codexPlanMode}><i /></span>
                          </button>
                          <button
                            aria-pressed={codexGoalMode}
                            className="rg-codex-toggle-row"
                            onClick={toggleCodexGoalMode}
                            type="button"
                          >
                            <span>{codexComposerCopy.pursueGoal}</span>
                            <span className="rg-codex-switch" data-on={codexGoalMode}><i /></span>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="rg-codex-toolbar-spacer" />

                    <div className="rg-codex-right-controls">
                      <div className="rg-codex-model-wrap">
                      <button
                        aria-label={`${codexComposerCopy.modelAria}: ${codexModelSummary}`}
                        className={`rg-codex-model-button ${codexEffectiveSpeed === 'fast' ? 'is-fast' : 'is-standard'}`}
                        onClick={() => {
                          setCodexSubmenu(null);
                          setCodexComposerMenu(current => (current === 'model' ? null : 'model'));
                        }}
                        type="button"
                      >
                        {codexEffectiveSpeed === 'fast' && <Zap />}
                        <span>{codexModelSummary}</span>
                        <ChevronDown />
                      </button>
                      {codexComposerMenu === 'model' && (
                        <div className="rg-codex-menu rg-codex-model-menu">
                          <span className="rg-codex-menu-label">{codexComposerCopy.reasoningSection}</span>
                          {codexReasoningOptions.map(option => (
                            <button
                              className="rg-codex-option-row"
                              key={option}
                              onClick={() => setCodexReasoningLevel(option)}
                              type="button"
                            >
                              <span>{codexComposerCopy.reasoning[option]}</span>
                              {codexReasoningLevel === option && <Check />}
                            </button>
                          ))}
                          <span className="rg-codex-menu-divider" />
                          <button
                            className="rg-codex-option-row"
                            onClick={() => setCodexSubmenu(current => (current === 'model' ? null : 'model'))}
                            type="button"
                          >
                            <span>{codexEffectiveSpeed === 'fast' && <Zap />} {codexModel}</span>
                            <ChevronRight />
                          </button>
                          {codexModelSupportsFast(codexModel) && (
                            <button
                              className="rg-codex-option-row"
                              onClick={() => setCodexSubmenu(current => (current === 'speed' ? null : 'speed'))}
                              type="button"
                            >
                              <span>{codexComposerCopy.speedSection}</span>
                              <ChevronRight />
                            </button>
                          )}
                          {codexSubmenu === 'model' && (
                            <div className="rg-codex-submenu is-model">
                              <span className="rg-codex-menu-label">{codexComposerCopy.modelSection}</span>
                              {codexModelOptions.map(option => (
                                <button
                                  className="rg-codex-option-row"
                                  key={option}
                                  onClick={() => {
                                    setCodexModel(option);
                                    setCodexSubmenu(null);
                                  }}
                                  type="button"
                                >
                                  <span>{option}</span>
                                  {codexModel === option && <Check />}
                                </button>
                              ))}
                            </div>
                          )}
                          {codexSubmenu === 'speed' && codexModelSupportsFast(codexModel) && (
                            <div className="rg-codex-submenu is-speed">
                              <span className="rg-codex-menu-label">{codexComposerCopy.speedSection}</span>
                              {codexSpeedOptions.map(option => (
                                <button
                                  className="rg-codex-option-row rg-codex-speed-row"
                                  key={option}
                                  onClick={() => {
                                    setCodexSpeed(option);
                                    setCodexSubmenu(null);
                                  }}
                                  type="button"
                                >
                                  <span className="rg-codex-speed-copy">
                                    <strong>{codexComposerCopy.speed[option]}</strong>
                                    <small>{codexComposerCopy.speedHint[option]}</small>
                                  </span>
                                  {codexSpeed === option && <Check />}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      </div>
                      <button
                        aria-label={activeSending ? codexComposerCopy.interruptTitle : copy.main.sendTitle}
                        className={`rg-codex-send ${activeSending ? 'is-interrupt' : ''}`}
                        disabled={budgetOverLimit || (!activeSending && !activeDraft.trim())}
                        onClick={activeSending ? handleCodexInterrupt : handleSend}
                        title={activeSending ? codexComposerCopy.interruptTitle : copy.main.sendTitle}
                        type="button"
                      >
                        {activeSending ? <X /> : <Send />}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`rg-command-input ${budgetOverLimit ? 'is-budget-blocked' : ''}`}>
                  <textarea
                    ref={textareaRef}
                    aria-label={rgText(copy.main.askAria, { agent: activeAgent })}
                    disabled={budgetOverLimit || activeSending}
                    onChange={(event) => updateActiveDraft(event.target.value)}
                    onCompositionEnd={() => setIsComposing(false)}
                    onCompositionStart={() => setIsComposing(true)}
                    onKeyDown={handleInputKeyDown}
                    placeholder={budgetOverLimit
                      ? rgText(copy.sidebar.budgetReached, { agent: activeBudgetAgentName })
                      : rgText(copy.main.askPlaceholder, { agent: activeAgent })}
                    rows={2}
                    value={activeDraft}
                  />
                  <span className="rg-command-shortcuts">
                    {budgetOverLimit
                      ? rgText(copy.sidebar.resetsIn, { time: formatBudgetRefreshTime(activeBudgetRemainingMs, copy) })
                      : copy.main.shortcuts}
                  </span>
                  <button
                    disabled={budgetOverLimit || activeSending || !activeDraft.trim()}
                    onClick={handleSend}
                    type="button"
                    title={budgetOverLimit ? rgText(copy.sidebar.budgetReached, { agent: activeBudgetAgentName }) : copy.main.sendTitle}
                  >
                    {activeSending ? <Loader2 className="is-spinning" /> : <Send />}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <footer className="rg-statusbar">
          <StatusDot tone={guardMode === 'On' ? 'success' : 'warning'} />
          <span className={`rg-status-guard ${guardMode === 'On' ? 'is-active' : 'is-off'}`}>
            {guardMode === 'On' ? copy.main.statusActive : copy.main.statusOff}
          </span>
          <span>{copy.main.events}: {activeMessages.length}</span>
          <span>{copy.main.blocked}: {activeMessages.filter(message => message.role === 'error').length}</span>
          <span>{copy.main.warnings}: {activeMessages.filter(message => message.role === 'trace' && message.trace_type?.includes('approval')).length}</span>
        </footer>

      </main>
      </div>
      <div className="rg-right-scale" style={rightScaleStyle}>
        <section className="rg-session-history">
          <div className="rg-card-head rg-session-history-head">
            <span>{copy.sessionHistory.title.toUpperCase()}</span>
            <button
              type="button"
              onClick={() => {
                void fetchSessionHistory(false);
                setActiveRuntimeGuardModal('sessions');
              }}
            >
              {copy.sidebar.manage}
            </button>
          </div>
          <div className="rg-session-history-list">
            {sessionHistoryPreviewItems.length > 0 ? (
              sessionHistoryPreviewItems.map(session => {
                const status = sessionHistoryStatus(session, activeSessionId);
                const baseTitle = runtimeGuardSessionBaseTitle(session);
                return (
                  <button
                    className="rg-session-history-row"
                    key={session.sessionKey}
                    onClick={() => openHistorySession(session)}
                    type="button"
                  >
                    <span className="rg-session-history-time">{formatSessionHistoryTime(session.createdAt)}</span>
                    <div className="rg-session-history-main">
                      <strong>{session.agent}:</strong>
                      <span>{baseTitle}</span>
                    </div>
                    <em className={status === 'Active' ? 'is-active' : ''}>{sessionStatusDisplay(status, copy)}</em>
                  </button>
                );
              })
            ) : (
              <div className="rg-session-history-empty">
                {sessionHistoryLoading ? copy.main.loadingHistory : copy.sessionHistory.empty}
              </div>
            )}
          </div>
        </section>
        <aside className="rg-right-panel">
          <section className="rg-approval-center">
            <div className="rg-card-head rg-approval-head">
              <span>{copy.approvals.panelTitle}</span>
              <span className="rg-count">{rightPanelApprovalCount}</span>
              <button type="button" onClick={() => setActiveRuntimeGuardModal('approvals')}>{copy.sidebar.manage}</button>
            </div>
            {rightPanelApprovals.length > 0 ? (
              rightPanelApprovals.map((item, index) => (
                <ApprovalCard
                  item={item}
                  key={item.id}
                  slotIndex={index}
                  resolving={resolvingApprovalId === item.id}
                  onDecision={resolveApproval}
                />
              ))
            ) : (
              <div className="rg-approval-empty">
                {approvalLoading ? copy.approvals.loading : copy.approvals.empty}
              </div>
            )}
          </section>

          <section className="rg-guard-status">
            <div className="rg-card-head">
              <span>{copy.guardStatus.title}</span>
              <span className={`rg-secure rg-status-${guardStatusSummary.tone}`}>
                {guardStatusSummary.tone === 'attention'
                  ? <AlertTriangle />
                  : guardStatusSummary.tone === 'off'
                    ? <Lock />
                    : <Check />}
                {guardSummaryDisplay(guardStatusSummary.label, copy)}
              </span>
            </div>
            <div
              className={`rg-score-ring rg-score-${guardScoreTone(guardStatusSummary.score)}`}
              style={{ '--rg-score-progress': `${guardScoreRingDegrees(guardStatusSummary.score)}deg` } as CSSProperties}
            >
              <strong>{guardStatusSummary.score}</strong>
              <span>/100</span>
            </div>
            <div className="rg-guard-list">
              {guardStatusRows.map(({ label, status, tone }) => (
                <div className="rg-guard-row" key={label}>
                  <StatusDot tone={tone} />
                  <span>{guardStatusRowLabel(label, copy)}</span>
                  <strong className={`rg-tool-${tone}`}>{guardStatusRowStatus(status, copy)}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rg-recent-blocked">
            <div className="rg-card-head rg-recent-head">
              <span>{copy.blockedActions.title.toUpperCase()}</span>
              <button type="button" onClick={() => setActiveRuntimeGuardModal('blocked')}>{copy.blockedActions.manage}</button>
            </div>
            {recentBlockedItems.length > 0 ? (
              recentBlockedItems.map((item, index) => (
                <div className="rg-block-row" key={item.id} style={{ top: 28 + index * 16 }}>
                  <span>{formatBlockedTime(item.timestamp)}</span>
                  <strong>{copy.blockedActions.blocked}</strong>
                  <span>{blockedDisplayText(item)}</span>
                </div>
              ))
            ) : (
              <div className="rg-block-empty">
                {blockedLoading ? copy.blockedActions.loading : copy.blockedActions.emptyRecent}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
