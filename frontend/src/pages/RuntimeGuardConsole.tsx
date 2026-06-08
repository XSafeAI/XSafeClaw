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
  FolderOpen,
  GitBranch,
  Globe2,
  Hexagon,
  Loader2,
  Lock,
  Network,
  Send,
  Settings,
  Shield,
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
  type RuntimeSessionRecord,
} from '../services/api';
import MarkdownMessage from '../components/MarkdownMessage';
import { useRuntimeInstances } from '../hooks/useAPI';
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
  runtimeGuardToolPermissionLabel,
  toolPermissionsFromPolicies,
  toolPoliciesFromPermissions,
  type GuardStatusRowTone,
  type RuntimeGuardToolId,
  type RuntimeGuardToolPermission,
  type RuntimeGuardToolPermissions,
} from './runtimeGuardToolPolicy';
import './RuntimeGuardConsole.css';

type AgentName = 'OpenClaw' | 'Hermes' | 'Nanobot';
type RuntimePlatform = RuntimeInstance['platform'];
type RuntimeBudgetStatusMap = Record<RuntimeBudgetPlatform, RuntimeBudgetStatus>;
type GuardMode = 'Off' | 'On';
export type RuntimeGuardSession = {
  sessionKey: string;
  historySessionId?: string;
  agent: AgentName;
  platform: RuntimePlatform;
  instanceId: string;
  displayName?: string;
  title: string;
  createdAt: string;
  lastActivityAt?: string;
  status: 'ready' | 'error';
  autoTitlePending?: boolean;
};
type InstallMap = Record<AgentName, boolean | null>;
type AgentDisplay = {
  name: AgentName;
  status: 'Running' | 'Idle' | 'Not installed';
  className: string;
  installed: boolean;
};
type RuntimeGuardModal = 'tools' | 'sessions' | 'approvals' | 'blocked' | null;
type SessionHistoryAgentFilter = 'All' | AgentName;
export type BlockedModalRange = '24h' | '7d' | 'all';

const RUNTIME_GUARD_SESSIONS_KEY = 'xsafeclaw:runtime-guard:sessions';
const RUNTIME_GUARD_DRAFTS_KEY = 'xsafeclaw:runtime-guard:drafts';
const APPROVAL_POLL_INTERVAL_MS = 3000;

const agentDefinitions: Array<{
  name: AgentName;
  platform: RuntimeBudgetPlatform;
  defaultStatus: 'Running' | 'Idle';
  className: string;
}> = [
  { name: 'OpenClaw', platform: 'openclaw', defaultStatus: 'Running', className: 'agent-openclaw' },
  { name: 'Hermes', platform: 'hermes', defaultStatus: 'Idle', className: 'agent-hermes' },
  { name: 'Nanobot', platform: 'nanobot', defaultStatus: 'Idle', className: 'agent-nanobot' },
];

const sessionHistoryFilters: SessionHistoryAgentFilter[] = ['All', 'OpenClaw', 'Hermes', 'Nanobot'];
const runtimeBudgetPlatforms: RuntimeBudgetPlatform[] = ['openclaw', 'hermes', 'nanobot'];
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

function isRuntimePlatform(value: unknown): value is RuntimePlatform {
  return value === 'openclaw' || value === 'hermes' || value === 'nanobot';
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
    title,
    createdAt,
    lastActivityAt,
    status: 'ready',
    autoTitlePending: false,
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
    byKey.set(openSession.sessionKey, historySession ? {
      ...historySession,
      ...openSession,
      historySessionId: historySession.historySessionId ?? openSession.historySessionId,
      lastActivityAt: historySession.lastActivityAt ?? openSession.lastActivityAt,
    } : openSession);
  });
  return sortSessionsNewestFirst([...byKey.values()]);
}

export function promoteRuntimeGuardSession(
  current: RuntimeGuardSession[],
  session: RuntimeGuardSession,
): RuntimeGuardSession[] {
  const existing = current.find(item => item.sessionKey === session.sessionKey);
  const front = existing ? {
    ...session,
    ...existing,
    historySessionId: existing.historySessionId ?? session.historySessionId,
    lastActivityAt: session.lastActivityAt ?? existing.lastActivityAt,
  } : session;
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
        if (!sessionKey || !['openclaw', 'hermes', 'nanobot'].includes(platform)) return null;
        if (!['OpenClaw', 'Hermes', 'Nanobot'].includes(agent)) return null;
        return {
          sessionKey,
          historySessionId: typeof item?.historySessionId === 'string' ? item.historySessionId : undefined,
          agent,
          platform,
          instanceId: typeof item?.instanceId === 'string' ? item.instanceId : '',
          displayName: typeof item?.displayName === 'string' ? item.displayName : undefined,
          title: typeof item?.title === 'string' && item.title.trim() ? item.title : agent,
          createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          lastActivityAt: typeof item?.lastActivityAt === 'string' ? item.lastActivityAt : undefined,
          status: item?.status === 'error' ? 'error' : 'ready',
          autoTitlePending: Boolean(item?.autoTitlePending),
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

async function responseErrorMessage(response: Response): Promise<string> {
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
        const resetText = Number.isFinite(resetAtMs)
          ? ` Resets in ${formatBudgetRefreshTime(resetAtMs - Date.now())}.`
          : '';
        return `${platformToAgent(platform)} budget reached.${resetText}`;
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

function formatSessionStart(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Started just now';
  return `Started ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
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

function titleFromUserMessage(input: string): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trimEnd()}...` : cleaned;
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

function agentToPlatform(agent: AgentName): RuntimePlatform {
  return agentDefinitions.find(item => item.name === agent)?.platform ?? 'openclaw';
}

function agentIcon(agent: AgentName) {
  if (agent === 'OpenClaw') return <Zap />;
  if (agent === 'Hermes') return <Bot />;
  return <Hexagon />;
}

function toolPermissionTone(permission: RuntimeGuardToolPermission): 'success' | 'warning' | 'asked' {
  if (permission === 'Allowed') return 'success';
  if (permission === 'Guard') return 'warning';
  return 'asked';
}

function toolPermissionButtonLabel(permission: RuntimeGuardToolPermission): string {
  return runtimeGuardToolPermissionLabel(permission);
}

function runtimeUnavailableMessage(instance: RuntimeInstance) {
  if (instance.platform === 'nanobot' && instance.health_status !== 'healthy') {
    return `${instance.display_name || 'Nanobot'} gateway offline.`;
  }
  if ((instance.platform === 'openclaw' || instance.platform === 'hermes') && instance.health_status === 'unreachable') {
    return `${instance.display_name || instance.platform} is unreachable.`;
  }
  return '';
}

function approvalStatusLabel(status: MiddleApprovalStatus): string {
  if (status === 'approved') return 'Allowed';
  if (status === 'rejected') return 'Denied';
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
    if (!shouldDisplayTraceMessage(platform, {
      type: typeof evt.type === 'string' ? evt.type : 'trace_step',
      text: typeof raw.content === 'string' ? raw.content : '',
      summary: typeof evt.summary === 'string' ? evt.summary : '',
      phase: typeof evt.phase === 'string' ? evt.phase : '',
    })) {
      return null;
    }
    return {
      id: raw.id || uuidv4(),
      role: 'trace',
      content: typeof raw.content === 'string' ? raw.content : '',
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
      trace_type: typeof evt.type === 'string' ? evt.type : 'trace_step',
      trace_phase: typeof evt.phase === 'string' ? evt.phase : '',
      trace_step: typeof evt.step === 'number' ? evt.step : undefined,
      trace_summary: typeof evt.summary === 'string' ? evt.summary : '',
    };
  }

  return null;
}

function StatusDot({ tone }: { tone: GuardStatusRowTone | 'mcp' }) {
  return <span className={`rg-dot rg-dot-${tone}`} />;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatVersionLabel(version: string | null): string {
  const trimmed = version?.trim();
  if (!trimmed) return 'v--';
  return trimmed.toLowerCase().startsWith('v') ? trimmed : `v${trimmed}`;
}

function formatBudgetRefreshTime(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalMinutes = Math.ceil(clamped / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
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
  const riskTone = item.guard_verdict === 'unsafe' ? 'high' : 'medium';
  const risk = riskTone === 'high' ? 'High Risk' : 'Medium Risk';
  const content = previewApprovalParams(item.params);
  const cardClass = modal ? 'is-modal' : slotIndex === 0 ? 'rg-approval-shell' : 'rg-approval-file';

  return (
    <div className={`rg-approval-item ${cardClass}`}>
      <div className="rg-approval-title">{item.tool_name || 'Tool Call'}</div>
      <div className={`rg-risk-text rg-risk-${riskTone}`}>{risk}</div>
      <div className="rg-code-strip">
        <span>{content}</span>
      </div>
      <div className="rg-meta rg-meta-by">By: {approvalByline(item)}</div>
      <div className="rg-meta rg-meta-time">Time: {formatApprovalTime(item.created_at)}</div>
      <button
        className="rg-small-action rg-small-deny"
        disabled={resolving}
        onClick={() => onDecision(item, 'rejected')}
        type="button"
      >
        Deny
      </button>
      <button
        className="rg-small-action rg-small-allow"
        disabled={resolving}
        onClick={() => onDecision(item, 'approved')}
        type="button"
      >
        Allow
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
  const item = card.item;
  const isPending = card.status === 'pending';
  const riskTone = item.guard_verdict === 'unsafe' ? 'high' : 'medium';
  const risk = riskTone === 'high' ? 'High Risk' : 'Medium Risk';
  const statusText = isPending ? risk : approvalStatusLabel(card.status);
  const statusClass = isPending ? `rg-risk-${riskTone}` : '';
  const cardStateClass = card.status === 'pending'
    ? 'is-pending'
    : card.status === 'approved'
      ? 'is-approved'
      : 'is-denied';
  const requestTitle = item.tool_name && /\brequest$/i.test(item.tool_name)
    ? item.tool_name
    : `${item.tool_name || 'Tool Call'} Request`;
  const content = previewApprovalParams(item.params);
  const reason = item.failure_mode || item.risk_source;
  const impact = item.real_world_harm;

  return (
    <div className={`rg-stream-row rg-stream-approval ${cardStateClass}`}>
      <span className="rg-stream-time">{formatApprovalTime(item.created_at)}</span>
      <AlertTriangle className="rg-stream-icon rg-approval-timeline-icon" />
      <div className="rg-stream-body">
        <div className={`rg-command-card ${cardStateClass}`}>
          <AlertTriangle />
          <div className="rg-command-title">{requestTitle}</div>
          <div className={`rg-command-risk ${statusClass}`}>{statusText}</div>
          <pre className="rg-command-code">{content}</pre>
          <div className="rg-command-reason">
            {reason && <span>Reason: {reason}</span>}
            {impact && <span>Impact: {impact}</span>}
          </div>
          {isPending && (
            <div className="rg-command-actions">
              <button
                className="rg-deny"
                disabled={resolving}
                onClick={() => onDecision(item, 'rejected')}
                type="button"
              >
                Deny
              </button>
              <button
                className="rg-always"
                disabled={resolving}
                onClick={() => onDecision(item, 'approved')}
                type="button"
              >
                Allow
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

function blockedSourceLabel(source: RecentBlockedSource): string {
  return source === 'approval' ? 'Approval' : 'Observation';
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
        <button className="rg-modal-close" type="button" title="Close session history" onClick={onClose}>
          <X />
        </button>
        <div className="rg-list-modal-kicker">SESSION HISTORY</div>
        <h2 id="rg-session-modal-title">Session history</h2>
        <div className="rg-list-modal-subtitle">{filteredSessions.length} session{filteredSessions.length === 1 ? '' : 's'}</div>
        <div className="rg-session-modal-controls">
          <input
            aria-label="Search session history"
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search sessions..."
            type="search"
            value={searchQuery}
          />
          <div className="rg-session-agent-tabs" role="group" aria-label="Session agent filter">
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
                    <span className="rg-session-modal-agent">{agentIcon(session.agent)} {session.agent}</span>
                    <span className="rg-session-modal-title">
                      <strong>{session.title}</strong>
                      <em>{session.displayName || session.instanceId || session.platform}</em>
                    </span>
                    <span className="rg-session-modal-stats">
                      <span>Events {messages.length}</span>
                      <span>Blocked {blockedCount}</span>
                      <span>Pending {pendingApprovals}</span>
                    </span>
                    <span className="rg-session-modal-status">
                      <StatusDot tone={statusTone} />
                      {status}
                    </span>
                  </button>
                  <button
                    className="rg-session-modal-delete"
                    onClick={() => {
                      const confirmed = window.confirm(`Delete session "${session.title}" from history? This cannot be undone.`);
                      if (confirmed) onDeleteSession(session);
                    }}
                    title={`Delete ${session.title}`}
                    type="button"
                  >
                    <Trash2 />
                  </button>
                </article>
              );
            })
          ) : (
            <div className="rg-list-empty">
              {loading && sessions.length === 0 ? 'Loading session history...' : sessions.length === 0 ? 'No session history' : 'No sessions match this filter'}
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
  useRuntimeGuardModalEscape(onClose);

  return (
    <div className="rg-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="rg-list-modal rg-tools-list-modal" role="dialog" aria-modal="true" aria-labelledby="rg-tools-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="rg-modal-close" type="button" title="Close tool permissions" onClick={onClose}>
          <X />
        </button>
        <div className="rg-list-modal-kicker">TOOLS</div>
        <h2 id="rg-tools-modal-title">Tool permissions</h2>
        <div className="rg-list-modal-scroll rg-tools-modal-scroll">
          {configurableTools.map(tool => {
            const ToolIcon = tool.icon;
            const permission = permissions[tool.id];
            return (
              <article className="rg-tool-permission-row" key={tool.id}>
                <span className="rg-tool-permission-mark"><ToolIcon /></span>
                <strong>{tool.name}</strong>
                <div className="rg-permission-segment" role="group" aria-label={`${tool.name} permission`}>
                  {toolPermissionOptions.map(option => (
                    <button
                      aria-pressed={permission === option}
                      className={permission === option ? 'is-active' : ''}
                      key={option}
                      onClick={() => onPermissionChange(tool.id, option)}
                      type="button"
                    >
                      {toolPermissionButtonLabel(option)}
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
  useRuntimeGuardModalEscape(onClose);

  return (
    <div className="rg-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="rg-list-modal" role="dialog" aria-modal="true" aria-labelledby="rg-approval-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="rg-modal-close" type="button" title="Close approvals" onClick={onClose}>
          <X />
        </button>
        <div className="rg-list-modal-kicker">APPROVAL CENTER</div>
        <h2 id="rg-approval-modal-title">Pending approvals</h2>
        <div className="rg-list-modal-subtitle">{items.length} pending request{items.length === 1 ? '' : 's'}</div>
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
              {loading ? 'Loading approvals...' : 'No pending approvals'}
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
  useRuntimeGuardModalEscape(onClose);

  const filteredItems = filterBlockedItemsByRange(items, range, nowMs);
  const rangeOptions: Array<{ value: BlockedModalRange; label: string }> = [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div className="rg-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="rg-list-modal rg-blocked-list-modal" role="dialog" aria-modal="true" aria-labelledby="rg-blocked-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="rg-modal-close" type="button" title="Close blocked events" onClick={onClose}>
          <X />
        </button>
        <div className="rg-list-modal-kicker">RECENT BLOCKED</div>
        <h2 id="rg-blocked-modal-title">Blocked events</h2>
        <div className="rg-range-tabs" role="tablist" aria-label="Blocked time range">
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
                  <strong>Blocked</strong>
                  <em>{blockedSourceLabel(item.source)}</em>
                </div>
                <div className="rg-block-detail-title">{item.toolName}</div>
                <code>{previewApprovalParams(item.params)}</code>
                <div className="rg-block-detail-meta">
                  <span>By: {blockedByline(item)}</span>
                  {item.sessionKey && <span>Session: {item.sessionKey}</span>}
                  {item.reason && <span>Reason: {item.reason}</span>}
                  {item.impact && <span>Impact: {item.impact}</span>}
                </div>
              </article>
            ))
          ) : (
            <div className="rg-list-empty">
              {loading && items.length === 0 ? 'Loading blocked...' : 'No blocked events in this range'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineMessage({
  msg,
  expanded,
  onToggle,
}: {
  msg: ChatMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = formatTime(msg.timestamp);

  if (msg.role === 'tool_call') {
    const resultText = formatValue(msg.result);
    const argsText = formatValue(msg.args);
    const summary = argsText.replace(/\s+/g, ' ').slice(0, 100);
    return (
      <div className={`rg-stream-row rg-stream-tool ${msg.is_error ? 'is-error' : ''}`}>
        <span className="rg-stream-time">{time}</span>
        <Wrench className="rg-stream-icon" />
        <div className="rg-stream-body">
          <button className="rg-tool-toggle" type="button" onClick={onToggle}>
            <span className="rg-stream-title">{msg.tool_name || 'tool'}</span>
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
    const label = traceDisplayLabel(msg);
    return (
      <div className="rg-stream-row rg-stream-trace">
        <span className="rg-stream-time">{time}</span>
        <Brain className="rg-stream-icon" />
        <div className="rg-stream-body">
          <span className="rg-stream-title">{label}</span>
          {msg.trace_summary && <p>{msg.trace_summary}</p>}
          {msg.content && <p>{msg.content}</p>}
        </div>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';
  return (
    <div className={`rg-stream-row ${isUser ? 'rg-stream-user' : isError ? 'rg-stream-error' : 'rg-stream-assistant'}`}>
      <span className="rg-stream-time">{time}</span>
      {isUser ? <User className="rg-stream-icon" /> : isError ? <AlertTriangle className="rg-stream-icon" /> : <Bot className="rg-stream-icon" />}
      <div className="rg-stream-body">
        <span className="rg-stream-title">{isUser ? 'You' : isError ? 'Runtime error' : 'Assistant'}</span>
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
  const navigate = useNavigate();
  const runtimeInstancesQuery = useRuntimeInstances();
  const subscribeToChatStore = useCallback((listener: () => void) => chatStreamStore.subscribe(listener), []);
  const messageMap = useSyncExternalStore(subscribeToChatStore, () => chatStreamStore.getSnapshot());
  const sendingMap = useSyncExternalStore(subscribeToChatStore, () => chatStreamStore.getSendingSnapshot());

  const [installedAgents, setInstalledAgents] = useState<InstallMap>({
    OpenClaw: null,
    Hermes: null,
    Nanobot: null,
  });
  const [installProbeFailed, setInstallProbeFailed] = useState(false);
  const [xsafeclawVersion, setXsafeclawVersion] = useState<string | null>(null);
  const [sessions, setSessions] = useState<RuntimeGuardSession[]>(() => loadRuntimeGuardSessions());
  const [activeSessionId, setActiveSessionId] = useState(() => loadRuntimeGuardSessions()[0]?.sessionKey ?? '');
  const [sessionHistoryItems, setSessionHistoryItems] = useState<RuntimeGuardSession[]>([]);
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<AgentName>('OpenClaw');
  const [draftBySessionKey, setDraftBySessionKey] = useState<Record<string, string>>(() => loadRuntimeGuardDrafts());
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [creatingAgent, setCreatingAgent] = useState<AgentName | null>(null);
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
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const approvalRefreshTimerRef = useRef<number | null>(null);

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
  const activeBudgetPlatform = (activeSession?.platform ?? agentToPlatform(selectedAgent)) as RuntimeBudgetPlatform;
  const sidebarTools = useMemo(() => ([
    ...configurableTools.map(tool => {
      const permission = toolPermissions[tool.id];
      return {
        ...tool,
        status: runtimeGuardToolPermissionLabel(permission),
        tone: toolPermissionTone(permission),
      };
    }).filter(tool => tool.id === 'shell' || tool.id === 'fileSystem' || tool.id === 'browser'),
  ]), [toolPermissions]);
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
      const scale = window.innerHeight / 570;
      const leftWidth = 156 * scale;
      const rightWidth = 207 * scale;
      const mainWidth = Math.max(window.innerWidth - leftWidth - rightWidth, 280 * scale);

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
      const { data } = await sessionsAPI.listRuntime({ page: 1, page_size: 100 });
      const nextSessions = (data.sessions ?? [])
        .map(runtimeSessionRecordToRuntimeGuardSession)
        .filter((session): session is RuntimeGuardSession => session !== null);
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
        });
        setXsafeclawVersion(res.data.xsafeclaw_version ?? null);
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
      taskScrollRef.current?.scrollTo({ top: taskScrollRef.current.scrollHeight, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSessionKey, activeTimelineScrollKey]);

  useEffect(() => {
    if (!activeSessionKey) return;
    window.setTimeout(() => textareaRef.current?.focus(), 80);
  }, [activeSessionKey]);

  const loadHistory = useCallback(async (sessionKey: string, force = false) => {
    if (!force && chatStreamStore.hasLoadedMessages(sessionKey)) return;
    setLoadingHistory(sessionKey);
    try {
      const res = await chatAPI.getHistory(sessionKey);
      const sessionPlatform = sessions.find(session => session.sessionKey === sessionKey)?.platform;
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
  }, [activeSession?.sessionKey, loadHistory]);

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
  const approvalCount = useMemo(
    () => unresolvedApprovalItems.length,
    [unresolvedApprovalItems.length],
  );
  const visibleApprovals = useMemo(
    () => unresolvedApprovalItems.slice(0, 2),
    [unresolvedApprovalItems],
  );
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
    () => agentDefinitions.map(agent => {
      const installed = installedAgents[agent.name];
      const probeUnknown = installed === null || installProbeFailed;
      return {
        name: agent.name,
        className: agent.className,
        installed: probeUnknown ? true : installed,
        status: probeUnknown ? agent.defaultStatus : installed ? agent.defaultStatus : 'Not installed',
      };
    }),
    [installProbeFailed, installedAgents],
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
  const selectedBudgetAgentName = agentDefinitions.find(agent => agent.platform === selectedBudgetPlatform)?.name ?? 'Runtime';
  const activeBudgetAgentName = agentDefinitions.find(agent => agent.platform === activeBudgetPlatform)?.name ?? 'Runtime';
  const budgetResetText = budgetConfigured
    ? `Resets in ${formatBudgetRefreshTime(budgetRemainingMs)}`
    : `${selectedBudgetAgentName} total cost`;

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
        if (!cancelled) showToast('Failed to load Guard mode.');
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

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
        showToast('Approval request is no longer available.');
      } else {
        showToast(`Failed to ${resolution === 'approved' ? 'allow' : 'deny'} approval.`);
      }
    } finally {
      setResolvingApprovalId(null);
    }
  };

  const showInstallHint = useCallback((agent: AgentName) => {
    showToast(`${agent} is not installed. Open Setup to install it.`);
  }, [showToast]);

  useEffect(() => {
    if (!budgetModalOpen) return;
    const status = runtimeBudgetStatuses[selectedBudgetPlatform] ?? defaultRuntimeBudgetStatus(selectedBudgetPlatform);
    setBudgetAmountInput(status.maxCost ? String(status.maxCost) : '');
    setBudgetPeriodInput(status.maxCost && status.periodValue ? String(status.periodValue) : '');
    setBudgetPeriodUnit(status.periodUnit === 'day' ? 'day' : 'hour');
  }, [budgetModalOpen, runtimeBudgetStatuses, selectedBudgetPlatform]);

  const openBudgetModal = () => {
    setBudgetAmountInput(budgetLimit ? String(budgetLimit) : '');
    setBudgetPeriodInput(budgetLimit && budgetStatus.periodValue ? String(budgetStatus.periodValue) : '');
    setBudgetPeriodUnit(budgetStatus.periodUnit === 'day' ? 'day' : 'hour');
    setBudgetModalOpen(true);
  };

  const saveBudgetLimit = async () => {
    const maxCost = Number(budgetAmountInput);
    const periodValue = Number(budgetPeriodInput);
    if (!Number.isFinite(maxCost) || maxCost <= 0 || !Number.isFinite(periodValue) || periodValue <= 0) return;

    setBudgetSaving(true);
    try {
      const { data } = await budgetAPI.updateRuntimeBudget(selectedBudgetPlatform, {
        maxCost,
        periodValue,
        periodUnit: budgetPeriodUnit,
      });
      setRuntimeBudgetStatuses(current => ({ ...current, [selectedBudgetPlatform]: data }));
      setNowTs(Date.now());
      setBudgetModalOpen(false);
    } catch {
      showToast(`Failed to save ${selectedBudgetAgentName} budget.`);
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
      showToast(`Failed to clear ${selectedBudgetAgentName} budget.`);
    } finally {
      setBudgetSaving(false);
    }
  };

  const findRuntimeForAgent = useCallback((agent: AgentName): RuntimeInstance | null => {
    const platform = agentToPlatform(agent);
    return availableInstances.find(instance => instance.platform === platform && instance.is_default)
      ?? availableInstances.find(instance => instance.platform === platform)
      ?? null;
  }, [availableInstances]);

  const openSession = useCallback(async (agent: AgentName, installed = true) => {
    if (creatingAgent) return;
    if (!installed) {
      showInstallHint(agent);
      return;
    }
    if (runtimeInstancesQuery.isLoading) {
      showToast('Runtime instances are still loading.');
      return;
    }

    const runtime = findRuntimeForAgent(agent);
    if (!runtime) {
      showToast(`No enabled ${agent} runtime found. Open Setup to configure it.`);
      return;
    }

    const unavailable = runtimeUnavailableMessage(runtime);
    if (unavailable) {
      showToast(unavailable);
      return;
    }

    setCreatingAgent(agent);
    setSelectedAgent(agent);
    try {
      const sameAgentCount = sessions.filter(session => session.agent === agent).length + 1;
      const label = sameAgentCount === 1 ? agent : `${agent} ${sameAgentCount}`;
      const res = await chatAPI.startSession({ instance_id: runtime.instance_id, label });
      const session: RuntimeGuardSession = {
        sessionKey: res.data.session_key,
        agent,
        platform: res.data.platform as RuntimePlatform,
        instanceId: res.data.instance_id,
        displayName: res.data.instance?.display_name || runtime.display_name,
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
    } catch (err: any) {
      const detail = String(err?.response?.data?.detail || err?.message || 'Failed to create session.');
      showToast(detail);
    } finally {
      setCreatingAgent(null);
    }
  }, [
    creatingAgent,
    findRuntimeForAgent,
    runtimeInstancesQuery.isLoading,
    sessions,
    setMessageMap,
    showInstallHint,
    showToast,
  ]);

  const openSelectedAgentSession = () => {
    openSession(selectedAgent, agents.find(agent => agent.name === selectedAgent)?.installed ?? true);
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
      showToast('Failed to update Guard mode.');
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
    setSessions(current => promoteRuntimeGuardSession(current, session));
    setDraftBySessionKey(current => ({ ...current, [session.sessionKey]: current[session.sessionKey] ?? '' }));
    setSelectedAgent(session.agent);
    setActiveSessionId(session.sessionKey);
  }, []);

  const deleteHistorySession = async (session: RuntimeGuardSession) => {
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

  const applySessionTitle = useCallback((sessionKey: string, title: string) => {
    const nextTitle = titleFromUserMessage(title);
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

  const handleSend = async () => {
    if (!activeSession) return;
    const originalKey = activeSession.sessionKey;
    const text = activeDraft.trim();
    if (!text || activeSending || inFlightKeysRef.current.has(originalKey)) return;

    if (budgetOverLimit) {
      showToast(`${activeBudgetAgentName} budget reached. Resets in ${formatBudgetRefreshTime(activeBudgetRemainingMs)}.`);
      return;
    }

    let key = originalKey;
    const streamPlatform = activeSession.platform;
    const titlePlatform = activeSession.platform;
    const titleInstanceId = activeSession.instanceId;
    const shouldGenerateTitle = Boolean(activeSession.autoTitlePending);
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
          applySessionTitle(key, data.title);
        })
        .catch(() => {
          applySessionTitle(key, text);
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
        throw new Error(await responseErrorMessage(response));
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
              });
            } else if (chunk.type === 'tool_result') {
              setMessageMap(prev => {
                const messages = [...(prev[key] ?? [])];
                let updated = false;
                if (chunk.tool_id) {
                  for (let i = messages.length - 1; i >= 0; i -= 1) {
                    const message = messages[i];
                    if (message.role === 'tool_call' && message.tool_id === chunk.tool_id) {
                      messages[i] = { ...message, result: chunk.result, is_error: chunk.is_error, result_pending: false };
                      updated = true;
                      break;
                    }
                  }
                }
                if (!updated && chunk.tool_name) {
                  for (let i = messages.length - 1; i >= 0; i -= 1) {
                    const message = messages[i];
                    if (message.role === 'tool_call' && message.tool_name === chunk.tool_name && message.result_pending) {
                      messages[i] = { ...message, result: chunk.result, is_error: chunk.is_error, result_pending: false };
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
                    return { ...message, result: reason || blockedText, is_error: true, result_pending: false };
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
    width: layoutFit.rightWidth,
    height: layoutFit.height,
    '--rg-scale': layoutFit.scale,
  } as CSSProperties;
  const runtimeGuardPageStyle = {
    '--rg-scale': layoutFit.scale,
  } as CSSProperties;
  const xsafeclawVersionLabel = formatVersionLabel(xsafeclawVersion);

  return (
    <div className="runtime-guard-page" style={runtimeGuardPageStyle}>
      {placeholder && <div className="rg-toast">{placeholder}</div>}
      {budgetModalOpen && (
        <div className="rg-modal-backdrop" role="presentation">
          <div className="rg-budget-modal" role="dialog" aria-modal="true" aria-labelledby="rg-budget-modal-title">
            <button className="rg-modal-close" type="button" title="Close budget settings" onClick={() => setBudgetModalOpen(false)}>
              <X />
            </button>
            <div className="rg-budget-modal-kicker">BUDGET LIMIT</div>
            <h2 id="rg-budget-modal-title">Set runtime budget</h2>
            <p>Set a server-side spending limit for the selected runtime period.</p>
            <label className="rg-budget-runtime-picker">
              <span>Runtime</span>
              <select
                aria-label="Budget runtime"
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
                aria-label="Maximum USD usage"
                inputMode="decimal"
                min="0"
                onChange={(event) => setBudgetAmountInput(event.target.value)}
                placeholder="__"
                step="0.01"
                type="number"
                value={budgetAmountInput}
              />
              <span>USD</span>
              <input
                aria-label="Budget refresh interval"
                inputMode="numeric"
                min="1"
                onChange={(event) => setBudgetPeriodInput(event.target.value)}
                placeholder="__"
                step="1"
                type="number"
                value={budgetPeriodInput}
              />
              <select
                aria-label="Budget interval unit"
                onChange={(event) => setBudgetPeriodUnit(event.target.value as BudgetPeriodUnit)}
                value={budgetPeriodUnit}
              >
                <option value="hour">小时</option>
                <option value="day">天</option>
              </select>
            </div>
            <div className="rg-budget-modal-preview">
              Current {selectedBudgetAgentName} period cost: {formatMoney(budgetStatus.currentCost)}
            </div>
            <div className="rg-budget-modal-actions">
              <button type="button" className="rg-budget-clear" disabled={budgetSaving} onClick={() => void clearBudgetLimit()}>Clear</button>
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
                {budgetSaving ? 'Saving' : 'Save'}
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
          <span className="rg-pro">PRO</span>
          <span className="rg-subtitle">AI Runtime Guard</span>
        </div>

        <button className="rg-new-task" onClick={openSelectedAgentSession} type="button" disabled={Boolean(creatingAgent)}>
          <span>+</span>
          <span>New Task</span>
          <span className="rg-shortcut">Cmd N</span>
        </button>

        <section className="rg-agents">
          <div className="rg-section-title">
            <span>AGENTS</span>
            <button type="button" title="Go to setup" onClick={() => navigate('/setup')}>+</button>
          </div>
          {agents.map((agent, index) => (
            <div
              className={`rg-agent-row ${selectedAgent === agent.name ? 'is-selected' : ''} ${!agent.installed ? 'is-uninstalled' : ''}`}
              key={agent.name}
              aria-disabled={!agent.installed}
              title={agent.installed ? `${agent.name} runtime` : `${agent.name} is not installed`}
              onClick={() => {
                if (!agent.installed) {
                  showInstallHint(agent.name);
                  return;
                }
                setSelectedAgent(agent.name);
              }}
              style={{ top: 18 + index * 36 }}
            >
              <span className={`rg-agent-mark ${agent.className}`}>{agentIcon(agent.name)}</span>
              <span className="rg-agent-copy">
                <span className="rg-agent-name">{agent.name}</span>
                <span className="rg-agent-state">
                  <StatusDot tone={agent.status === 'Running' ? 'success' : agent.installed ? 'muted' : 'warning'} />
                  {agent.status}
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
                {agent.installed ? creatingAgent === agent.name ? '...' : 'Open' : 'Setup'} <ChevronRight />
              </button>
            </div>
          ))}
        </section>

        <section className="rg-tools">
          <div className="rg-tools-title">
            <span>TOOLS</span>
            <button type="button" onClick={() => setActiveRuntimeGuardModal('tools')}>View All</button>
          </div>
          {sidebarTools.map((tool, index) => {
            const ToolIcon = tool.icon;
            return (
              <div className="rg-tool-row" key={tool.name} style={{ top: 20 + index * 23 }}>
                <ToolIcon />
                <span>{tool.name}</span>
                <span className={`rg-tool-${tool.tone}`}>{tool.status}</span>
              </div>
            );
          })}
        </section>

        <button className={`rg-budget ${selectedBudgetOverLimit ? 'is-over-limit' : ''}`} onClick={openBudgetModal} type="button">
          <div className="rg-budget-title">BUDGET - {selectedBudgetAgentName}</div>
          <div className="rg-budget-metrics">
            <div className="rg-budget-metric-row">
              <span>Spent</span>
              <strong className="rg-budget-metric-value is-spent">{budgetDisplayCostText}</strong>
            </div>
            {budgetConfigured && (
              <div className="rg-budget-metric-row">
                <span>Limit</span>
                <strong className="rg-budget-metric-value is-limit">{budgetLimitText}</strong>
              </div>
            )}
          </div>
          <div className="rg-budget-bar"><span style={{ width: `${budgetBarPercent}%` }} /></div>
          <div className="rg-budget-percent">{budgetConfigured ? `${Math.round(budgetPercent)}%` : ''}</div>
          <div className="rg-budget-reset">{selectedBudgetOverLimit ? `${selectedBudgetAgentName} budget reached` : budgetResetText}</div>
        </button>

        <section className="rg-user">
          <span className="rg-avatar"><User /></span>
          <span>XClaw User</span>
          <ChevronDown />
        </section>

        <div className="rg-bottom-icons">
          <button type="button" title="Open monitor" onClick={() => navigate('/monitor')}><Settings /></button>
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
                  {agentIcon(session.agent)}
                </span>
                <span className="rg-chat-tab-title">{session.title}</span>
                <span
                  className="rg-chat-tab-close"
                  role="button"
                  tabIndex={0}
                  title="Close session"
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
          <h1>{activeSession ? activeSession.title : '暂无会话内容'}</h1>
          <p>
            {activeSession
              ? `${formatSessionStart(activeSession.createdAt)}  -  ${activeSession.displayName || activeSession.agent}  -  ${activeSession.platform}  -  ${activeSession.instanceId || 'runtime'}`
              : '使用 New Task、+ 或 Agent Open 创建真实会话'}
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
              <Lock /> Guard: {guardModeSyncing ? 'Updating' : guardMode} <ChevronDown />
            </button>
            {autoApprovalOpen && (
              <div className="rg-auto-approval-menu" role="listbox" aria-label="Guard mode">
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
                    <span>{mode}</span>
                    {mode === guardMode && <Check />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rg-task-panel">
          {!activeSession ? (
            <div className="rg-empty-task">
              <strong>暂无会话内容</strong>
              <span>点击 New Task、+ 或 Agent Open 创建真实会话。</span>
            </div>
          ) : (
            <>
              <div className="rg-task-scroll" ref={taskScrollRef}>
                {loadingHistory === activeSession.sessionKey ? (
                  <div className="rg-loading-history"><Loader2 className="is-spinning" /> Loading history...</div>
                ) : activeMessages.length === 0 && activeApprovalCards.length === 0 ? (
                  <div className="rg-session-empty">
                    <Bot />
                    <strong>{activeSession.agent} session ready</strong>
                    <span>发送第一条消息后，assistant、tool 和 trace 事件会显示在这里。</span>
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
                      />
                    )
                  ))
                )}
              </div>

              <div className={`rg-command-input ${budgetOverLimit ? 'is-budget-blocked' : ''}`}>
                <textarea
                  ref={textareaRef}
                  aria-label={`Ask ${activeAgent}`}
                  disabled={budgetOverLimit || activeSending}
                  onChange={(event) => updateActiveDraft(event.target.value)}
                  onCompositionEnd={() => setIsComposing(false)}
                  onCompositionStart={() => setIsComposing(true)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={budgetOverLimit ? `${activeBudgetAgentName} budget reached` : `Ask ${activeAgent} ...`}
                  rows={2}
                  value={activeDraft}
                />
                <span className="rg-command-shortcuts">
                  {budgetOverLimit
                    ? `Resets in ${formatBudgetRefreshTime(activeBudgetRemainingMs)}`
                    : 'Enter Send    Shift Enter New Line'}
                </span>
                <button
                  disabled={budgetOverLimit || activeSending || !activeDraft.trim()}
                  onClick={handleSend}
                  type="button"
                  title={budgetOverLimit ? `${activeBudgetAgentName} budget reached` : 'Send message'}
                >
                  {activeSending ? <Loader2 className="is-spinning" /> : <Send />}
                </button>
              </div>
            </>
          )}
        </section>

        <footer className="rg-statusbar">
          <StatusDot tone="success" />
          <span className="rg-status-active">Runtime Guard Active</span>
          <span>Events: {activeMessages.length}</span>
          <span>Blocked: {activeMessages.filter(message => message.role === 'error').length}</span>
          <span>Warnings: {activeMessages.filter(message => message.role === 'trace' && message.trace_type?.includes('approval')).length}</span>
        </footer>

      </main>
      </div>
      <div className="rg-right-scale" style={rightScaleStyle}>
        <section className="rg-session-history">
          <div className="rg-card-head rg-session-history-head">
            <span>SESSION HISTORY</span>
            <button
              type="button"
              onClick={() => {
                void fetchSessionHistory(false);
                setActiveRuntimeGuardModal('sessions');
              }}
            >
              View All
            </button>
          </div>
          <div className="rg-session-history-list">
            {sessionHistoryPreviewItems.length > 0 ? (
              sessionHistoryPreviewItems.map(session => {
                const status = sessionHistoryStatus(session, activeSessionId);
                return (
                  <button
                    className="rg-session-history-row"
                    key={session.sessionKey}
                    onClick={() => openHistorySession(session)}
                    type="button"
                  >
                    <span className="rg-session-history-time">{formatSessionHistoryTime(session.createdAt)}</span>
                    <div className="rg-session-history-main">
                      <strong>{session.agent}</strong>
                      <span>{session.title}</span>
                    </div>
                    <em className={status === 'Active' ? 'is-active' : ''}>{status}</em>
                  </button>
                );
              })
            ) : (
              <div className="rg-session-history-empty">
                {sessionHistoryLoading ? 'Loading history...' : 'No session history'}
              </div>
            )}
          </div>
        </section>
        <aside className="rg-right-panel">
          <section className="rg-approval-center">
            <div className="rg-card-head rg-approval-head">
              <span>APPROVAL CENTER</span>
              <span className="rg-count">{approvalCount}</span>
              <button type="button" onClick={() => setActiveRuntimeGuardModal('approvals')}>View All</button>
            </div>
            {visibleApprovals.length > 0 ? (
              visibleApprovals.map((item, index) => (
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
                {approvalLoading ? 'Loading approvals...' : 'No pending approvals'}
              </div>
            )}
          </section>

          <section className="rg-guard-status">
            <div className="rg-card-head">
              <span>GUARD STATUS</span>
              <span className={`rg-secure rg-status-${guardStatusSummary.tone}`}>
                {guardStatusSummary.tone === 'attention'
                  ? <AlertTriangle />
                  : guardStatusSummary.tone === 'off'
                    ? <Lock />
                    : <Check />}
                {guardStatusSummary.label}
              </span>
            </div>
            <div className={`rg-score-ring rg-score-${guardStatusSummary.tone}`}>
              <strong>{guardStatusSummary.score}</strong>
              <span>/100</span>
            </div>
            <div className="rg-guard-list">
              {guardStatusRows.map(({ label, status, tone }) => (
                <div className="rg-guard-row" key={label}>
                  <StatusDot tone={tone} />
                  <span>{label}</span>
                  <strong className={`rg-tool-${tone}`}>{status}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rg-recent-blocked">
            <div className="rg-card-head rg-recent-head">
              <span>RECENT BLOCKED</span>
              <button type="button" onClick={() => setActiveRuntimeGuardModal('blocked')}>View All</button>
            </div>
            {recentBlockedItems.length > 0 ? (
              recentBlockedItems.map((item, index) => (
                <div className="rg-block-row" key={item.id} style={{ top: 28 + index * 16 }}>
                  <span>{formatBlockedTime(item.timestamp)}</span>
                  <strong>Blocked</strong>
                  <span>{blockedDisplayText(item)}</span>
                </div>
              ))
            ) : (
              <div className="rg-block-empty">
                {blockedLoading ? 'Loading blocked...' : 'No recent blocked'}
              </div>
            )}
          </section>
        </aside>
      </div>
      <div className="rg-version">
        <span>{xsafeclawVersionLabel}</span>
        <Shield />
      </div>
    </div>
  );
}
