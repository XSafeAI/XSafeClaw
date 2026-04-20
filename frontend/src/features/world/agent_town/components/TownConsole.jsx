import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAR_BASE, CHAR_NAMES, USE_AGENT_TOWN_MOCK, buildStableCharNameMap, hashAgentCharIndex, DEMO_MODE, DEMO_CHAR_NAME, markDemoSession, isDemoSession } from '../config/constants';
import {
  buildMockAssistantReply,
  buildMockHistory,
  generateMockData,
  MOCK_MODEL_PROVIDERS,
  normalizeTownData,
} from '../data/mockData';
import { systemAPI } from '../../../../services/api';
import { useI18n } from '../../../../i18n';
import ControlTab from './ControlTab';
import CrewTab from './CrewTab';
import ModelSetupModal from './ModelSetupModal';
import { getAgentTownText } from '../i18n';

const TAB_META = [
  { id: 'crew', label: 'Agents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'control', label: 'Control' },
];

const FILTER_IDS = ['working', 'pending', 'offline'];

const TASK_STATUS_META = {
  ok: { label: 'COMPLETE', className: 'tc-task-complete' },
  running: { label: 'RUNNING', className: 'tc-task-running' },
  pending: { label: 'PENDING', className: 'tc-task-flagged' },
  completed: { label: 'COMPLETED', className: 'tc-task-complete' },
  error: { label: 'ERROR', className: 'tc-task-failed' },
  failed: { label: 'FAILED', className: 'tc-task-failed' },
};
TASK_STATUS_META.fail = TASK_STATUS_META.failed;

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shortId(value) {
  return String(value || '').slice(0, 8);
}

function normalizeInputModes(input) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input.split('+').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeSessionIdentity(value) {
  const text = String(value || '');
  return text.startsWith('agent:main:') ? text.slice('agent:main:'.length) : text;
}

function normalizeModelMatchToken(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSearchToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s./_-]+/g, '');
}

function getConfiguredModelMatchKeys(model) {
  const fullId = normalizeModelMatchToken(model?.id);
  const shortId = fullId.includes('/') ? fullId.split('/').slice(1).join('/') : fullId;
  const displayName = normalizeModelMatchToken(model?.name);
  return new Set([fullId, shortId, displayName].filter(Boolean));
}

function matchConfiguredModelToAgent(model, agent) {
  const agentModel = normalizeModelMatchToken(agent?.model);
  if (!agentModel) return false;

  const agentProvider = normalizeModelMatchToken(agent?.provider);
  const modelProvider = normalizeModelMatchToken(model?.provider);
  if (agentProvider && modelProvider && agentProvider !== modelProvider) {
    return false;
  }

  return getConfiguredModelMatchKeys(model).has(agentModel);
}

function getAgentRecencyValue(agent) {
  const candidates = [
    agent?.first_seen_at,
    agent?.updated_at,
    agent?.created_at,
    agent?.started_at,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate > 1_000_000_000_000 ? candidate : candidate * 1000;
    }
    const parsed = Date.parse(String(candidate || ''));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function getAgentSessionKey(agent) {
  return agent?.session_key || '';
}

function getAgentIdentity(agent) {
  return normalizeSessionIdentity(getAgentSessionKey(agent) || agent?.id || '');
}

function resolveDateLocale(locale = 'en') {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

function fmtTime(ts, locale = 'en') {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString(resolveDateLocale(locale), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

function fmtDate(ts, locale = 'en') {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(resolveDateLocale(locale), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

function fmtExactDate(ts, locale = 'en') {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(resolveDateLocale(locale), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

function fmtRelative(ts) {
  if (!ts) return 'now';
  try {
    const diff = Math.max(0, Date.now() - new Date(ts).getTime());
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour}h ago`;
    return `${Math.round(hour / 24)}d ago`;
  } catch {
    return 'now';
  }
}

function fmtTokens(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '---';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${(n / 1000000).toFixed(1)}m`;
}

function durationStr(startTs, endTs, locale = 'en') {
  const start = startTs ? new Date(startTs).getTime() : NaN;
  const end = endTs ? new Date(endTs).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '---';
  const totalSec = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (locale === 'zh') {
    if (hours > 0) return `${hours}小时 ${minutes}分`;
    if (minutes > 0) return `${minutes}分 ${seconds}秒`;
    return `${seconds}秒`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getAgentState(status) {
  if (status === 'working' || status === 'running' || status === 'idle') return 'working';
  return status || 'offline';
}

function pickEventSnippet(event) {
  const conversations = event?.conversations || [];
  for (let i = conversations.length - 1; i >= 0; i -= 1) {
    const msg = conversations[i];
    if ((msg.role === 'assistant' || msg.role === 'user') && (msg.text || msg.content_text)) {
      return (msg.text || msg.content_text || '').slice(0, 140);
    }
  }
  return '';
}

function readFetchError(response, fallbackText) {
  return response.json()
    .then((json) => json?.detail || json?.message || fallbackText)
    .catch(() => fallbackText);
}

function isAbortError(err) {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError';
}

function extractMessageText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (typeof msg.text === 'string') return msg.text;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('');
  }
  return '';
}

function normalizeHistoryMessage(msg) {
  if (!msg) return null;
  if (msg.role === 'tool_call') {
    return {
      id: msg.id || makeId(),
      role: 'tool_call',
      content: '',
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
      tool_id: msg.tool_id,
      tool_name: msg.tool_name,
      args: msg.args,
      result: msg.result,
      is_error: msg.is_error,
      result_pending: Boolean(msg.result_pending),
    };
  }

  if (msg.role === 'user' || msg.role === 'assistant') {
    const text = typeof msg.content === 'string' ? msg.content : extractMessageText(msg);
    if (!text.trim()) return null;
    return {
      id: msg.id || makeId(),
      role: msg.role,
      content: text,
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
    };
  }

  return null;
}

function isNanobotAgent(agent) {
  return (
    agent?.platform === 'nanobot'
    || String(agent?.instance_id || '').startsWith('nanobot')
    || String(agent?.session_key || '').startsWith('nanobot::')
  );
}

function buildDraftAgent(sessionKey, modelOption, runtimeInstance = null) {
  const modelRef = modelOption?.id || 'unknown/model';
  const provider = modelOption?.provider || modelRef.split('/')[0] || 'unknown';
  const modelName = modelOption?.name || modelRef.split('/').slice(1).join('/') || modelRef;
  const platform = runtimeInstance?.platform || 'openclaw';
  const instanceId = runtimeInstance?.instance_id || 'openclaw-default';
  const suffix = shortId(normalizeSessionIdentity(sessionKey)).toUpperCase();
  return {
    id: `draft:${sessionKey}`,
    session_key: sessionKey,
    platform,
    instance_id: instanceId,
    name: `Agent-${suffix}`,
    pid: suffix,
    provider,
    model: modelName,
    status: 'working',
    first_seen_at: new Date().toISOString(),
    channel: platform === 'nanobot' ? 'nanobot-gateway' : 'webchat',
    dialog_turns_total: 0,
    human_interventions_total: 0,
    activity_heat_24h: new Array(24).fill(0),
    working_heat_score: 0,
    working_heat_label: 'dormant',
    draft: true,
  };
}

function mergeAgents(traceAgents, draftAgents) {
  const traceKeys = new Set(traceAgents.map((agent) => getAgentIdentity(agent)).filter(Boolean));
  return [
    ...draftAgents.filter((agent) => !traceKeys.has(getAgentIdentity(agent))),
    ...traceAgents,
  ];
}

function buildConsoleData(traceJson) {
  if (USE_AGENT_TOWN_MOCK) {
    return normalizeTownData(generateMockData());
  }
  return normalizeTownData(traceJson);
}

function mapDashboardTaskStatus(status) {
  if (status === 'completed' || status === 'ok') return 'completed';
  if (status === 'error') return 'error';
  if (status === 'fail' || status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  if (status === 'running') return 'running';
  return 'running';
}

function mockUserMessagePreviewFromConversations(event) {
  const conversations = event?.conversations || [];
  for (let i = 0; i < conversations.length; i += 1) {
    const msg = conversations[i];
    if (msg.role === 'user' && (msg.text || msg.content_text)) {
      return String(msg.text || msg.content_text || '').trim().slice(0, 280);
    }
  }
  return null;
}

function buildMockDashboardEvents(events = []) {
  return events.map((event) => ({
    id: event.event_id,
    session_id: event.agent_id,
    started_at: event.start_time,
    completed_at: event.end_time || null,
    total_messages: event.conversations?.length || 0,
    total_tool_calls: (event.conversations || []).reduce((count, msg) => (
      count + (Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0)
    ), 0),
    total_tokens: 0,
    status: event.status === 'ok'
      ? 'completed'
      : event.status === 'error'
        ? 'error'
        : event.status === 'fail' || event.status === 'failed'
          ? 'failed'
          : event.status === 'running'
            ? 'running'
            : 'pending',
    error_message: event.status === 'error' ? pickEventSnippet(event) : null,
    user_message_preview: mockUserMessagePreviewFromConversations(event),
  }));
}

function buildMockPendingApprovals(agents = [], events = []) {
  const agentsById = Object.fromEntries(agents.map((agent) => [agent.id, agent]));
  return events
    .filter((event) => event.status === 'pending')
    .slice(0, 4)
    .map((event, index) => {
      const agent = agentsById[event.agent_id];
      return {
        id: `mock-pending-${index}`,
        session_key: agent?.session_key || '',
        tool_name: event.event_type || 'tool-call',
        guard_verdict: 'unsafe',
        risk_source: 'Manual review required',
        failure_mode: pickEventSnippet(event) || 'This run is waiting for a human reviewer before it can continue.',
        real_world_harm: null,
        created_at: Date.now() / 1000 - index * 75,
        resolved: false,
      };
    });
}

function buildTaskTimeKey(sessionId, ts) {
  if (!sessionId || !ts) return '';
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? `${sessionId}:${ms}` : `${sessionId}:${ts}`;
}

/** Aligns with backend Event.status buckets used in the Agents tab summary. */
function mapToSummaryBucket(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running') return 'running';
  if (s === 'pending') return 'pending';
  if (s === 'completed' || s === 'ok') return 'completed';
  if (s === 'error') return 'error';
  if (s === 'fail' || s === 'failed') return 'failed';
  return 'running';
}

/**
 * Count persisted **Event** rows by `Event.status` (same five buckets as Monitor).
 * Source: `GET /api/events` only — **not** `/api/trace` (trace is for roster / heat / messages).
 *
 * @param {Array} eventRows — All events (Tasks tab) or one agent’s rows keyed by `Event.session_id` (Agents tab).
 */
function aggregateTaskStatusCounts(eventRows = []) {
  const summary = { running: 0, pending: 0, completed: 0, error: 0, failed: 0 };
  const bump = (bucket) => {
    if (Object.prototype.hasOwnProperty.call(summary, bucket)) summary[bucket] += 1;
  };
  eventRows.forEach((ev) => {
    bump(mapToSummaryBucket(ev?.status));
  });
  return summary;
}

function isTaskTerminalStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'completed' || s === 'ok' || s === 'error' || s === 'fail' || s === 'failed';
}

function applyPendingStatusToAgents(agents = [], pendingApprovals = []) {
  const pendingSessionKeys = new Set(
    (pendingApprovals || [])
      .filter((item) => item && !item.resolved && item.session_key)
      .map((item) => item.session_key),
  );
  if (pendingSessionKeys.size === 0) return agents;

  return agents.map((agent) => {
    const sessionKey = getAgentSessionKey(agent);
    if (!sessionKey || !pendingSessionKeys.has(sessionKey)) return agent;
    if (String(agent?.status || '').toLowerCase() === 'offline') return agent;
    if (agent.status === 'pending') return agent;
    return { ...agent, status: 'pending' };
  });
}

function applyPendingStatusToDashboardEvents(eventRows = [], pendingApprovals = [], agentsBySessionKey = {}) {
  if (!Array.isArray(eventRows) || eventRows.length === 0) return eventRows;
  const patched = eventRows.map((event) => ({ ...event }));
  const unresolved = (pendingApprovals || []).filter((item) => item && !item.resolved && item.session_key);
  if (unresolved.length === 0) return patched;

  unresolved.forEach((item) => {
    const sessionIds = new Set();
    sessionIds.add(item.session_key);
    const liveAgent = agentsBySessionKey[item.session_key];
    if (liveAgent?.id) sessionIds.add(liveAgent.id);

    let bestIndex = -1;
    let bestTime = -Infinity;
    patched.forEach((event, index) => {
      if (!sessionIds.has(event?.session_id)) return;
      if (isTaskTerminalStatus(event?.status)) return;
      const startedAt = new Date(event?.started_at || 0).getTime();
      const stamp = Number.isFinite(startedAt) ? startedAt : 0;
      if (stamp >= bestTime) {
        bestTime = stamp;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0) {
      patched[bestIndex].status = 'pending';
    }
  });

  return patched;
}

function formatTaskId(value, length = 12) {
  return String(value || '').slice(0, length) || '---';
}

/** One-line preview for task cards / modal — list API `user_message_preview`, then error, then id. */
function dashboardTaskListSnippet(task, userMessageLabel = 'user_message') {
  const user = String(task?.user_message_preview || '').trim();
  if (user) return user.slice(0, 180);
  const err = String(task?.error_message || '').trim();
  if (err) return err.slice(0, 180);
  const uid = task?.user_message_id;
  if (uid) return `${userMessageLabel} ${String(uid).slice(0, 28)}`;
  return '—';
}

function extractPendingContextSnippet(item) {
  const text = String(item?.session_context || '').trim();
  const userMark = text.indexOf('[USER]:');
  if (userMark >= 0) {
    const sliced = text.slice(userMark + '[USER]:'.length).trim();
    const nextAgent = sliced.indexOf('[AGENT]:');
    const nextEnv = sliced.indexOf('[ENVIRONMENT]:');
    const candidates = [nextAgent, nextEnv].filter((index) => index >= 0);
    const boundary = candidates.length ? Math.min(...candidates) : sliced.length;
    return sliced.slice(0, boundary).trim().slice(0, 180);
  }
  return text.slice(0, 180);
}

function stringifyTaskValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeTaskDetailMessages(messages = [], idPrefix = 'event') {
  const normalized = [];

  const tryAttachToolResult = (text, isError) => {
    for (let i = normalized.length - 1; i >= 0; i -= 1) {
      const prev = normalized[i];
      if (prev?.role !== 'tool_call') continue;
      if (!prev.tool_result) {
        prev.tool_result = text;
        prev.is_error = prev.is_error || isError;
        return true;
      }
      if (String(prev.tool_result) === String(text)) {
        return true;
      }
      return false;
    }
    return false;
  };

  messages.forEach((msg, index) => {
    if (!msg) return;
    const role = msg.role === 'tool' ? 'toolResult' : msg.role;
    const contentText = msg.content_text || msg.text || msg.content || '';

    if ((role === 'user' || role === 'assistant' || role === 'error') && String(contentText).trim()) {
      normalized.push({
        message_id: msg.message_id || msg.id || `${idPrefix}-${index}`,
        role,
        timestamp: msg.timestamp,
        content_text: contentText,
      });
    }

    const toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map((tc, toolIndex) => ({
          id: tc.id || `${idPrefix}-tool-${index}-${toolIndex}`,
          tool_name: tc.tool_name || 'tool-call',
          arguments: tc.arguments || null,
        }))
      : role === 'tool_call'
        ? [{
            id: msg.tool_id || msg.id || `${idPrefix}-tool-${index}`,
            tool_name: msg.tool_name || 'tool-call',
            arguments: msg.args ?? msg.arguments ?? null,
            result: msg.result,
            is_error: Boolean(msg.is_error),
            result_pending: Boolean(msg.result_pending),
          }]
        : [];

    toolCalls.forEach((toolCall, toolIndex) => {
      normalized.push({
        message_id: toolCall.id || `${idPrefix}-tool-${index}-${toolIndex}`,
        role: 'tool_call',
        timestamp: msg.timestamp,
        tool_name: toolCall.tool_name || 'tool-call',
        tool_arguments: toolCall.arguments ?? null,
        tool_result: toolCall.result ?? '',
        is_error: Boolean(toolCall.is_error),
        result_pending: Boolean(toolCall.result_pending),
      });
    });

    if (role === 'toolResult' && String(contentText).trim()) {
      if (tryAttachToolResult(contentText, Boolean(msg.is_error))) return;
      normalized.push({
        message_id: msg.message_id || msg.id || `${idPrefix}-tool-result-${index}`,
        role: 'tool_call',
        timestamp: msg.timestamp,
        tool_name: msg.tool_name || 'tool-call',
        tool_arguments: null,
        tool_result: contentText,
        is_error: Boolean(msg.is_error),
        result_pending: false,
      });
    }
  });

  return normalized;
}

function TaskActorStrip({ charName, agentId }) {
  const [failed, setFailed] = useState(false);
  const spriteUrl = `${CHAR_BASE}${charName}_idle_anim_32x32.png`;
  return (
    <div className="tc-task-actor-strip">
      <div className="tc-task-actor-meta">
        <div className="tc-task-actor-label">AGENT ID</div>
        <div className="tc-task-actor-id">{shortId(agentId || '---')}</div>
      </div>
      {!failed ? (
        <div className="tc-task-actor-portrait">
          <div className="tc-task-actor-portrait-crop">
            <img
              className="tc-task-actor-portrait-img"
              src={spriteUrl}
              alt={`${charName} portrait`}
              draggable={false}
              onError={() => setFailed(true)}
            />
          </div>
        </div>
      ) : (
        <div className="tc-task-actor-avatar">{charName.slice(0, 2).toUpperCase()}</div>
      )}
    </div>
  );
}

function taskDetailToneFromStatus(status) {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'error' || status === 'fail') return 'danger';
  if (status === 'pending' || status === 'running') return 'warn';
  return 'neutral';
}

function TaskDetailFact({
  label,
  value,
  mono = false,
  featured = false,
  wide = false,
  tone = 'neutral',
}) {
  return (
    <div
      className={[
        'tc-task-detail-fact',
        mono ? 'tc-task-detail-fact-mono' : '',
        featured ? 'tc-task-detail-fact-featured' : '',
        wide ? 'tc-task-detail-fact-wide' : '',
        `tc-task-detail-fact-tone-${tone}`,
      ].filter(Boolean).join(' ')}
    >
      <div className="tc-task-detail-fact-label">{label}</div>
      <div className="tc-task-detail-fact-value">{value || '---'}</div>
    </div>
  );
}

function TaskDetailMessage({ msg }) {
  const { locale } = useI18n();
  const taskText = getAgentTownText(locale).tasks;
  const timestamp = fmtDate(msg.timestamp, locale);
  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';
  const isTool = msg.role === 'tool_call';
  const hasToolCall = msg.tool_arguments !== null && msg.tool_arguments !== undefined && msg.tool_arguments !== '';
  const hasToolResult = msg.result_pending || (msg.tool_result !== null && msg.tool_result !== undefined && msg.tool_result !== '');

  return (
    <div className="tc-task-detail-entry">
      {(isUser || isAssistant) && msg.content_text ? (
        <div className={`tc-task-detail-bubble ${isUser ? 'tc-task-detail-bubble-user' : 'tc-task-detail-bubble-assistant'}`}>
          <div className="tc-task-detail-bubble-head">
            <span className="tc-task-detail-role">{isUser ? taskText.userTag : taskText.assistantTag}</span>
            <span className="tc-task-detail-time">{timestamp}</span>
          </div>
          <div className="tc-task-detail-text">{msg.content_text}</div>
        </div>
      ) : null}

      {isTool ? (
        <div
          className={`tc-task-detail-tool tc-task-detail-tool-card${msg.is_error ? ' tc-task-detail-tool--error' : ''}`}
        >
          <div className="tc-task-detail-tool-head tc-task-detail-tool-head-main">
            <span className="tc-task-detail-tool-tag">
              {msg.result_pending ? taskText.runningTag : msg.is_error ? taskText.errorTag : taskText.toolTag}
            </span>
            <span className="tc-task-detail-tool-name">{msg.tool_name || taskText.toolCallFallback}</span>
            <span className="tc-task-detail-time">{timestamp}</span>
          </div>
          {(hasToolCall || hasToolResult) ? (
            <div className="tc-task-detail-tool-body">
              {hasToolCall ? (
                <div className="tc-task-detail-tool-block tc-task-detail-tool-block-call">
                  <div className="tc-task-detail-tool-subhead">{taskText.toolCall}</div>
                  <pre className="tc-task-detail-tool-payload">{stringifyTaskValue(msg.tool_arguments)}</pre>
                </div>
              ) : null}
              {hasToolResult ? (
                <div className="tc-task-detail-tool-block tc-task-detail-tool-block-result">
                  <div className="tc-task-detail-tool-subhead">{taskText.toolResult}</div>
                  <pre className="tc-task-detail-tool-payload">
                    {msg.result_pending ? taskText.runningResult : stringifyTaskValue(msg.tool_result)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getEffectiveRisk(item) {
  if (item.risk_source || item.failure_mode || item.real_world_harm) {
    return { risk_source: item.risk_source, failure_mode: item.failure_mode, real_world_harm: item.real_world_harm };
  }
  if (!item.guard_raw) return null;
  const lines = item.guard_raw.split('\n').map((l) => l.trim()).filter(Boolean);
  let rs = null, fm = null, rwh = null;
  const desc = [];
  for (const line of lines) {
    const bare = line.replace(/^[-*•]+\s*/, '').replace(/\*\*/g, '');
    const lc = bare.toLowerCase();
    if (lc === 'unsafe' || lc === 'safe') continue;
    if (lc.startsWith('risk source:') || lc.startsWith('risk_source:')) {
      rs = bare.substring(bare.indexOf(':') + 1).trim();
    } else if (lc.startsWith('failure mode:') || lc.startsWith('failure_mode:')) {
      fm = bare.substring(bare.indexOf(':') + 1).trim();
    } else if (/^real[_\s-]*world[_\s]*harm:/i.test(lc)) {
      rwh = bare.substring(bare.indexOf(':') + 1).trim();
    } else if (bare) {
      desc.push(bare);
    }
  }
  if (rs || fm || rwh) return { risk_source: rs, failure_mode: fm, real_world_harm: rwh };
  const fallback = desc.join(' ').substring(0, 300);
  return fallback ? { risk_source: null, failure_mode: fallback, real_world_harm: null } : null;
}

function TasksTab({
  dashboardEvents,
  pendingApprovals,
  agentsById,
  agentsBySessionKey,
  charNameMap,
  onResolveGuardPending,
  guardResolvingId,
  guardEnabled = false,
  onToggleGuard,
  onTaskDetailChange,
  taskStatusMeta = TASK_STATUS_META,
}) {
  const { locale } = useI18n();
  const townText = getAgentTownText(locale);
  const taskText = townText.tasks;
  const [selectedTask, setSelectedTask] = useState(null);
  const [detailMessages, setDetailMessages] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailEventData, setDetailEventData] = useState(null);

  const closeTaskDetail = useCallback(() => {
    setSelectedTask(null);
    setDetailMessages([]);
    setDetailError('');
    setDetailEventData(null);
  }, []);

  const resolvePending = useCallback(async (item, resolution) => {
    if (!onResolveGuardPending || !item?.id) return;
    await onResolveGuardPending(item.id, resolution);
    setSelectedTask((prev) => (
      prev?.kind === 'pending' && prev.item?.id === item.id ? null : prev
    ));
  }, [onResolveGuardPending]);

  useEffect(() => {
    if (!selectedTask) {
      setDetailMessages([]);
      setDetailError('');
      setDetailEventData(null);
    }
    onTaskDetailChange?.(!!selectedTask);
  }, [selectedTask, onTaskDetailChange]);

  const unresolvedApprovals = useMemo(
    () => pendingApprovals
      .filter((item) => !item.resolved)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    [pendingApprovals]
  );

  const sortedDashboardEvents = useMemo(
    () => [...dashboardEvents].sort((a, b) => (
      new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime()
    )),
    [dashboardEvents]
  );

  /** Cross-agent: every **Event** in the list response — `Event.status` buckets summed over all sessions. */
  const taskBoardSummary = useMemo(
    () => aggregateTaskStatusCounts(sortedDashboardEvents),
    [sortedDashboardEvents],
  );

  const openPendingApproval = useCallback((item, index) => {
    const liveAgent = agentsBySessionKey[item.session_key];
    const charName = liveAgent
      ? (charNameMap[liveAgent.id] || CHAR_NAMES[index % CHAR_NAMES.length])
      : CHAR_NAMES[index % CHAR_NAMES.length];

    const agentId = liveAgent?.id || item.session_key || item.id;
    const matchingEvent = dashboardEvents.find(
      (ev) => ev.session_id === agentId || ev.session_id === item.session_key,
    );

    setSelectedTask({
      kind: 'pending',
      item,
      task: matchingEvent || null,
      charName,
      agentId,
      agentName: liveAgent?.name || `${taskText.agentFallbackPrefix}-${shortId(agentId)}`,
      promptSnippet: extractPendingContextSnippet(item),
    });
    setDetailMessages([]);
    setDetailError('');
    setDetailEventData(null);
  }, [agentsBySessionKey, charNameMap, dashboardEvents, taskText.agentFallbackPrefix]);

  const openDashboardTask = useCallback((task, index) => {
    const liveAgent = agentsById[task.session_id];
    const charName = liveAgent
      ? (charNameMap[liveAgent.id] || CHAR_NAMES[index % CHAR_NAMES.length])
      : CHAR_NAMES[index % CHAR_NAMES.length];

    setSelectedTask({
      kind: 'dashboard',
      task,
      charName,
      agentId: liveAgent?.id || task.session_id,
      agentName: liveAgent?.name || `${taskText.agentFallbackPrefix}-${shortId(task.session_id)}`,
      promptSnippet: dashboardTaskListSnippet(task, taskText.userMessageShort),
    });
    setDetailError('');
    setDetailEventData(null);
  }, [agentsById, charNameMap, taskText.agentFallbackPrefix, taskText.userMessageShort]);

  useEffect(() => {
    if (!selectedTask) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeTaskDetail();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeTaskDetail, selectedTask]);

  useEffect(() => {
    let disposed = false;

    const eventId = selectedTask?.kind === 'dashboard'
      ? selectedTask.task?.id
      : selectedTask?.kind === 'pending'
        ? selectedTask.task?.id
        : null;

    if (!selectedTask || !eventId) {
      setDetailMessages([]);
      setDetailLoading(false);
      setDetailEventData(null);
      return () => { disposed = true; };
    }

    if (USE_AGENT_TOWN_MOCK) {
      setDetailMessages([]);
      setDetailLoading(false);
      setDetailEventData(null);
      return () => { disposed = true; };
    }

    const loadDetail = async () => {
      setDetailLoading(true);
      try {
        const response = await fetch(`/api/events/${eventId}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`${taskText.loadFailedWithStatus}: ${response.status}`);
        }
        const payload = await response.json();
        if (disposed) return;
        const messages = normalizeTaskDetailMessages(Array.isArray(payload.messages) ? payload.messages : [], eventId);
        setDetailEventData(payload);
        setDetailMessages(messages.length ? messages : []);
      } catch (err) {
        console.warn('[TownConsole] task detail fetch error:', err);
        if (disposed) return;
        setDetailEventData(null);
        setDetailMessages([]);
        setDetailError(err instanceof Error ? err.message : taskText.loadFailed);
      } finally {
        if (!disposed) setDetailLoading(false);
      }
    };

    loadDetail();
    return () => { disposed = true; };
  }, [selectedTask, taskText.loadFailed, taskText.loadFailedWithStatus]);

  const detailTask = (selectedTask?.kind === 'dashboard' || selectedTask?.kind === 'pending')
    ? (detailEventData || selectedTask.task)
    : null;
  const detailStatusId = selectedTask?.kind === 'pending'
    ? 'pending'
    : mapDashboardTaskStatus(detailTask?.status || selectedTask?.task?.status);

  return (
    <div className="tc-task-layout">
      <section className="tc-ornate-panel tc-task-lane tc-task-lane-pending">
        <div className="tc-task-lane-head">
          <div>
            <div className="tc-task-lane-overline">{taskText.pendingOverline}</div>
            <div className="tc-task-lane-title">{taskText.pendingTitle}</div>
          </div>
          <div className="tc-task-lane-count tc-task-lane-count-pending">{unresolvedApprovals.length}</div>
        </div>
        <div className="tc-task-lane-note">
          {taskText.pendingNote}
        </div>
        {!guardEnabled && (
          <div className="tc-guard-off-banner">
            <span className="tc-guard-off-icon">⚠</span>
            <div className="tc-guard-off-text">
              <strong>{taskText.guardOffTitle}</strong>
              <span>{taskText.guardOffDescription}</span>
            </div>
            <button className="tc-guard-off-btn" onClick={onToggleGuard}>{taskText.enableGuard}</button>
          </div>
        )}
        <div className="tc-task-lane-list tc-task-lane-list-pending">
          {unresolvedApprovals.length === 0 ? (
            <div className="tc-empty tc-task-empty-pending">{taskText.noPending}</div>
          ) : unresolvedApprovals.map((item, index) => {
            const liveAgent = agentsBySessionKey[item.session_key];
            const charName = liveAgent
              ? (charNameMap[liveAgent.id] || CHAR_NAMES[index % CHAR_NAMES.length])
              : CHAR_NAMES[index % CHAR_NAMES.length];
            const promptSnippet = extractPendingContextSnippet(item)
              || item.failure_mode
              || item.risk_source
              || taskText.waitingReviewer;
            return (
              <div
                key={item.id}
                className={`tc-task-card tc-task-card-pending-review ${selectedTask?.kind === 'pending' && selectedTask.item.id === item.id ? 'tc-task-card-selected' : ''}`}
              >
                <button
                  type="button"
                  className="tc-task-card-pending-body"
                  onClick={() => openPendingApproval(item, index)}
                >
                  <div className="tc-task-card-top">
                    <div className="tc-task-card-main">
                      <div className="tc-task-head">
                        <span className="tc-task-badge tc-task-flagged">{taskText.pendingBadge}</span>
                        <span className="tc-task-badge tc-task-pending-marker">{taskText.humanReviewBadge}</span>
                      </div>
                      <div className="tc-task-title">{taskText.taskLabel} {formatTaskId(item.id)}</div>
                      <div className="tc-task-card-meta">
                        <div>{taskText.start}</div>
                        <span>{fmtTime((item.created_at || 0) * 1000, locale)}</span>
                        <div>{taskText.end}</div>
                        <span>---</span>
                      </div>
                    </div>
                    <div className="tc-task-card-side">
                      <div className="tc-task-exact-time">{fmtExactDate((item.created_at || 0) * 1000, locale)}</div>
                      <TaskActorStrip
                        charName={charName}
                        agentId={liveAgent?.id || item.session_key || item.id}
                      />
                    </div>
                  </div>
                  <div className="tc-task-snippet">{promptSnippet}</div>
                  {(() => {
                    const eff = getEffectiveRisk(item) || {};
                    return (
                      <div className="tc-task-risk-row">
                        <span className="tc-task-risk-tag tc-task-risk-tag-risk"><b>{taskText.riskSource}</b> {eff.risk_source || taskText.none}</span>
                        <span className="tc-task-risk-tag tc-task-risk-tag-failure"><b>{taskText.failureMode}</b> {eff.failure_mode || taskText.none}</span>
                        <span className="tc-task-risk-tag tc-task-risk-tag-harm"><b>{taskText.realWorldHarm}</b> {eff.real_world_harm || taskText.none}</span>
                      </div>
                    );
                  })()}
                </button>
                <div className="tc-task-pending-actions">
                  <button
                    type="button"
                    className="tc-task-guard-btn tc-task-guard-btn-approve"
                    disabled={guardResolvingId === item.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      resolvePending(item, 'approved');
                    }}
                  >
                    {guardResolvingId === item.id ? '…' : taskText.approve}
                  </button>
                  <button
                    type="button"
                    className="tc-task-guard-btn tc-task-guard-btn-reject"
                    disabled={guardResolvingId === item.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      resolvePending(item, 'rejected');
                    }}
                  >
                    {taskText.reject}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="tc-task-main">
        <section className="tc-ornate-panel tc-task-board">
          <div className="tc-task-board-head">
            <div>
              <div className="tc-task-lane-overline">{taskText.boardOverline}</div>
              <div className="tc-task-lane-title">{taskText.boardTitle}</div>
            </div>
            <div className="tc-task-board-summary">
              <span>{taskBoardSummary.running} {taskText.summaryRunning}</span>
              <span>{taskBoardSummary.pending} {taskText.summaryPending}</span>
              <span>{taskBoardSummary.completed} {taskText.summaryCompleted}</span>
              <span>{taskBoardSummary.failed} {taskText.summaryFailed}</span>
              <span>{taskBoardSummary.error} {taskText.summaryError}</span>
            </div>
          </div>
          <div className="tc-task-board-note">{taskText.boardNote}</div>
          <div className="tc-task-board-grid">
            {sortedDashboardEvents.length === 0 ? (
              <div className="tc-empty tc-task-board-empty">{taskText.noEvents}</div>
            ) : sortedDashboardEvents.map((task, index) => {
              const liveAgent = agentsById[task.session_id];
              const promptSnippet = dashboardTaskListSnippet(task, taskText.userMessageShort);
              const charName = liveAgent
                ? (charNameMap[liveAgent.id] || CHAR_NAMES[index % CHAR_NAMES.length])
                : CHAR_NAMES[index % CHAR_NAMES.length];
              const statusId = mapDashboardTaskStatus(task.status);
              const statusMeta = taskStatusMeta[statusId] || taskStatusMeta.running;

              return (
                <button
                  key={task.id}
                  type="button"
                  className={`tc-task-card ${selectedTask?.kind === 'dashboard' && selectedTask.task.id === task.id ? 'tc-task-card-selected' : ''}`}
                  onClick={() => openDashboardTask(task, index)}
                >
                  <div className="tc-task-card-top">
                    <div className="tc-task-card-main">
                      <div className="tc-task-head">
                        <span className={`tc-task-badge ${statusMeta.className}`}>{statusMeta.label}</span>
                      </div>
                      <div className="tc-task-title">{taskText.taskLabel} {formatTaskId(task.id)}</div>
                      <div className="tc-task-card-meta">
                        <div>{taskText.start}</div>
                        <span>{fmtTime(task.started_at, locale)}</span>
                        <div>{taskText.end}</div>
                        <span>{task.completed_at ? fmtTime(task.completed_at, locale) : '---'}</span>
                      </div>
                    </div>
                    <div className="tc-task-card-side">
                      <div className="tc-task-exact-time">{fmtExactDate(task.started_at, locale)}</div>
                      <TaskActorStrip
                        charName={charName}
                        agentId={liveAgent?.id || task.session_id}
                      />
                    </div>
                  </div>
                  <div className="tc-task-snippet">{promptSnippet}</div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {selectedTask ? (
        <div className="tc-task-modal-backdrop" onMouseDown={closeTaskDetail}>
          <section
            className="tc-ornate-panel tc-task-detail tc-task-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tc-task-modal-head">
              <div>
                <div className="tc-task-lane-overline">
                  {selectedTask.kind === 'pending' ? taskText.pendingApprovalOverline : taskText.taskDetailOverline}
                </div>
                <div className="tc-task-lane-title">
                  {selectedTask.kind === 'pending'
                    ? `${taskText.taskLabel} ${formatTaskId(selectedTask.item.id)}`
                    : `${taskText.taskLabel} ${formatTaskId(selectedTask.task.id)}`}
                </div>
              </div>
              <button
                type="button"
                className="tc-task-detail-close"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  closeTaskDetail();
                }}
              >
                {taskText.close}
              </button>
            </div>

            {selectedTask.kind === 'pending' ? (
              <>
                <div className="tc-task-detail-summary tc-task-detail-summary-flat">
                  <TaskDetailFact label={taskText.taskId} value={formatTaskId(detailTask?.id || selectedTask.item.id, 18)} mono featured />
                  <TaskDetailFact label={taskText.agent} value={selectedTask.agentName} featured />
                  <TaskDetailFact label={taskText.session} value={detailTask?.session_id || selectedTask.item.session_key || '---'} mono tone="info" />
                  <TaskDetailFact label={taskText.userMessage} value={detailTask?.user_message_id || '---'} mono />
                  <TaskDetailFact
                    label={taskText.status}
                    value={taskText.pendingReview}
                    featured
                    tone="warn"
                  />
                  <TaskDetailFact label={taskText.startedAt} value={fmtDate(detailTask?.started_at || (selectedTask.item.created_at || 0) * 1000, locale)} />
                  <TaskDetailFact label={taskText.completedAt} value="---" />
                  <TaskDetailFact label={taskText.duration} value={durationStr(detailTask?.started_at || (selectedTask.item.created_at || 0) * 1000, null, locale)} />
                  <TaskDetailFact label={taskText.totalMessages} value={String(detailTask?.total_messages ?? '---')} />
                  <TaskDetailFact label={taskText.assistantMessages} value={String(detailTask?.total_assistant_messages ?? '---')} />
                  <TaskDetailFact label={taskText.toolResultMessages} value={String(detailTask?.total_tool_result_messages ?? '---')} />
                  <TaskDetailFact label={taskText.toolCalls} value={String(detailTask?.total_tool_calls ?? '---')} tone="tool" />
                  <TaskDetailFact label={taskText.inputTokens} value={fmtTokens(detailTask?.total_input_tokens)} />
                  <TaskDetailFact label={taskText.outputTokens} value={fmtTokens(detailTask?.total_output_tokens)} />
                  <TaskDetailFact label={taskText.totalTokens} value={fmtTokens(detailTask?.total_tokens)} featured tone="info" />
                </div>

                {(() => {
                  const eff = getEffectiveRisk(selectedTask.item) || {};
                  return (
                    <div className="tc-task-detail-alert tc-task-detail-risk-box">
                      <div className="tc-task-detail-context-title">{taskText.guardRiskDetail}</div>
                      <div className="tc-task-detail-risk-grid">
                        <TaskDetailFact label={taskText.riskSource} value={eff.risk_source || taskText.none} tone="warn" />
                        <TaskDetailFact label={taskText.failureMode} value={eff.failure_mode || taskText.none} tone="danger" />
                        <TaskDetailFact label={taskText.realWorldHarm} value={eff.real_world_harm || taskText.none} tone="danger" />
                      </div>
                    </div>
                  );
                })()}

                <div className="tc-task-detail-stream">
                  {detailLoading ? (
                    <div className="tc-empty">{taskText.loadingDetail}</div>
                  ) : detailMessages.length > 0 ? (
                    detailMessages.map((msg) => (
                      <TaskDetailMessage key={msg.message_id} msg={msg} />
                    ))
                  ) : selectedTask.item.session_context ? (
                    <div className="tc-task-detail-tool tc-task-detail-tool-card tc-task-detail-tool--pending">
                      <div className="tc-task-detail-tool-head tc-task-detail-tool-head-main">
                        <span className="tc-task-detail-tool-tag">{taskText.toolTag}</span>
                        <span className="tc-task-detail-tool-name">{selectedTask.item.tool_name || taskText.toolCallFallback}</span>
                      </div>
                      <div className="tc-task-detail-tool-body">
                        <div className="tc-task-detail-tool-block tc-task-detail-tool-block-call">
                          <div className="tc-task-detail-tool-subhead">{taskText.toolCallParameters}</div>
                          <pre className="tc-task-detail-tool-payload">{stringifyTaskValue(selectedTask.item.params || {})}</pre>
                        </div>
                        <div className="tc-task-detail-tool-block tc-task-detail-tool-block-result">
                          <div className="tc-task-detail-tool-subhead">{taskText.sessionContext}</div>
                          <pre className="tc-task-detail-tool-payload">{selectedTask.item.session_context}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="tc-empty">{detailError || taskText.noPendingDetail}</div>
                  )}
                </div>

                <div className="tc-task-modal-guard-actions">
                  <button
                    type="button"
                    className="tc-task-guard-btn tc-task-guard-btn-approve"
                    disabled={guardResolvingId === selectedTask.item.id}
                    onClick={() => resolvePending(selectedTask.item, 'approved')}
                  >
                    {guardResolvingId === selectedTask.item.id ? '…' : taskText.approve}
                  </button>
                  <button
                    type="button"
                    className="tc-task-guard-btn tc-task-guard-btn-reject"
                    disabled={guardResolvingId === selectedTask.item.id}
                    onClick={() => resolvePending(selectedTask.item, 'rejected')}
                  >
                    {taskText.reject}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="tc-task-detail-summary tc-task-detail-summary-flat">
                  <TaskDetailFact label={taskText.taskId} value={formatTaskId(detailTask?.id || selectedTask.task.id, 18)} mono featured />
                  <TaskDetailFact label={taskText.agent} value={selectedTask.agentName} featured />
                  <TaskDetailFact label={taskText.session} value={detailTask?.session_id || selectedTask.task.session_id} mono tone="info" />
                  <TaskDetailFact label={taskText.userMessage} value={detailTask?.user_message_id || selectedTask.task.user_message_id || '---'} mono />
                  <TaskDetailFact
                    label={taskText.status}
                    value={(taskStatusMeta[detailStatusId] || taskStatusMeta.running).label}
                    featured
                    tone={taskDetailToneFromStatus(detailStatusId)}
                  />
                  <TaskDetailFact label={taskText.startedAt} value={fmtDate(detailTask?.started_at || selectedTask.task.started_at, locale)} />
                  <TaskDetailFact label={taskText.completedAt} value={(detailTask?.completed_at || selectedTask.task.completed_at) ? fmtDate(detailTask?.completed_at || selectedTask.task.completed_at, locale) : '---'} />
                  <TaskDetailFact label={taskText.duration} value={durationStr(detailTask?.started_at || selectedTask.task.started_at, detailTask?.completed_at || selectedTask.task.completed_at, locale)} />
                  <TaskDetailFact label={taskText.totalMessages} value={String(detailTask?.total_messages ?? selectedTask.task.total_messages ?? 0)} />
                  <TaskDetailFact label={taskText.assistantMessages} value={String(detailTask?.total_assistant_messages ?? '---')} />
                  <TaskDetailFact label={taskText.toolResultMessages} value={String(detailTask?.total_tool_result_messages ?? '---')} />
                  <TaskDetailFact label={taskText.toolCalls} value={String(detailTask?.total_tool_calls ?? selectedTask.task.total_tool_calls ?? 0)} tone="tool" />
                  <TaskDetailFact label={taskText.inputTokens} value={fmtTokens(detailTask?.total_input_tokens)} />
                  <TaskDetailFact label={taskText.outputTokens} value={fmtTokens(detailTask?.total_output_tokens)} />
                  <TaskDetailFact label={taskText.totalTokens} value={fmtTokens(detailTask?.total_tokens ?? selectedTask.task.total_tokens)} featured tone="info" />
                </div>

                {detailTask?.error_message || selectedTask.task.error_message ? (
                  <div className="tc-task-detail-alert">
                    <div className="tc-task-detail-context-title">{taskText.errorTitle}</div>
                    <div className="tc-task-detail-alert-copy">{detailTask?.error_message || selectedTask.task.error_message}</div>
                  </div>
                ) : null}

                <div className="tc-task-detail-stream">
                  {detailLoading ? (
                    <div className="tc-empty">{taskText.loadingDetail}</div>
                  ) : detailMessages.length === 0 ? (
                    <div className="tc-empty">{detailError || taskText.noTaskDetail}</div>
                  ) : (
                    detailMessages.map((msg) => (
                      <TaskDetailMessage key={msg.message_id} msg={msg} />
                    ))
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default function TownConsole({
  onSelectAgent,
  guardEnabled = false,
  onToggleGuard,
  mapVariants = [],
  activeMapId = '',
  onChangeMap,
  musicTracks = [],
  activeMusicId = '',
  onChangeMusic,
  musicEnabled = false,
  onToggleMusic,
  musicVolume = 0.4,
  onChangeMusicVolume,
  sceneNpcDisplayMode = 'all',
  onChangeSceneNpcDisplayMode,
  sceneNpcDisplayCap = 12,
  onChangeSceneNpcDisplayCap,
  minSceneNpcDisplayCap = 1,
  onDeleteAgent,
  onDataChanged,
}) {
  const { locale } = useI18n();
  const townText = getAgentTownText(locale);
  const [activeTab, setActiveTab] = useState('crew');
  const [traceData, setTraceData] = useState(buildConsoleData(null));
  const [dashboardEvents, setDashboardEvents] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [runtimeInstances, setRuntimeInstances] = useState([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [catalogAuthProviders, setCatalogAuthProviders] = useState([]);
  const [catalogModelProviders, setCatalogModelProviders] = useState([]);
  const [onboardDefaults, setOnboardDefaults] = useState(null);
  // Per-provider endpoint presets (§33). Today only ``alibaba`` populates
  // a bundle here so the modal can show the DashScope-vs-Coding-Plan picker
  // that keeps standard DashScope keys from 401-ing under Hermes's
  // hardcoded coding-intl default. Empty object on OpenClaw / older
  // backends and the modal treats that as "no picker needed".
  const [providerEndpoints, setProviderEndpoints] = useState({});
  // Reported by the Hermes branch of /system/onboard-scan (§36).  Empty
  // string until the first scan resolves.  Used to gate Hermes-only UI
  // affordances (e.g. the per-model delete × in the model deck) so they
  // never render under OpenClaw.
  const [platform, setPlatform] = useState('');
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelCatalogLoaded, setModelCatalogLoaded] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState('');
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const [draftAgents, setDraftAgents] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState('working');
  const [selectedIdentity, setSelectedIdentity] = useState('');
  const [messageMap, setMessageMap] = useState({});
  const [inputMap, setInputMap] = useState({});
  const [loadingHistoryIdentity, setLoadingHistoryIdentity] = useState('');
  const [sendingIdentity, setSendingIdentity] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [pendingModelId, setPendingModelId] = useState('');
  const [recentlyConfiguredModelId, setRecentlyConfiguredModelId] = useState('');
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createError, setCreateError] = useState('');
  const [modelValidationMap, setModelValidationMap] = useState({});
  const [guardResolvingId, setGuardResolvingId] = useState(null);
  const [taskDetailOpen, setTaskDetailOpen] = useState(false);
  const [pendingImagesMap, setPendingImagesMap] = useState({});
  const [nanobotInstalled, setNanobotInstalled] = useState(null);
  const streamControllerRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const mockReplyTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const modelValidationJobsRef = useRef(new Map());
  const modelValidationMapRef = useRef({});
  const pendingModelIdRef = useRef('');
  const recentlyConfiguredModelIdRef = useRef('');
  const didAutoSelectModelRef = useRef(false);

  modelValidationMapRef.current = modelValidationMap;
  pendingModelIdRef.current = pendingModelId;
  recentlyConfiguredModelIdRef.current = recentlyConfiguredModelId;

  const MAX_IMAGES = 8;
  const MAX_SINGLE_SIZE = 5 * 1024 * 1024;

  const selectedRuntime = useMemo(() => (
    runtimeInstances.find((instance) => instance.instance_id === selectedRuntimeId)
    || runtimeInstances.find((instance) => instance.platform === 'openclaw')
    || runtimeInstances[0]
    || null
  ), [runtimeInstances, selectedRuntimeId]);

  const selectedRuntimeUnavailable = Boolean(
    selectedRuntime
    && selectedRuntime.platform === 'nanobot'
    && selectedRuntime.health_status !== 'healthy',
  );
  const runtimeUnavailableMessage = selectedRuntimeUnavailable
    ? townText.create.nanobotGatewayOffline
    : '';

  // Detect nanobot installation status
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await systemAPI.installStatus();
        if (cancelled) return;
        setNanobotInstalled(Boolean(res.data?.nanobot_installed));
      } catch { if (!cancelled) setNanobotInstalled(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    if (mockReplyTimeoutRef.current) {
      window.clearTimeout(mockReplyTimeoutRef.current);
      mockReplyTimeoutRef.current = null;
    }
    for (const job of modelValidationJobsRef.current.values()) {
      job.cancelled = true;
      job.controller?.abort();
      if (job.timeoutId) {
        window.clearTimeout(job.timeoutId);
        job.timeoutId = null;
      }
    }
    modelValidationJobsRef.current.clear();
  }, []);

  const loadRuntimeInstances = useCallback(async () => {
    if (USE_AGENT_TOWN_MOCK) {
      const mockRuntime = {
        instance_id: 'openclaw-default',
        platform: 'openclaw',
        display_name: 'OpenClaw',
        enabled: true,
        is_default: true,
        capabilities: { chat: true, model_list: true },
        health_status: 'healthy',
      };
      setRuntimeInstances([mockRuntime]);
      setSelectedRuntimeId((prev) => prev || mockRuntime.instance_id);
      return;
    }

    try {
      const response = await systemAPI.instances();
      const instances = Array.isArray(response?.data?.instances) ? response.data.instances : [];
      const chatInstances = instances.filter((instance) => (
        instance?.enabled !== false && instance?.capabilities?.chat
      ));
      setRuntimeInstances(chatInstances);
      setSelectedRuntimeId((prev) => {
        if (prev && chatInstances.some((instance) => instance.instance_id === prev)) {
          return prev;
        }
        return (
          chatInstances.find((instance) => instance.platform === 'openclaw')?.instance_id
          || chatInstances[0]?.instance_id
          || ''
        );
      });
    } catch (err) {
      console.warn('[TownConsole] runtime instances fetch error:', err);
    }
  }, []);

  const loadAvailableModels = useCallback(async () => {
    if (USE_AGENT_TOWN_MOCK) {
      setAvailableModels(MOCK_MODEL_PROVIDERS.flatMap((provider) =>
        (provider.models || []).map((model) => ({
          id: model.id,
          name: model.name || model.id,
          provider: provider.name || provider.id,
          reasoning: Boolean(model.reasoning),
        }))
      ));
      setDefaultModel(MOCK_MODEL_PROVIDERS[0]?.models?.[0]?.id || '');
      return;
    }

    try {
      const query = selectedRuntimeId
        ? `?instance_id=${encodeURIComponent(selectedRuntimeId)}`
        : '';
      const response = await fetch(`/api/chat/available-models${query}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Available models request failed: ${response.status}`);
      }
      const json = await response.json();
      const nextModels = Array.isArray(json.models) ? json.models : [];
      setAvailableModels((prev) => {
        if (nextModels.length === 0 && prev.length > 0) return prev;

        const merged = new Map(nextModels.map((model) => [model.id, model]));
        const localValidationIds = new Set(
          Object.entries(modelValidationMapRef.current)
            .filter(([, state]) => state?.status === 'checking' || state?.status === 'ready')
            .map(([modelId]) => modelId),
        );

        prev.forEach((model) => {
          const keepLocalModel = (
            model.id === pendingModelIdRef.current
            || model.id === recentlyConfiguredModelIdRef.current
            || localValidationIds.has(model.id)
          );
          if (keepLocalModel && !merged.has(model.id)) {
            merged.set(model.id, model);
          }
        });

        return Array.from(merged.values());
      });
      setDefaultModel((prev) => json.default_model || prev || nextModels[0]?.id || '');
    } catch (err) {
      console.warn('[TownConsole] available-models fetch error:', err);
    }
  }, [selectedRuntimeId]);

  const loadModelCatalog = useCallback(async (force = false) => {
    if (USE_AGENT_TOWN_MOCK) {
      setCatalogAuthProviders([]);
      setCatalogModelProviders(MOCK_MODEL_PROVIDERS.map((provider) => ({
        id: provider.id,
        name: provider.name || provider.id,
        models: (provider.models || []).map((model) => ({
          id: model.id,
          name: model.name || model.id,
          contextWindow: model.contextWindow || 0,
          reasoning: Boolean(model.reasoning),
          available: true,
          input: Array.isArray(model.input) ? model.input.join('+') : (model.input || 'text'),
        })),
      })));
      setOnboardDefaults({
        mode: 'local',
        gateway_port: 18789,
        gateway_bind: 'loopback',
        gateway_auth_mode: 'token',
        gateway_token: '',
        tailscale_mode: 'off',
        workspace: '',
        install_daemon: true,
        remote_url: '',
        remote_token: '',
        enabled_hooks: [],
        search_provider: '',
        search_api_key: '',
      });
      setModelCatalogLoaded(true);
      setModelCatalogError('');
      return;
    }
    if (modelCatalogLoading || (modelCatalogLoaded && !force)) return;

    setModelCatalogLoading(true);
    setModelCatalogError('');
    try {
      const response = await systemAPI.onboardScan();
      const data = response.data || {};
      setCatalogAuthProviders(Array.isArray(data.auth_providers) ? data.auth_providers : []);
      setCatalogModelProviders(Array.isArray(data.model_providers) ? data.model_providers : []);
      setOnboardDefaults(data.defaults || {});
      // ``provider_endpoints`` is a Hermes-only field; OpenClaw scan payloads
      // won't carry it and we just hold an empty map so the modal's picker
      // branch stays dormant.
      setProviderEndpoints(
        data.provider_endpoints && typeof data.provider_endpoints === 'object'
          ? data.provider_endpoints
          : {},
      );
      // ``platform`` is also Hermes-only on the wire; OpenClaw scans omit
      // it so we leave the state empty and the Hermes-only delete button
      // stays hidden (§36).
      setPlatform(typeof data.platform === 'string' ? data.platform : '');
      setModelCatalogLoaded(true);
    } catch (err) {
      console.warn('[TownConsole] onboard-scan fetch error:', err);
      setModelCatalogError(err?.response?.data?.detail || err?.message || 'Failed to discover configure-time models.');
      try {
        const st = await systemAPI.status();
        const dw = st.data?.default_workspace;
        if (dw) {
          setOnboardDefaults((prev) => ({ ...prev, workspace: prev.workspace || dw }));
        }
      } catch { /* ignore */ }
    } finally {
      setModelCatalogLoading(false);
    }
  }, [modelCatalogLoaded, modelCatalogLoading]);

  const loadConsoleData = useCallback(async () => {
    if (USE_AGENT_TOWN_MOCK) {
      const mock = buildConsoleData(null);
      setTraceData(mock);
      setDashboardEvents(buildMockDashboardEvents(mock.events));
      setPendingApprovals(buildMockPendingApprovals(mock.agents, mock.events));
      return;
    }

    const tracePromise = fetch('/api/trace/', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Trace request failed: ${response.status}`);
        }
        const traceJson = await response.json();
        setTraceData(buildConsoleData(traceJson));
      })
      .catch((err) => {
        console.warn('[TownConsole] trace fetch error:', err);
      });

    const dashboardEventsPromise = fetch('/api/events/', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Dashboard events request failed: ${response.status}`);
        }
        const eventsJson = await response.json();
        setDashboardEvents(Array.isArray(eventsJson.events) ? eventsJson.events : []);
      })
      .catch((err) => {
        console.warn('[TownConsole] dashboard events fetch error:', err);
      });

    const pendingApprovalsPromise = fetch('/api/guard/pending?resolved=false', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Pending approvals request failed: ${response.status}`);
        }
        const pendingJson = await response.json();
        setPendingApprovals(Array.isArray(pendingJson) ? pendingJson : []);
      })
      .catch((err) => {
        console.warn('[TownConsole] pending approvals fetch error:', err);
      });

    await Promise.allSettled([tracePromise, dashboardEventsPromise, pendingApprovalsPromise]);
  }, []);

  const onDataChangedRef = useRef(onDataChanged);
  onDataChangedRef.current = onDataChanged;

  const handleResolveGuardPending = useCallback(async (pendingId, resolution) => {
    if (!pendingId || !resolution) return;
    setGuardResolvingId(pendingId);
    try {
      if (USE_AGENT_TOWN_MOCK) {
        setPendingApprovals((prev) => prev.filter((p) => p.id !== pendingId));
        onDataChangedRef.current?.();
        return;
      }
      const res = await fetch(`/api/guard/pending/${encodeURIComponent(pendingId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) {
        throw new Error(await readFetchError(res, 'Guard resolve failed.'));
      }
      await loadConsoleData();
      onDataChangedRef.current?.();
    } catch (err) {
      console.warn('[TownConsole] guard resolve error:', err);
    } finally {
      setGuardResolvingId(null);
    }
  }, [loadConsoleData]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (disposed) return;
      await loadRuntimeInstances();
      await loadConsoleData();
    };

    loadAvailableModels();
    load();
    const timer = window.setInterval(load, 10000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [loadAvailableModels, loadConsoleData, loadRuntimeInstances]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    loadAvailableModels();
    loadModelCatalog();
  }, [loadAvailableModels, loadModelCatalog, modelPickerOpen]);

  useEffect(() => {
    if (!modelSetupOpen) return;
    loadModelCatalog();
  }, [loadModelCatalog, modelSetupOpen]);

  // Cross-surface model-config sync. The Configure page (/configure) and
  // the Hermes-specific flows in there write a new default model to
  // ~/.hermes/config.yaml and restart the Hermes gateway. They also
  // broadcast two signals after a successful save:
  //   1. ``window`` custom event ``xs-hermes-model-updated``  — same tab
  //   2. ``localStorage.setItem('xs_hermes_cfg_ping', ...)``   — cross tab
  //      (``storage`` event fires in *other* tabs on write)
  // We listen to both here so the model dropdown / default-badge / agent
  // creation form reflect the new model without a hard refresh. Also
  // reload the catalog so the "Add new model" picker shows it as
  // configured.
  useEffect(() => {
    const refresh = () => {
      loadAvailableModels();
      loadModelCatalog(true);
    };
    const onStorage = (event) => {
      if (event.key === 'xs_hermes_cfg_ping') refresh();
    };
    window.addEventListener('xs-hermes-model-updated', refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('xs-hermes-model-updated', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [loadAvailableModels, loadModelCatalog]);

  const { agents: traceAgents, events } = traceData;

  useEffect(() => {
    setDraftAgents((prev) => {
      const liveKeys = new Set(traceAgents.map((agent) => getAgentIdentity(agent)).filter(Boolean));
      return prev.filter((agent) => !liveKeys.has(getAgentIdentity(agent)));
    });
  }, [traceAgents]);

  const mergedAgents = useMemo(() => mergeAgents(traceAgents, draftAgents), [traceAgents, draftAgents]);

  const traceAgentsBySessionKey = useMemo(() => {
    const map = {};
    mergedAgents.forEach((agent) => {
      const sessionKey = getAgentSessionKey(agent);
      if (sessionKey) map[sessionKey] = agent;
    });
    return map;
  }, [mergedAgents]);

  const combinedAgents = useMemo(
    () => applyPendingStatusToAgents(mergedAgents, pendingApprovals),
    [mergedAgents, pendingApprovals],
  );

  const charNameMap = useMemo(() => {
    const liveAgents = combinedAgents.filter((a) => !String(a.id).startsWith('draft:'));
    const drafts = combinedAgents.filter((a) => String(a.id).startsWith('draft:'));
    const { map, used } = buildStableCharNameMap(liveAgents);

    if (DEMO_MODE) {
      for (const a of liveAgents) {
        if (isDemoSession(a.session_key) || isDemoSession(a.id)) map[a.id] = DEMO_CHAR_NAME;
      }
    }

    for (const agent of drafts) {
      if (DEMO_MODE) {
        map[agent.id] = DEMO_CHAR_NAME;
      } else {
        const base = hashAgentCharIndex(agent.id);
        let idx = base;
        if (used.has(idx)) {
          const unused = CHAR_NAMES.findIndex((_, i) => !used.has(i));
          if (unused >= 0) idx = unused;
        }
        used.add(idx);
        map[agent.id] = CHAR_NAMES[idx];
      }
    }

    return map;
  }, [combinedAgents]);

  const traceAgentsById = useMemo(() => {
    const map = {};
    combinedAgents.forEach((agent) => {
      map[agent.id] = agent;
    });
    return map;
  }, [combinedAgents]);

  const eventsByAgent = useMemo(() => {
    const map = {};
    events.forEach((event) => {
      if (!map[event.agent_id] || event.start_time > map[event.agent_id].start_time) {
        map[event.agent_id] = event;
      }
    });
    return map;
  }, [events]);

  const eventsByAgentList = useMemo(() => {
    const map = {};
    events.forEach((event) => {
      if (!map[event.agent_id]) map[event.agent_id] = [];
      map[event.agent_id].push(event);
    });
    Object.values(map).forEach((list) => {
      list.sort((a, b) => (b.start_time || '').localeCompare(a.start_time || ''));
    });
    return map;
  }, [events]);

  /** Group **Event** rows by `Event.session_id` (same id as agent roster) — ledger + per-agent counts; still Event API only. */
  const effectiveDashboardEvents = useMemo(
    () => applyPendingStatusToDashboardEvents(dashboardEvents, pendingApprovals, traceAgentsBySessionKey),
    [dashboardEvents, pendingApprovals, traceAgentsBySessionKey],
  );

  const dashboardEventsByAgentList = useMemo(() => {
    const map = {};
    effectiveDashboardEvents.forEach((event) => {
      if (!map[event.session_id]) map[event.session_id] = [];
      map[event.session_id].push(event);
    });
    Object.values(map).forEach((list) => {
      list.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
    });
    return map;
  }, [effectiveDashboardEvents]);

  const tokensByAgent = useMemo(() => {
    const map = {};
    effectiveDashboardEvents.forEach((evt) => {
      const sid = evt.session_id;
      if (!sid) return;
      map[sid] = (map[sid] || 0) + (evt.total_tokens || 0);
    });
    return map;
  }, [effectiveDashboardEvents]);

  const countsByFilter = useMemo(() => FILTER_IDS.reduce((counts, id) => {
    counts[id] = combinedAgents.filter((agent) => agent.status === id).length;
    return counts;
  }, {}), [combinedAgents]);

  const filteredAgents = useMemo(
    () => combinedAgents.filter((agent) => agent.status === selectedFilter),
    [combinedAgents, selectedFilter],
  );

  useEffect(() => {
    if (filteredAgents.length === 0) return;
    const inFilter = filteredAgents.some((a) => getAgentIdentity(a) === selectedIdentity);
    const inAll = combinedAgents.some((a) => getAgentIdentity(a) === selectedIdentity);
    if (!inFilter && !inAll) {
      setSelectedIdentity(getAgentIdentity(filteredAgents[0]));
    }
  }, [filteredAgents, combinedAgents, selectedIdentity]);

  const currentAgent = useMemo(() => {
    const byIdentity = combinedAgents.find((a) => getAgentIdentity(a) === selectedIdentity);
    if (byIdentity) return byIdentity;
    if (filteredAgents.length) return filteredAgents[0];
    return null;
  }, [combinedAgents, filteredAgents, selectedIdentity]);

  const currentIdentity = currentAgent ? getAgentIdentity(currentAgent) : '';
  const currentSessionKey = currentAgent ? getAgentSessionKey(currentAgent) : '';
  const currentEvents = currentAgent ? (eventsByAgentList[currentAgent.id] || []) : [];
  const currentDashboardEvents = currentAgent ? (dashboardEventsByAgentList[currentAgent.id] || []) : [];

  const currentPendingImages = currentIdentity ? (pendingImagesMap[currentIdentity] || []) : [];

  useEffect(() => {
    if (!currentIdentity || !isNanobotAgent(currentAgent)) return;
    if (currentPendingImages.length === 0) return;
    setPendingImagesMap((prev) => ({ ...prev, [currentIdentity]: [] }));
  }, [currentAgent, currentIdentity, currentPendingImages.length]);

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1] ?? '';
        resolve({ dataUrl, base64 });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const addImages = useCallback(async (files) => {
    if (!currentIdentity) return;
    if (isNanobotAgent(currentAgent)) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    const current = pendingImagesMap[currentIdentity] || [];
    const remaining = MAX_IMAGES - current.length;
    const toAdd = arr.slice(0, remaining);
    const results = [];
    for (const file of toAdd) {
      if (file.size > MAX_SINGLE_SIZE) continue;
      const { dataUrl, base64 } = await fileToBase64(file);
      results.push({ id: makeId(), file, dataUrl, base64, mimeType: file.type });
    }
    if (results.length > 0) {
      setPendingImagesMap((prev) => ({
        ...prev,
        [currentIdentity]: [...(prev[currentIdentity] || []), ...results],
      }));
    }
  }, [currentAgent, currentIdentity, pendingImagesMap]);

  const removeImage = useCallback((imgId) => {
    if (!currentIdentity) return;
    setPendingImagesMap((prev) => ({
      ...prev,
      [currentIdentity]: (prev[currentIdentity] || []).filter((img) => img.id !== imgId),
    }));
  }, [currentIdentity]);

  const currentMessages = useMemo(() => {
    if (!currentIdentity) return [];
    const stored = messageMap[currentIdentity] || [];
    if (stored.length > 0) return stored;
    if (currentAgent?.mock) return buildMockHistory(currentAgent, currentEvents);
    return stored;
  }, [currentAgent, currentEvents, currentIdentity, messageMap]);
  const currentInput = currentIdentity ? (inputMap[currentIdentity] || '') : '';
  /** Per-agent **Event** rows only (`GET /api/events` slice by `session_id`); Tasks tab uses global Event list instead. */
  const currentSummary = currentAgent
    ? aggregateTaskStatusCounts(currentDashboardEvents)
    : { running: 0, pending: 0, completed: 0, error: 0, failed: 0 };

  const providerDirectory = useMemo(() => {
    const next = new Map();

    catalogModelProviders.forEach((provider) => {
      const providerId = String(provider?.id || '').trim();
      if (!providerId) return;
      next.set(providerId, {
        label: provider?.name || providerId,
        hint: provider?.hint || '',
      });
    });

    catalogAuthProviders.forEach((provider) => {
      const providerId = String(provider?.id || '').trim();
      if (!providerId) return;
      const previous = next.get(providerId) || {};
      next.set(providerId, {
        label: provider?.name || previous.label || providerId,
        hint: provider?.hint || previous.hint || '',
      });
    });

    return next;
  }, [catalogAuthProviders, catalogModelProviders]);

  const catalogModelDirectory = useMemo(() => {
    const next = new Map();

    catalogModelProviders.forEach((provider) => {
      const providerId = String(provider?.id || '').trim();
      const providerInfo = providerDirectory.get(providerId);
      (provider?.models || []).forEach((model) => {
        const modelId = String(model?.id || '').trim();
        if (!modelId) return;
        next.set(modelId, {
          provider: providerId,
          providerLabel: providerInfo?.label || provider?.name || providerId,
          contextWindow: Number(model?.contextWindow || 0),
          maxTokens: Number(model?.maxTokens || 0),
          inputModes: normalizeInputModes(model?.input),
          reasoning: Boolean(model?.reasoning),
        });
      });
    });

    return next;
  }, [catalogModelProviders, providerDirectory]);

  const baseConfiguredModels = useMemo(() => {
    return [...availableModels]
      .map((model) => ({
        ...(() => {
          const catalogMeta = catalogModelDirectory.get(model.id);
          const provider = model.provider || catalogMeta?.provider || String(model.id || '').split('/')[0] || '';
          const providerInfo = providerDirectory.get(provider);
          return {
            id: model.id,
            name: model.name || model.id,
            provider,
            providerLabel: providerInfo?.label || catalogMeta?.providerLabel || provider,
            providerHint: providerInfo?.hint || '',
            reasoning: Boolean(model.reasoning || catalogMeta?.reasoning),
            contextWindow: Number(catalogMeta?.contextWindow || 0),
            maxTokens: Number(catalogMeta?.maxTokens || 0),
            inputModes: Array.isArray(catalogMeta?.inputModes) ? catalogMeta.inputModes : [],
            isDefault: model.id === defaultModel,
          };
        })(),
      }))
      .sort((a, b) => (
        Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault))
        || String(a.providerLabel || a.provider || '').localeCompare(String(b.providerLabel || b.provider || ''))
        || String(a.name || '').localeCompare(String(b.name || ''))
      ));
  }, [availableModels, catalogModelDirectory, defaultModel, providerDirectory]);

  const lastUsedConfiguredModelId = useMemo(() => {
    const recentAgents = [...combinedAgents]
      .filter((agent) => String(agent?.provider || '').trim() && String(agent?.model || '').trim())
      .sort((a, b) => getAgentRecencyValue(b) - getAgentRecencyValue(a));

    for (const agent of recentAgents) {
      const matchedModel = baseConfiguredModels.find((model) => matchConfiguredModelToAgent(model, agent));
      if (matchedModel?.id) {
        return matchedModel.id;
      }
    }

    return '';
  }, [baseConfiguredModels, combinedAgents]);

  const configuredModels = useMemo(() => {
    return [...baseConfiguredModels]
      .map((model) => ({
        ...model,
        isNew: model.id === recentlyConfiguredModelId,
        isLastUsed: model.id === lastUsedConfiguredModelId,
      }))
      .sort((a, b) => (
        Number(Boolean(b.isNew)) - Number(Boolean(a.isNew))
        || Number(Boolean(b.isLastUsed)) - Number(Boolean(a.isLastUsed))
        || Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault))
        || String(a.providerLabel || a.provider || '').localeCompare(String(b.providerLabel || b.provider || ''))
        || String(a.name || '').localeCompare(String(b.name || ''))
      ));
  }, [baseConfiguredModels, lastUsedConfiguredModelId, recentlyConfiguredModelId]);

  const filteredModels = useMemo(() => {
    const needle = modelSearch.trim().toLowerCase();
    const compactNeedle = normalizeSearchToken(modelSearch);
    if (!needle) return configuredModels;
    return configuredModels.filter((model) => {
      const haystack = `${model.name} ${model.id} ${model.provider} ${model.providerLabel || ''}`.toLowerCase();
      if (haystack.includes(needle)) {
        return true;
      }
      if (!compactNeedle) {
        return false;
      }
      return normalizeSearchToken(haystack).includes(compactNeedle);
    });
  }, [configuredModels, modelSearch]);

  const pendingModelOption = useMemo(() => (
    configuredModels.find((model) => model.id === pendingModelId)
    || availableModels.find((model) => model.id === pendingModelId)
    || null
  ), [availableModels, configuredModels, pendingModelId]);

  const createAgentDisabled = (
    !selectedRuntime
    || !pendingModelId
    || !pendingModelOption
    || creatingAgent
    || selectedRuntimeUnavailable
  );
  const createAgentLabel = creatingAgent ? townText.create.creating : townText.create.createAgent;

  const taskStatusMeta = useMemo(() => (
    Object.fromEntries(
      Object.entries(TASK_STATUS_META).map(([key, meta]) => [
        key,
        {
          ...meta,
          label: townText.taskStatus[key] || meta.label,
        },
      ]),
    )
  ), [townText]);

  const crewHelpers = useMemo(() => ({
    getAgentIdentity,
    getAgentSessionKey,
    fmtDate,
    fmtTime,
    fmtRelative,
    shortId,
  }), []);

  const loadHistory = useCallback(async (sessionKey, identity, force = false) => {
    if (!sessionKey || !identity) return;
    if (!force && messageMap[identity] !== undefined) return;

    if (USE_AGENT_TOWN_MOCK) {
      const mockAgent = combinedAgents.find((agent) => getAgentIdentity(agent) === identity);
      const mockEvents = mockAgent ? (eventsByAgentList[mockAgent.id] || []) : [];
      setMessageMap((prev) => ({
        ...prev,
        [identity]: buildMockHistory(mockAgent, mockEvents),
      }));
      return;
    }

    setLoadingHistoryIdentity(identity);
    try {
      const res = await fetch(`/api/chat/history?session_key=${encodeURIComponent(sessionKey)}&limit=100`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Failed to load history');
      }
      const json = await res.json();
      const history = Array.isArray(json.messages)
        ? json.messages.map(normalizeHistoryMessage).filter(Boolean)
        : [];
      setMessageMap((prev) => ({
        ...prev,
        [identity]: history,
      }));
    } catch (err) {
      console.warn('[TownConsole] history error:', err);
      setMessageMap((prev) => ({
        ...prev,
        [identity]: prev[identity] || [],
      }));
    } finally {
      setLoadingHistoryIdentity((prev) => (prev === identity ? '' : prev));
    }
  }, [combinedAgents, eventsByAgentList, messageMap]);

  useEffect(() => {
    if (!currentSessionKey || !currentIdentity) return;
    loadHistory(currentSessionKey, currentIdentity);
  }, [currentIdentity, currentSessionKey, loadHistory]);

  const handleInspectAgent = useCallback((agent) => {
    if (!agent || !traceAgentsById[agent.id]) return;
    onSelectAgent({
      agent: traceAgentsById[agent.id],
      charName: charNameMap[agent.id] || CHAR_NAMES[0],
      state: getAgentState(agent.status),
      event: eventsByAgent[agent.id] || null,
      events: eventsByAgentList[agent.id] || [],
      isPending: agent.status === 'pending',
      totalTokens: tokensByAgent[agent.id] || 0,
    });
  }, [charNameMap, eventsByAgent, eventsByAgentList, onSelectAgent, tokensByAgent, traceAgentsById]);

  const startModelValidation = useCallback((modelId, modelName = '') => {
    const targetModelId = String(modelId || '').trim();
    if (!targetModelId) return Promise.resolve(false);

    const label = String(modelName || '').trim() || targetModelId;
    const currentState = modelValidationMapRef.current[targetModelId];
    if (currentState?.status === 'ready') {
      return Promise.resolve(true);
    }

    if (USE_AGENT_TOWN_MOCK) {
      setModelValidationMap((prev) => ({
        ...prev,
        [targetModelId]: { status: 'ready', label, lastError: '' },
      }));
      return Promise.resolve(true);
    }

    const runningJob = modelValidationJobsRef.current.get(targetModelId);
    if (runningJob?.promise) {
      return runningJob.promise;
    }

    const job = {
      cancelled: false,
      controller: null,
      timeoutId: null,
      promise: null,
    };

    const waitForNextAttempt = (delayMs) => new Promise((resolve) => {
      if (job.cancelled) {
        resolve();
        return;
      }
      job.timeoutId = window.setTimeout(() => {
        job.timeoutId = null;
        resolve();
      }, delayMs);
    });

    setModelValidationMap((prev) => ({
      ...prev,
      [targetModelId]: { status: 'checking', label, lastError: '' },
    }));

    job.promise = (async () => {
      let attempt = 0;

      while (!job.cancelled) {
        const controller = new AbortController();
        job.controller = controller;
        try {
          const response = await fetch(`/api/chat/model-readiness?model_id=${encodeURIComponent(targetModelId)}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          const payload = await response.json().catch(() => null);
          if (job.cancelled) return false;

          if (response.ok && payload?.ready) {
            setModelValidationMap((prev) => ({
              ...prev,
              [targetModelId]: { status: 'ready', label, lastError: '' },
            }));
            await loadAvailableModels();
            return true;
          }

          const message = attempt >= 2
            ? (payload?.reason || payload?.detail || '')
            : '';
          setModelValidationMap((prev) => {
            const previous = prev[targetModelId];
            if (previous?.status === 'ready') return prev;
            return {
              ...prev,
              [targetModelId]: {
                status: 'checking',
                label: previous?.label || label,
                lastError: message,
              },
            };
          });
        } catch (err) {
          if (job.cancelled || isAbortError(err)) return false;
          const message = attempt >= 2 && err instanceof Error ? err.message : '';
          setModelValidationMap((prev) => {
            const previous = prev[targetModelId];
            if (previous?.status === 'ready') return prev;
            return {
              ...prev,
              [targetModelId]: {
                status: 'checking',
                label: previous?.label || label,
                lastError: message,
              },
            };
          });
        } finally {
          job.controller = null;
        }

        attempt += 1;
        const delay = attempt < 5 ? 1000 : attempt < 10 ? 2000 : 4000;
        await waitForNextAttempt(delay);
      }

      return false;
    })().finally(() => {
      job.controller?.abort();
      job.controller = null;
      if (job.timeoutId) {
        window.clearTimeout(job.timeoutId);
        job.timeoutId = null;
      }
      if (modelValidationJobsRef.current.get(targetModelId) === job) {
        modelValidationJobsRef.current.delete(targetModelId);
      }
    });

    modelValidationJobsRef.current.set(targetModelId, job);
    return job.promise;
  }, [loadAvailableModels]);

  useEffect(() => {
    const currentSelectionStillExists = pendingModelId
      ? configuredModels.some((model) => model.id === pendingModelId)
      : false;
    if (currentSelectionStillExists) {
      return;
    }

    const fallbackModelId = lastUsedConfiguredModelId || defaultModel || configuredModels[0]?.id || '';
    if (!fallbackModelId) {
      return;
    }

    if (!pendingModelId && didAutoSelectModelRef.current) {
      return;
    }

    didAutoSelectModelRef.current = true;
    setPendingModelId(fallbackModelId);
  }, [configuredModels, defaultModel, lastUsedConfiguredModelId, pendingModelId]);

  // Model readiness is now checked at Create Agent click time, not via background polling.

  const handleChangeRuntime = useCallback((instanceId) => {
    if (!instanceId || instanceId === selectedRuntimeId) return;
    setSelectedRuntimeId(instanceId);
    setAvailableModels([]);
    setDefaultModel('');
    setPendingModelId('');
    setCreateError('');
    setModelValidationMap({});
    didAutoSelectModelRef.current = false;
  }, [selectedRuntimeId]);

  const handlePickModel = useCallback((modelId) => {
    didAutoSelectModelRef.current = true;
    setPendingModelId((prev) => (prev === modelId ? '' : modelId));
    setCreateError('');
  }, []);

  const handleOpenModelSetup = useCallback(() => {
    setModelSetupOpen(true);
    setCreateError('');
  }, []);

  // §36 — drop one entry from the XSafeClaw configured-model ledger.
  // Hermes-only: gated by ``platform === 'hermes'`` at the call site so
  // OpenClaw never even renders the trigger.  Refuses (server-side, HTTP
  // 409) when the target is the active model in ~/.hermes/config.yaml; we
  // surface that as a ``createError`` rather than a silent no-op so the
  // user understands they need to switch active first.  The local lists
  // are mutated optimistically AFTER the server confirms the delete, so
  // a network failure leaves the picker untouched.
  const handleDeleteConfiguredModel = useCallback(async (modelId, modelName) => {
    if (!modelId) return;
    if (platform !== 'hermes') return;
    const label = modelName || modelId;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Remove "${label}" from your configured models?\n\n`
        + 'The provider API key stays in ~/.hermes/.env, so any agent already '
        + 'created with this model keeps working. Only the picker is affected.',
      );
      if (!ok) return;
    }
    try {
      await systemAPI.removeConfiguredModel(modelId);
      setAvailableModels((prev) => prev.filter((m) => m.id !== modelId));
      setPendingModelId((prev) => (prev === modelId ? '' : prev));
      // ``lastUsedConfiguredModelId`` is derived (useMemo over agents'
      // pinned model_ids), so it'll self-update on the next render now
      // that ``availableModels`` no longer carries the deleted entry.
      if (recentlyConfiguredModelId === modelId) setRecentlyConfiguredModelId('');
      setCreateError('');
      // Re-pull from the server so the next auto-pick sees the same source
      // of truth the picker now reflects (and so any cache layers between
      // us and ``/api/chat/available-models`` stay coherent).
      loadAvailableModels();
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to remove model.';
      setCreateError(String(detail));
    }
  }, [
    platform,
    loadAvailableModels,
    recentlyConfiguredModelId,
  ]);

  const handleModelConfigured = useCallback(async ({ modelId, modelName, provider, reasoning, modelReady }) => {
    const normalizedModel = {
      id: modelId,
      name: modelName || modelId,
      provider: provider || String(modelId || '').split('/')[0] || '',
      reasoning: Boolean(reasoning),
    };

    setAvailableModels((prev) => (
      prev.some((model) => model.id === modelId)
        ? prev.map((model) => (model.id === modelId ? { ...model, ...normalizedModel } : model))
        : [normalizedModel, ...prev]
    ));
    setDefaultModel(modelId || '');
    didAutoSelectModelRef.current = true;
    setPendingModelId(modelId || '');
    setRecentlyConfiguredModelId(modelId || '');
    setModelSetupOpen(false);
    setCreateError('');
  }, []);

  const handleCreateAgent = useCallback(async () => {
    if (!pendingModelId || !pendingModelOption || creatingAgent) return;
    if (!selectedRuntime) {
      setCreateError(townText.create.missingRuntime);
      return;
    }
    if (selectedRuntimeUnavailable) {
      setCreateError(runtimeUnavailableMessage);
      return;
    }

    // Check if nanobot is selected but not installed
    if (selectedRuntime?.platform === 'nanobot' && nanobotInstalled === false) {
      setCreateError(townText.create.nanobotNotInstalled || 'Nanobot is not installed. Go to the setup page to install it.');
      return;
    }

    setCreatingAgent(true);
    setCreateError('');
    try {
      // Quick readiness check — don't block the button, but catch unready models early.
      try {
        const readinessQuery = new URLSearchParams({
          model_id: pendingModelId,
          instance_id: selectedRuntime.instance_id,
        });
        const readinessRes = await fetch(
          `/api/chat/model-readiness?${readinessQuery.toString()}`,
          { cache: 'no-store' },
        );
        const readiness = await readinessRes.json().catch(() => null);
        if (readinessRes.ok && readiness && !readiness.ready) {
          const reason = readiness.reason || townText.create.modelPreparing;
          setCreateError(reason);
          setCreatingAgent(false);
          return;
        }
      } catch {
        // Readiness check failed — proceed anyway, start-session will catch real errors.
      }

      const modelOption = configuredModels.find((item) => item.id === pendingModelId);

      if (USE_AGENT_TOWN_MOCK) {
        const sessionKey = `chat-mock-${makeId().slice(0, 10)}`;
        if (DEMO_MODE) markDemoSession(sessionKey);
        const draftAgent = {
          ...buildDraftAgent(sessionKey, modelOption, selectedRuntime),
          mock: true,
          channel: selectedRuntime.platform === 'nanobot'
            ? 'nanobot-gateway'
            : modelOption?.provider === 'Google' ? 'discord' : 'webchat',
        };
        const identity = getAgentIdentity(draftAgent);

        setDraftAgents((prev) => [draftAgent, ...prev]);
        setMessageMap((prev) => ({ ...prev, [identity]: [] }));
        setInputMap((prev) => ({ ...prev, [identity]: '' }));
        setSelectedFilter('working');
        setSelectedIdentity(identity);
        setModelPickerOpen(false);
        setModelSearch('');
        setPendingModelId('');
        return;
      }

      const res = await fetch('/api/chat/start-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: selectedRuntime.instance_id,
          model_override: pendingModelId,
        }),
      });

      if (!res.ok) {
        throw new Error(await readFetchError(res, 'Failed to create new agent session.'));
      }

      const json = await res.json();
      const sessionKey = json.session_key;
      if (DEMO_MODE) markDemoSession(sessionKey);
      const draftAgent = buildDraftAgent(sessionKey, modelOption, json.instance || selectedRuntime);
      const identity = getAgentIdentity(draftAgent);

      setDraftAgents((prev) => [draftAgent, ...prev]);
      setMessageMap((prev) => ({ ...prev, [identity]: prev[identity] || [] }));
      setInputMap((prev) => ({ ...prev, [identity]: '' }));
      setSelectedFilter('working');
      setSelectedIdentity(identity);
      setModelPickerOpen(false);
      setModelSearch('');
      setPendingModelId('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : townText.create.failed);
    } finally {
      setCreatingAgent(false);
    }
  }, [
    configuredModels,
    creatingAgent,
    nanobotInstalled,
    pendingModelId,
    pendingModelOption,
    runtimeUnavailableMessage,
    selectedRuntime,
    selectedRuntimeUnavailable,
    townText,
  ]);

  const handleSendTask = useCallback(async () => {
    if (!currentSessionKey || !currentIdentity || sendingIdentity === currentIdentity) return;
    const text = currentInput.trim();
    const nanobotTextOnly = isNanobotAgent(currentAgent);
    const imagesToSend = nanobotTextOnly ? [] : [...currentPendingImages];
    if (!text && imagesToSend.length === 0) return;

    const userMsg = {
      id: makeId(),
      role: 'user',
      content: text || '(see attached image)',
      timestamp: new Date(),
      images: imagesToSend.map((img) => ({ dataUrl: img.dataUrl })),
    };
    const pendingId = makeId();
    const pendingMsg = {
      id: pendingId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      pending: true,
    };

    setInputMap((prev) => ({ ...prev, [currentIdentity]: '' }));
    setPendingImagesMap((prev) => ({ ...prev, [currentIdentity]: [] }));
    setMessageMap((prev) => ({
      ...prev,
      [currentIdentity]: [...(prev[currentIdentity] || []), userMsg, pendingMsg],
    }));
    setSendingIdentity(currentIdentity);
    stopRequestedRef.current = false;

    const finalizeStoppedMessage = () => {
      setMessageMap((prev) => ({
        ...prev,
        [currentIdentity]: (prev[currentIdentity] || []).map((msg) => (
          msg.id === pendingId
            ? {
                ...msg,
                content: townText.stage.stopRequested,
                pending: false,
                stopped: true,
              }
            : msg
        )),
      }));
    };

    try {
      if (USE_AGENT_TOWN_MOCK) {
        const reply = buildMockAssistantReply(text, currentAgent);
        mockReplyTimeoutRef.current = window.setTimeout(() => {
          setMessageMap((prev) => ({
            ...prev,
            [currentIdentity]: (prev[currentIdentity] || []).map((msg) => (
              msg.id === pendingId
                ? { ...msg, content: reply.text, pending: false }
                : msg
            )),
          }));
          mockReplyTimeoutRef.current = null;
        }, 420);
        return;
      }

      const controller = new AbortController();
      streamControllerRef.current = controller;

      const body = { session_key: currentSessionKey, message: text || '(see attached image)' };
      if (imagesToSend.length > 0 && !nanobotTextOnly) {
        body.images = imagesToSend.map((img) => ({
          mime_type: img.mimeType,
          data: img.base64,
          file_name: img.file.name,
        }));
      }

      const response = await fetch('/api/chat/send-message-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(await readFetchError(response, 'Failed to dispatch mission.'));
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
          if (!raw || raw === '[DONE]') continue;

          try {
            const chunk = JSON.parse(raw);
            if (chunk.type === 'delta' && chunk.text) {
              setMessageMap((prev) => ({
                ...prev,
                [currentIdentity]: (prev[currentIdentity] || []).map((msg) => (
                  msg.id === pendingId ? { ...msg, content: chunk.text, pending: false } : msg
                )),
              }));
            } else if (chunk.type === 'tool_start') {
              const toolMsg = {
                id: `tool-${chunk.tool_id || makeId()}`,
                role: 'tool_call',
                content: '',
                timestamp: new Date(),
                tool_id: chunk.tool_id,
                tool_name: chunk.tool_name,
                args: chunk.args,
                result_pending: true,
              };
              setMessageMap((prev) => {
                const messages = [...(prev[currentIdentity] || [])];
                const insertAt = Math.max(messages.findIndex((msg) => msg.id === pendingId), 0);
                messages.splice(insertAt, 0, toolMsg);
                return { ...prev, [currentIdentity]: messages };
              });
            } else if (chunk.type === 'tool_result') {
              setMessageMap((prev) => ({
                ...prev,
                [currentIdentity]: (prev[currentIdentity] || []).map((msg) => (
                  msg.role === 'tool_call' && msg.tool_id === chunk.tool_id
                    ? {
                        ...msg,
                        result: chunk.result,
                        is_error: chunk.is_error,
                        result_pending: false,
                      }
                    : msg
                )),
              }));
            } else if (chunk.type === 'final') {
              setMessageMap((prev) => ({
                ...prev,
                [currentIdentity]: (prev[currentIdentity] || []).map((msg) => (
                  msg.id === pendingId
                    ? { ...msg, content: chunk.text || msg.content || '[No response]', pending: false }
                    : msg
                )),
              }));
            } else if (chunk.type === 'error' || chunk.type === 'timeout' || chunk.type === 'aborted') {
              setMessageMap((prev) => ({
                ...prev,
                [currentIdentity]: (prev[currentIdentity] || []).map((msg) => (
                  msg.id === pendingId
                    ? {
                        ...msg,
                        role: chunk.type === 'error' ? 'error' : 'assistant',
                        content: chunk.text || `[${chunk.type}]`,
                        pending: false,
                      }
                    : msg
                )),
              }));
            }
          } catch (err) {
            console.warn('[TownConsole] stream parse error:', err);
          }
        }
      }
    } catch (err) {
      if (stopRequestedRef.current || isAbortError(err)) {
        finalizeStoppedMessage();
        return;
      }

      setMessageMap((prev) => ({
        ...prev,
        [currentIdentity]: (prev[currentIdentity] || []).map((msg) => (
          msg.id === pendingId
            ? {
                ...msg,
                role: 'error',
                content: err instanceof Error ? err.message : 'Mission dispatch failed.',
                pending: false,
              }
            : msg
        )),
      }));
    } finally {
      if (mockReplyTimeoutRef.current && stopRequestedRef.current) {
        window.clearTimeout(mockReplyTimeoutRef.current);
        mockReplyTimeoutRef.current = null;
      }
      streamControllerRef.current = null;
      stopRequestedRef.current = false;
      setSendingIdentity('');
      for (const delay of [800, 2500, 5000, 8000]) {
        window.setTimeout(() => {
          loadConsoleData();
          onDataChangedRef.current?.();
        }, delay);
      }
    }
  }, [
    currentAgent,
    currentIdentity,
    currentInput,
    currentPendingImages,
    currentSessionKey,
    loadConsoleData,
    sendingIdentity,
    townText,
  ]);

  const handleStopTask = useCallback(() => {
    if (!sendingIdentity) return;
    stopRequestedRef.current = true;
    if (mockReplyTimeoutRef.current) {
      window.clearTimeout(mockReplyTimeoutRef.current);
      mockReplyTimeoutRef.current = null;
    }
    streamControllerRef.current?.abort();
  }, [sendingIdentity]);

  const handleSelectCurrentNeighbor = useCallback((direction) => {
    if (!filteredAgents.length || !currentAgent) return;
    const currentIndex = filteredAgents.findIndex((agent) => getAgentIdentity(agent) === getAgentIdentity(currentAgent));
    if (currentIndex < 0) {
      setSelectedIdentity(getAgentIdentity(filteredAgents[0]));
      return;
    }
    const nextIndex = (currentIndex + direction + filteredAgents.length) % filteredAgents.length;
    setSelectedIdentity(getAgentIdentity(filteredAgents[nextIndex]));
  }, [currentAgent, filteredAgents]);

  return (
    <div className="tc-shell">
      <div className="tc-frame">
        {!taskDetailOpen && (
          <div className="tc-tabbar">
            {TAB_META.map((tab) => (
              <button
                key={tab.id}
                className={`tc-tab ${activeTab === tab.id ? 'tc-tab-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tc-tab-label">{townText.tabs[tab.id] || tab.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="tc-panel">
          <div className="tc-panel-inner">
            <div className="tc-content">
              {activeTab === 'crew' ? (
                <CrewTab
                  agents={filteredAgents}
                  filter={selectedFilter}
                  onFilterChange={setSelectedFilter}
                  countsByFilter={countsByFilter}
                  charNameMap={charNameMap}
                  currentAgent={currentAgent}
                  currentSummary={currentSummary}
                  currentEvents={currentDashboardEvents}
                  activeMessages={currentMessages}
                  currentInput={currentInput}
                  loadingHistory={loadingHistoryIdentity === currentIdentity}
                  sending={sendingIdentity === currentIdentity}
                  onChangeInput={(value) => {
                    if (!currentIdentity) return;
                    setInputMap((prev) => ({ ...prev, [currentIdentity]: value }));
                  }}
                  onSendTask={handleSendTask}
                  onStopTask={handleStopTask}
                  onPreviousAgent={() => handleSelectCurrentNeighbor(-1)}
                  onNextAgent={() => handleSelectCurrentNeighbor(1)}
                  onSelectAgent={(agent) => setSelectedIdentity(getAgentIdentity(agent))}
                  modelPickerOpen={modelPickerOpen}
                  onToggleModelPicker={() => setModelPickerOpen((prev) => !prev)}
                  runtimeInstances={runtimeInstances}
                  selectedRuntimeId={selectedRuntime?.instance_id || selectedRuntimeId}
                  selectedRuntime={selectedRuntime}
                  onChangeRuntime={handleChangeRuntime}
                  selectedRuntimeUnavailable={selectedRuntimeUnavailable}
                  runtimeUnavailableMessage={runtimeUnavailableMessage}
                  modelSearch={modelSearch}
                  onChangeModelSearch={setModelSearch}
                  filteredModels={filteredModels}
                  pendingModelId={pendingModelId}
                  onPickModel={handlePickModel}
                  // §36 — Hermes-only delete affordance.  CrewTab uses
                  // ``isHermes`` to decide whether to render the × button
                  // at all; ``onDeleteModel`` is wired to the same ledger
                  // endpoint that POST /system/quick-model-config writes,
                  // and refuses (HTTP 409) on the active model.
                  isHermes={platform === 'hermes'}
                  onDeleteModel={handleDeleteConfiguredModel}
                  onOpenModelSetup={handleOpenModelSetup}
                  onCreateAgent={handleCreateAgent}
                  createAgentDisabled={createAgentDisabled}
                  createAgentLabel={createAgentLabel}
                  createError={createError}
                  taskStatusMeta={taskStatusMeta}
                  pendingApprovals={pendingApprovals}
                  onResolveGuardPending={handleResolveGuardPending}
                  guardResolvingId={guardResolvingId}
                  onDeleteAgent={onDeleteAgent}
                  tokensByAgent={tokensByAgent}
                  helpers={crewHelpers}
                  pendingImages={currentPendingImages}
                  onAddImages={addImages}
                  onRemoveImage={removeImage}
                  fileInputRef={fileInputRef}
                  onTaskDetailChange={setTaskDetailOpen}
                  imagesDisabled={isNanobotAgent(currentAgent)}
                  imagesDisabledReason={townText.stage.nanobotTextOnly}
                  townText={townText}
                />
              ) : null}

              {activeTab === 'control' ? (
                <ControlTab
                  mapVariants={mapVariants}
                  activeMapId={activeMapId}
                  onChangeMap={onChangeMap}
                  musicTracks={musicTracks}
                  activeMusicId={activeMusicId}
                  onChangeMusic={onChangeMusic}
                  musicEnabled={musicEnabled}
                  onToggleMusic={onToggleMusic}
                  musicVolume={musicVolume}
                  onChangeMusicVolume={onChangeMusicVolume}
                  sceneNpcDisplayMode={sceneNpcDisplayMode}
                  onChangeSceneNpcDisplayMode={onChangeSceneNpcDisplayMode}
                  sceneNpcDisplayCap={sceneNpcDisplayCap}
                  onChangeSceneNpcDisplayCap={onChangeSceneNpcDisplayCap}
                  minSceneNpcDisplayCap={countsByFilter.pending || 0}
                  maxSceneNpcDisplayCap={(countsByFilter.working || 0) + (countsByFilter.pending || 0)}
                  guardEnabled={guardEnabled}
                  onToggleGuard={onToggleGuard}
                  townText={townText}
                />
              ) : null}

              {activeTab === 'tasks' ? (
                <TasksTab
                  dashboardEvents={effectiveDashboardEvents}
                  pendingApprovals={pendingApprovals}
                  agentsById={traceAgentsById}
                  agentsBySessionKey={traceAgentsBySessionKey}
                  charNameMap={charNameMap}
                  onResolveGuardPending={handleResolveGuardPending}
                  guardResolvingId={guardResolvingId}
                  guardEnabled={guardEnabled}
                  onToggleGuard={onToggleGuard}
                  onTaskDetailChange={setTaskDetailOpen}
                  taskStatusMeta={taskStatusMeta}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <ModelSetupModal
        open={modelSetupOpen}
        authProviders={catalogAuthProviders}
        modelProviders={catalogModelProviders}
        providerEndpoints={providerEndpoints}
        defaults={onboardDefaults}
        loading={modelCatalogLoading && !modelCatalogLoaded}
        loadingError={modelCatalogLoaded ? '' : modelCatalogError}
        onRetry={() => loadModelCatalog(true)}
        onClose={() => setModelSetupOpen(false)}
        onConfigured={handleModelConfigured}
      />
    </div>
  );
}
