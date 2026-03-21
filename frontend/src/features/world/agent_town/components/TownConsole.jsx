import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAR_BASE, CHAR_NAMES, USE_AGENT_TOWN_MOCK } from '../config/constants';
import {
  buildMockAssistantReply,
  buildMockHistory,
  generateMockData,
  MOCK_MODEL_PROVIDERS,
  normalizeTownData,
} from '../data/mockData';
import ControlTab from './ControlTab';
import CrewTab from './CrewTab';

const TAB_META = [
  { id: 'crew', label: 'Agents' },
  { id: 'control', label: 'Control' },
  { id: 'tasks', label: 'Tasks' },
];

const FILTER_IDS = ['working', 'pending', 'offline'];

const TASK_STATUS_META = {
  ok: { label: 'COMPLETE', className: 'tc-task-complete' },
  error: { label: 'FAILED', className: 'tc-task-failed' },
  running: { label: 'RUNNING', className: 'tc-task-running' },
  pending: { label: 'PENDING', className: 'tc-task-flagged' },
  completed: { label: 'COMPLETED', className: 'tc-task-complete' },
  failed: { label: 'FAILED', className: 'tc-task-failed' },
};

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shortId(value) {
  return String(value || '').slice(0, 8);
}

function normalizeSessionIdentity(value) {
  const text = String(value || '');
  return text.startsWith('agent:main:') ? text.slice('agent:main:'.length) : text;
}

function getAgentSessionKey(agent) {
  return agent?.session_key || '';
}

function getAgentIdentity(agent) {
  return normalizeSessionIdentity(getAgentSessionKey(agent) || agent?.id || '');
}

function fmtTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('en-US', {
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

function fmtExactDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('en-US', {
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

function durationStr(startTs, endTs) {
  const start = startTs ? new Date(startTs).getTime() : NaN;
  const end = endTs ? new Date(endTs).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '---';
  const totalSec = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
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

function summarizeTasks(events = []) {
  return events.reduce((summary, event) => {
    if (event.status === 'ok' || event.status === 'completed') summary.completed += 1;
    else if (event.status === 'error') summary.failed += 1;
    else if (event.status === 'pending') summary.pending += 1;
    else summary.running += 1;
    return summary;
  }, {
    completed: 0,
    failed: 0,
    pending: 0,
    running: 0,
  });
}

function buildDraftAgent(sessionKey, modelOption) {
  const modelRef = modelOption?.id || 'unknown/model';
  const provider = modelOption?.provider || modelRef.split('/')[0] || 'unknown';
  const modelName = modelOption?.name || modelRef.split('/').slice(1).join('/') || modelRef;
  const suffix = shortId(normalizeSessionIdentity(sessionKey)).toUpperCase();
  return {
    id: `draft:${sessionKey}`,
    session_key: sessionKey,
    name: `Agent-${suffix}`,
    pid: suffix,
    provider,
    model: modelName,
    status: 'working',
    first_seen_at: new Date().toISOString(),
    channel: 'webchat',
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
  if (status === 'completed') return 'completed';
  if (status === 'error') return 'failed';
  return 'running';
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
    status: event.status === 'ok' ? 'completed' : event.status === 'error' ? 'error' : 'pending',
    error_message: event.status === 'error' ? pickEventSnippet(event) : null,
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

function formatTaskId(value, length = 12) {
  return String(value || '').slice(0, length) || '---';
}

function pickUserPromptSnippet(event) {
  const conversations = event?.conversations || [];
  for (let i = 0; i < conversations.length; i += 1) {
    const msg = conversations[i];
    if (msg.role === 'user' && (msg.text || msg.content_text)) {
      return (msg.text || msg.content_text || '').slice(0, 180);
    }
  }
  return '';
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

function normalizeTaskDetailMessages(messages = [], idPrefix = 'trace') {
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

function buildTaskDetailMessagesFromTraceEvent(event) {
  return normalizeTaskDetailMessages(event?.conversations || [], event?.event_id || 'trace');
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
  if (status === 'failed' || status === 'error') return 'danger';
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
  const timestamp = fmtDate(msg.timestamp);
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
            <span className="tc-task-detail-role">{isUser ? 'USER' : 'ASSISTANT'}</span>
            <span className="tc-task-detail-time">{timestamp}</span>
          </div>
          <div className="tc-task-detail-text">{msg.content_text}</div>
        </div>
      ) : null}

      {isTool ? (
        <div className={`tc-task-detail-tool ${msg.is_error ? 'tc-task-detail-tool-result' : 'tc-task-detail-tool-call'}`}>
          <div className="tc-task-detail-tool-head">
            <span className="tc-task-detail-tool-tag">{msg.result_pending ? 'TOOL RUNNING' : msg.is_error ? 'TOOL ERROR' : 'TOOL'}</span>
            <span className="tc-task-detail-tool-name">{msg.tool_name || 'tool-call'}</span>
            <span className="tc-task-detail-time">{timestamp}</span>
          </div>
          {hasToolCall ? (
            <>
              <div className="tc-task-detail-tool-head">
                <span className="tc-task-detail-tool-tag">TOOL CALL</span>
              </div>
              <pre className="tc-task-detail-tool-payload">{stringifyTaskValue(msg.tool_arguments)}</pre>
            </>
          ) : null}
          {hasToolResult ? (
            <>
              <div className="tc-task-detail-tool-head">
                <span className="tc-task-detail-tool-tag">TOOL RESULT</span>
              </div>
              <pre className="tc-task-detail-tool-payload">{msg.result_pending ? 'Running...' : stringifyTaskValue(msg.tool_result)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TasksTab({
  dashboardEvents,
  pendingApprovals,
  agentsById,
  agentsBySessionKey,
  traceEvents,
  charNameMap,
}) {
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

  const groupedTasks = useMemo(() => ({
    completed: sortedDashboardEvents.filter((event) => event.status === 'completed'),
    failed: sortedDashboardEvents.filter((event) => event.status === 'error'),
    running: sortedDashboardEvents.filter((event) => event.status === 'pending'),
  }), [sortedDashboardEvents]);

  const traceEventIndex = useMemo(() => {
    const map = {};
    traceEvents.forEach((event) => {
      const key = buildTaskTimeKey(event.agent_id, event.start_time);
      if (key) map[key] = event;
    });
    return map;
  }, [traceEvents]);

  const openPendingApproval = useCallback((item, index) => {
    const liveAgent = agentsBySessionKey[item.session_key];
    const charName = liveAgent
      ? (charNameMap[liveAgent.id] || CHAR_NAMES[index % CHAR_NAMES.length])
      : CHAR_NAMES[index % CHAR_NAMES.length];

    setSelectedTask({
      kind: 'pending',
      item,
      charName,
      agentId: liveAgent?.id || item.session_key || item.id,
      agentName: liveAgent?.name || `Agent-${shortId(liveAgent?.id || item.session_key || item.id)}`,
      promptSnippet: extractPendingContextSnippet(item),
    });
    setDetailMessages([]);
    setDetailError('');
    setDetailEventData(null);
  }, [agentsBySessionKey, charNameMap]);

  const openDashboardTask = useCallback((task, index) => {
    const liveAgent = agentsById[task.session_id];
    const charName = liveAgent
      ? (charNameMap[liveAgent.id] || CHAR_NAMES[index % CHAR_NAMES.length])
      : CHAR_NAMES[index % CHAR_NAMES.length];
    const traceEvent = traceEventIndex[buildTaskTimeKey(task.session_id, task.started_at)] || null;

    setSelectedTask({
      kind: 'dashboard',
      task,
      traceEvent,
      charName,
      agentId: liveAgent?.id || task.session_id,
      agentName: liveAgent?.name || `Agent-${shortId(task.session_id)}`,
      promptSnippet: pickUserPromptSnippet(traceEvent),
    });
    setDetailError('');
    setDetailEventData(null);
  }, [agentsById, charNameMap, traceEventIndex]);

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

    if (!selectedTask || selectedTask.kind !== 'dashboard') {
      setDetailMessages([]);
      setDetailLoading(false);
      setDetailEventData(null);
      return () => {
        disposed = true;
      };
    }

    const fallbackMessages = buildTaskDetailMessagesFromTraceEvent(selectedTask.traceEvent);
    if (USE_AGENT_TOWN_MOCK) {
      setDetailMessages(fallbackMessages);
      setDetailLoading(false);
      setDetailEventData(null);
      return () => {
        disposed = true;
      };
    }

    const loadDetail = async () => {
      setDetailLoading(true);
      try {
        const response = await fetch(`/api/events/${selectedTask.task.id}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Task detail request failed: ${response.status}`);
        }
        const payload = await response.json();
        if (disposed) return;
        const messages = normalizeTaskDetailMessages(Array.isArray(payload.messages) ? payload.messages : [], selectedTask.task.id);
        setDetailEventData(payload);
        setDetailMessages(messages.length ? messages : fallbackMessages);
      } catch (err) {
        console.warn('[TownConsole] task detail fetch error:', err);
        if (disposed) return;
        setDetailEventData(null);
        setDetailMessages(fallbackMessages);
        setDetailError(err instanceof Error ? err.message : 'Failed to load task detail.');
      } finally {
        if (!disposed) setDetailLoading(false);
      }
    };

    loadDetail();
    return () => {
      disposed = true;
    };
  }, [selectedTask]);

  const detailTask = selectedTask?.kind === 'dashboard'
    ? (detailEventData || selectedTask.task)
    : null;
  const detailStatusId = mapDashboardTaskStatus(detailTask?.status || selectedTask?.task?.status);

  return (
    <div className="tc-task-layout">
      <section className="tc-ornate-panel tc-task-lane tc-task-lane-pending">
        <div className="tc-task-lane-head">
          <div>
            <div className="tc-task-lane-overline">MANUAL REVIEW</div>
            <div className="tc-task-lane-title">Pending</div>
          </div>
          <div className="tc-task-lane-count tc-task-lane-count-pending">{unresolvedApprovals.length}</div>
        </div>
        <div className="tc-task-lane-note">
          Guard-blocked tool calls stay here until a reviewer approves, rejects, or modifies them.
        </div>
        <div className="tc-task-lane-list tc-task-lane-list-pending">
          {unresolvedApprovals.length === 0 ? (
            <div className="tc-empty tc-task-empty-pending">No tasks are waiting on human review.</div>
          ) : unresolvedApprovals.map((item, index) => {
            const liveAgent = agentsBySessionKey[item.session_key];
            const charName = liveAgent
              ? (charNameMap[liveAgent.id] || CHAR_NAMES[index % CHAR_NAMES.length])
              : CHAR_NAMES[index % CHAR_NAMES.length];
            const promptSnippet = extractPendingContextSnippet(item)
              || item.failure_mode
              || item.risk_source
              || 'Awaiting reviewer guidance before this step can continue.';
            return (
              <button
                key={item.id}
                type="button"
                className={`tc-task-card tc-task-card-pending-review ${selectedTask?.kind === 'pending' && selectedTask.item.id === item.id ? 'tc-task-card-selected' : ''}`}
                onClick={() => openPendingApproval(item, index)}
              >
                <div className="tc-task-card-top">
                  <div className="tc-task-card-main">
                    <div className="tc-task-head">
                      <span className="tc-task-badge tc-task-flagged">PENDING</span>
                      <span className="tc-task-badge tc-task-pending-marker">HUMAN REVIEW</span>
                    </div>
                    <div className="tc-task-title">Task {formatTaskId(item.id)}</div>
                    <div className="tc-task-card-meta">
                      <div>START</div>
                      <span>{fmtTime((item.created_at || 0) * 1000)}</span>
                      <div>END</div>
                      <span>---</span>
                    </div>
                  </div>
                  <div className="tc-task-card-side">
                    <div className="tc-task-exact-time">{fmtExactDate((item.created_at || 0) * 1000)}</div>
                    <TaskActorStrip
                      charName={charName}
                      agentId={liveAgent?.id || item.session_key || item.id}
                    />
                  </div>
                </div>
                <div className="tc-task-snippet">{promptSnippet}</div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="tc-task-main">
        <section className="tc-ornate-panel tc-task-board">
          <div className="tc-task-board-head">
            <div>
              <div className="tc-task-lane-overline">DASHBOARD STATUS</div>
              <div className="tc-task-lane-title">Task Flow</div>
            </div>
            <div className="tc-task-board-summary">
              <span>{groupedTasks.completed.length} completed</span>
              <span>{groupedTasks.failed.length} failed</span>
              <span>{groupedTasks.running.length} running</span>
            </div>
          </div>
          <div className="tc-task-board-note">
            Mixed task stream sorted by newest start time, with each card carrying its own status.
          </div>
          <div className="tc-task-board-grid">
            {sortedDashboardEvents.length === 0 ? (
              <div className="tc-empty tc-task-board-empty">No dashboard tasks right now.</div>
            ) : sortedDashboardEvents.map((task, index) => {
              const liveAgent = agentsById[task.session_id];
              const traceEvent = traceEventIndex[buildTaskTimeKey(task.session_id, task.started_at)] || null;
              const promptSnippet = pickUserPromptSnippet(traceEvent) || task.error_message || 'No user prompt preview captured.';
              const charName = liveAgent
                ? (charNameMap[liveAgent.id] || CHAR_NAMES[index % CHAR_NAMES.length])
                : CHAR_NAMES[index % CHAR_NAMES.length];
              const statusId = mapDashboardTaskStatus(task.status);
              const statusMeta = TASK_STATUS_META[statusId] || TASK_STATUS_META.running;

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
                      <div className="tc-task-title">Task {formatTaskId(task.id)}</div>
                      <div className="tc-task-card-meta">
                        <div>START</div>
                        <span>{fmtTime(task.started_at)}</span>
                        <div>END</div>
                        <span>{task.completed_at ? fmtTime(task.completed_at) : '---'}</span>
                      </div>
                    </div>
                    <div className="tc-task-card-side">
                      <div className="tc-task-exact-time">{fmtExactDate(task.started_at)}</div>
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
                  {selectedTask.kind === 'pending' ? 'PENDING APPROVAL' : 'TASK DETAIL'}
                </div>
                <div className="tc-task-lane-title">
                  {selectedTask.kind === 'pending'
                    ? `Task ${formatTaskId(selectedTask.item.id)}`
                    : `Task ${formatTaskId(selectedTask.task.id)}`}
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
                CLOSE
              </button>
            </div>

            {selectedTask.kind === 'pending' ? (
              <>
                <div className="tc-task-detail-summary tc-task-detail-summary-flat">
                  <TaskDetailFact label="Task ID" value={formatTaskId(selectedTask.item.id, 18)} mono featured />
                  <TaskDetailFact label="Agent" value={selectedTask.agentName} featured />
                  <TaskDetailFact label="Session" value={selectedTask.item.session_key || '---'} mono wide tone="info" />
                  <TaskDetailFact label="Status" value="PENDING REVIEW" featured tone="warn" />
                  <TaskDetailFact label="Tool" value={selectedTask.item.tool_name || 'tool-call'} tone="tool" />
                  <TaskDetailFact label="Started At" value={fmtDate((selectedTask.item.created_at || 0) * 1000)} />
                  <TaskDetailFact label="Completed At" value="---" />
                  <TaskDetailFact label="Guard Verdict" value={selectedTask.item.guard_verdict || 'unsafe'} tone="danger" />
                </div>

                <div className="tc-task-detail-pending">
                  <div className="tc-task-detail-pending-grid">
                    <div className="tc-task-detail-tool tc-task-detail-tool-call">
                      <div className="tc-task-detail-tool-head">
                        <span className="tc-task-detail-tool-tag">TOOL CALL</span>
                        <span className="tc-task-detail-tool-name">{selectedTask.item.tool_name || 'tool-call'}</span>
                      </div>
                      <pre className="tc-task-detail-tool-payload">{stringifyTaskValue(selectedTask.item.params || {})}</pre>
                    </div>
                    <div className="tc-task-detail-tool tc-task-detail-tool-result">
                      <div className="tc-task-detail-tool-head">
                        <span className="tc-task-detail-tool-tag">GUARD RESULT</span>
                        <span className="tc-task-detail-tool-name">{selectedTask.item.guard_verdict || 'unsafe'}</span>
                      </div>
                      <div className="tc-task-detail-pending-notes">
                        <div><strong>Risk Source:</strong> {selectedTask.item.risk_source || '---'}</div>
                        <div><strong>Failure Mode:</strong> {selectedTask.item.failure_mode || '---'}</div>
                        <div><strong>Real World Harm:</strong> {selectedTask.item.real_world_harm || '---'}</div>
                      </div>
                    </div>
                  </div>
                  <div className="tc-task-detail-context">
                    <div className="tc-task-detail-context-title">SESSION CONTEXT</div>
                    <pre className="tc-task-detail-context-body">{selectedTask.item.session_context || 'No session context captured for this pending approval.'}</pre>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="tc-task-detail-summary tc-task-detail-summary-flat">
                  <TaskDetailFact label="Task ID" value={formatTaskId(detailTask?.id || selectedTask.task.id, 18)} mono featured />
                  <TaskDetailFact label="Agent" value={selectedTask.agentName} featured />
                  <TaskDetailFact label="Session" value={detailTask?.session_id || selectedTask.task.session_id} mono wide tone="info" />
                  <TaskDetailFact label="User Message" value={detailTask?.user_message_id || selectedTask.task.user_message_id || '---'} mono wide />
                  <TaskDetailFact
                    label="Status"
                    value={(TASK_STATUS_META[detailStatusId] || TASK_STATUS_META.running).label}
                    featured
                    tone={taskDetailToneFromStatus(detailStatusId)}
                  />
                  <TaskDetailFact label="Started At" value={fmtDate(detailTask?.started_at || selectedTask.task.started_at)} />
                  <TaskDetailFact label="Completed At" value={(detailTask?.completed_at || selectedTask.task.completed_at) ? fmtDate(detailTask?.completed_at || selectedTask.task.completed_at) : '---'} />
                  <TaskDetailFact label="Duration" value={durationStr(detailTask?.started_at || selectedTask.task.started_at, detailTask?.completed_at || selectedTask.task.completed_at)} />
                  <TaskDetailFact label="Total Messages" value={String(detailTask?.total_messages ?? selectedTask.task.total_messages ?? 0)} />
                  <TaskDetailFact label="Assistant Msgs" value={String(detailTask?.total_assistant_messages ?? '---')} />
                  <TaskDetailFact label="Tool Result Msgs" value={String(detailTask?.total_tool_result_messages ?? '---')} />
                  <TaskDetailFact label="Tool Calls" value={String(detailTask?.total_tool_calls ?? selectedTask.task.total_tool_calls ?? 0)} tone="tool" />
                  <TaskDetailFact label="Input Tokens" value={fmtTokens(detailTask?.total_input_tokens)} />
                  <TaskDetailFact label="Output Tokens" value={fmtTokens(detailTask?.total_output_tokens)} />
                  <TaskDetailFact label="Total Tokens" value={fmtTokens(detailTask?.total_tokens ?? selectedTask.task.total_tokens)} featured tone="info" />
                </div>

                {detailTask?.error_message || selectedTask.task.error_message ? (
                  <div className="tc-task-detail-alert">
                    <div className="tc-task-detail-context-title">ERROR</div>
                    <div className="tc-task-detail-alert-copy">{detailTask?.error_message || selectedTask.task.error_message}</div>
                  </div>
                ) : null}

                <div className="tc-task-detail-stream">
                  {detailLoading ? (
                    <div className="tc-empty">Loading task detail…</div>
                  ) : detailMessages.length === 0 ? (
                    <div className="tc-empty">{detailError || 'No task detail messages found.'}</div>
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
}) {
  const [activeTab, setActiveTab] = useState('crew');
  const [traceData, setTraceData] = useState(buildConsoleData(null));
  const [dashboardEvents, setDashboardEvents] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [availableModels, setAvailableModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
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
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createError, setCreateError] = useState('');
  const streamControllerRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const mockReplyTimeoutRef = useRef(null);

  useEffect(() => () => {
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    if (mockReplyTimeoutRef.current) {
      window.clearTimeout(mockReplyTimeoutRef.current);
      mockReplyTimeoutRef.current = null;
    }
  }, []);

  const loadConsoleData = useCallback(async () => {
    if (USE_AGENT_TOWN_MOCK) {
      const mock = buildConsoleData(null);
      setTraceData(mock);
      setDashboardEvents(buildMockDashboardEvents(mock.events));
      setPendingApprovals(buildMockPendingApprovals(mock.agents, mock.events));
      setAvailableModels(MOCK_MODEL_PROVIDERS.flatMap((p) =>
        (p.models || []).map((m) => ({ id: m.id, name: m.name || m.id, provider: p.name || p.id, reasoning: Boolean(m.reasoning) }))
      ));
      setDefaultModel(MOCK_MODEL_PROVIDERS[0]?.models?.[0]?.id || '');
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

    const dashboardEventsPromise = fetch('/api/events/?limit=100', { cache: 'no-store' })
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

    const modelsPromise = fetch('/api/chat/available-models', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Available models request failed: ${response.status}`);
        }
        const json = await response.json();
        setAvailableModels(Array.isArray(json.models) ? json.models : []);
        if (json.default_model) setDefaultModel(json.default_model);
      })
      .catch((err) => {
        console.warn('[TownConsole] available-models fetch error:', err);
      });

    await Promise.allSettled([tracePromise, dashboardEventsPromise, pendingApprovalsPromise, modelsPromise]);
  }, []);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (disposed) return;
      await loadConsoleData();
    };

    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [loadConsoleData]);

  const { agents: traceAgents, events } = traceData;

  useEffect(() => {
    setDraftAgents((prev) => {
      const liveKeys = new Set(traceAgents.map((agent) => getAgentIdentity(agent)).filter(Boolean));
      return prev.filter((agent) => !liveKeys.has(getAgentIdentity(agent)));
    });
  }, [traceAgents]);

  const combinedAgents = useMemo(() => mergeAgents(traceAgents, draftAgents), [traceAgents, draftAgents]);

  const charNameMap = useMemo(() => {
    const map = {};
    combinedAgents.forEach((agent, index) => {
      map[agent.id] = CHAR_NAMES[index % CHAR_NAMES.length];
    });
    return map;
  }, [combinedAgents]);

  const traceAgentsById = useMemo(() => {
    const map = {};
    traceAgents.forEach((agent) => {
      map[agent.id] = agent;
    });
    return map;
  }, [traceAgents]);

  const traceAgentsBySessionKey = useMemo(() => {
    const map = {};
    combinedAgents.forEach((agent) => {
      const sessionKey = getAgentSessionKey(agent);
      if (sessionKey) map[sessionKey] = agent;
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

  const dashboardEventsByAgentList = useMemo(() => {
    const map = {};
    dashboardEvents.forEach((event) => {
      if (!map[event.session_id]) map[event.session_id] = [];
      map[event.session_id].push(event);
    });
    Object.values(map).forEach((list) => {
      list.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
    });
    return map;
  }, [dashboardEvents]);

  const countsByFilter = useMemo(() => FILTER_IDS.reduce((counts, id) => {
    counts[id] = combinedAgents.filter((agent) => agent.status === id).length;
    return counts;
  }, {}), [combinedAgents]);

  const filteredAgents = useMemo(
    () => combinedAgents.filter((agent) => agent.status === selectedFilter),
    [combinedAgents, selectedFilter],
  );

  useEffect(() => {
    if (filteredAgents.length === 0) {
      return;
    }
    const hasSelected = filteredAgents.some((agent) => getAgentIdentity(agent) === selectedIdentity);
    if (!hasSelected) {
      setSelectedIdentity(getAgentIdentity(filteredAgents[0]));
    }
  }, [filteredAgents, selectedIdentity]);

  const currentAgent = useMemo(() => {
    if (!filteredAgents.length) return null;
    return filteredAgents.find((agent) => getAgentIdentity(agent) === selectedIdentity)
      || filteredAgents[0];
  }, [filteredAgents, selectedIdentity]);

  const currentIdentity = currentAgent ? getAgentIdentity(currentAgent) : '';
  const currentSessionKey = currentAgent ? getAgentSessionKey(currentAgent) : '';
  const currentEvents = currentAgent ? (eventsByAgentList[currentAgent.id] || []) : [];
  const currentDashboardEvents = currentAgent ? (dashboardEventsByAgentList[currentAgent.id] || []) : [];
  const currentMessages = useMemo(() => {
    if (!currentIdentity) return [];
    const stored = messageMap[currentIdentity] || [];
    if (stored.length > 0) return stored;
    if (currentAgent?.mock) return buildMockHistory(currentAgent, currentEvents);
    return stored;
  }, [currentAgent, currentEvents, currentIdentity, messageMap]);
  const currentInput = currentIdentity ? (inputMap[currentIdentity] || '') : '';
  const currentSummary = summarizeTasks(currentDashboardEvents);

  const allModels = useMemo(() => {
    return availableModels.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      provider: model.provider || '',
      reasoning: Boolean(model.reasoning),
    }));
  }, [availableModels]);

  const filteredModels = useMemo(() => {
    const needle = modelSearch.trim().toLowerCase();
    if (!needle) return allModels;
    return allModels.filter((model) => {
      const haystack = `${model.name} ${model.id} ${model.provider}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [allModels, modelSearch]);

  const crewHelpers = useMemo(() => ({
    getAgentIdentity,
    getAgentSessionKey,
    pickEventSnippet,
    summarizeTasks,
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
    });
  }, [charNameMap, eventsByAgent, eventsByAgentList, onSelectAgent, traceAgentsById]);

  const handleCreateAgent = useCallback(async () => {
    if (!pendingModelId || creatingAgent) return;

    setCreatingAgent(true);
    setCreateError('');
    try {
      const modelOption = allModels.find((item) => item.id === pendingModelId);

      if (USE_AGENT_TOWN_MOCK) {
        const sessionKey = `chat-mock-${makeId().slice(0, 10)}`;
        const draftAgent = {
          ...buildDraftAgent(sessionKey, modelOption),
          mock: true,
          channel: modelOption?.provider === 'Google' ? 'discord' : 'webchat',
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
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error(await readFetchError(res, 'Failed to create new agent session.'));
      }

      const json = await res.json();
      const sessionKey = json.session_key;

      if (pendingModelId) {
        try {
          await fetch('/api/chat/patch-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_key: sessionKey, model: pendingModelId }),
          });
        } catch (err) {
          console.warn('[TownConsole] patch-session model error:', err);
        }
      }
      const draftAgent = buildDraftAgent(sessionKey, modelOption);
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
      setCreateError(err instanceof Error ? err.message : 'Failed to create agent.');
    } finally {
      setCreatingAgent(false);
    }
  }, [allModels, creatingAgent, pendingModelId]);

  const handleSendTask = useCallback(async () => {
    if (!currentSessionKey || !currentIdentity || sendingIdentity === currentIdentity) return;
    const text = currentInput.trim();
    if (!text) return;

    const userMsg = {
      id: makeId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
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
                content: 'Stop requested. The interrupt hook is active here now.',
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

      const response = await fetch('/api/chat/send-message-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_key: currentSessionKey, message: text }),
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
      window.setTimeout(() => {
        loadConsoleData();
      }, 800);
    }
  }, [currentAgent, currentIdentity, currentInput, currentSessionKey, loadConsoleData, sendingIdentity]);

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
        <div className="tc-tabbar">
          {TAB_META.map((tab) => (
            <button
              key={tab.id}
              className={`tc-tab ${activeTab === tab.id ? 'tc-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tc-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

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
                  eventsByAgentList={eventsByAgentList}
                  eventsByAgent={eventsByAgent}
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
                  modelSearch={modelSearch}
                  onChangeModelSearch={setModelSearch}
                  filteredModels={filteredModels}
                  pendingModelId={pendingModelId}
                  onPickModel={setPendingModelId}
                  onCreateAgent={handleCreateAgent}
                  creatingAgent={creatingAgent}
                  createError={createError}
                  taskStatusMeta={TASK_STATUS_META}
                  helpers={crewHelpers}
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
                />
              ) : null}

              {activeTab === 'tasks' ? (
                <TasksTab
                  dashboardEvents={dashboardEvents}
                  pendingApprovals={pendingApprovals}
                  agentsById={traceAgentsById}
                  agentsBySessionKey={traceAgentsBySessionKey}
                  traceEvents={events}
                  charNameMap={charNameMap}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
