import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAR_NAMES, USE_AGENT_TOWN_MOCK } from '../config/constants';
import {
  buildMockAssistantReply,
  buildMockGuardResults,
  buildMockHistory,
  generateMockData,
  MOCK_MODEL_PROVIDERS,
} from '../data/mockData';
import ControlTab from './ControlTab';
import CrewTab from './CrewTab';
import ImageSwitch from './ImageSwitch';

const TAB_META = [
  { id: 'crew', label: 'Agents' },
  { id: 'control', label: 'Control' },
  { id: 'guard', label: 'Guard' },
  { id: 'tasks', label: 'Tasks' },
];

const FILTER_IDS = ['running', 'idle', 'waiting', 'offline'];

const TASK_STATUS_META = {
  ok: { label: 'COMPLETE', className: 'tc-task-complete' },
  error: { label: 'FAILED', className: 'tc-task-failed' },
  running: { label: 'RUNNING', className: 'tc-task-running' },
  waiting: { label: 'FLAGGED', className: 'tc-task-flagged' },
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

function getAgentState(status) {
  if (status === 'running') return 'working';
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
    if (event.status === 'ok') summary.completed += 1;
    else if (event.status === 'error') summary.failed += 1;
    else if (event.status === 'waiting') summary.flagged += 1;
    else summary.running += 1;
    return summary;
  }, {
    completed: 0,
    failed: 0,
    flagged: 0,
    running: 0,
  });
}

function buildDraftAgent(sessionKey, modelOption) {
  const modelRef = modelOption?.id || 'unknown/model';
  const provider = modelOption?.providerId || modelRef.split('/')[0] || 'unknown';
  const modelName = modelOption?.name || modelRef.split('/').slice(1).join('/') || modelRef;
  const suffix = shortId(normalizeSessionIdentity(sessionKey)).toUpperCase();
  return {
    id: `draft:${sessionKey}`,
    session_key: sessionKey,
    name: `Agent-${suffix}`,
    pid: suffix,
    provider,
    model: modelName,
    status: 'idle',
    first_seen_at: new Date().toISOString(),
    channel: 'webchat',
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
  const mock = generateMockData();
  const agents = Array.isArray(traceJson?.agents) && traceJson.agents.length ? traceJson.agents : mock.agents;
  const events = Array.isArray(traceJson?.events) && traceJson.events.length ? traceJson.events : mock.events;
  return { agents, events };
}

function GuardTab({
  guardEnabled,
  onToggleGuard,
  guardResults,
  unsafeSessionIds,
  agentsById,
  eventsByAgent,
  eventsByAgentList,
  charNameMap,
  onSelectAgent,
}) {
  return (
    <div className="tc-column">
      <div className="tc-guard-toolbar">
        <div className="tc-guard-summary">
          <div className="tc-kpi">
            <span className="tc-kpi-label">Watch Mode</span>
            <span className={`tc-kpi-value ${guardEnabled ? 'tc-kpi-live' : ''}`}>{guardEnabled ? 'ON' : 'OFF'}</span>
          </div>
          <div className="tc-kpi">
            <span className="tc-kpi-label">Unsafe Agents</span>
            <span className="tc-kpi-value">{unsafeSessionIds.length}</span>
          </div>
          <div className="tc-kpi">
            <span className="tc-kpi-label">Checks Cached</span>
            <span className="tc-kpi-value">{guardResults.length}</span>
          </div>
        </div>
        <ImageSwitch
          checked={guardEnabled}
          onClick={onToggleGuard}
          label="Guard"
          onText="ON"
          offText="OFF"
          className="tc-guard-switch"
        />
      </div>

      <div className="tc-guard-list">
        {guardResults.length === 0 ? (
          <div className="tc-empty">No guard checks cached yet.</div>
        ) : (
          guardResults.map((result, index) => {
            const agent = agentsById[result.session_id];
            const latestEvent = eventsByAgent[result.session_id] || null;
            const charName = charNameMap[result.session_id] || CHAR_NAMES[index % CHAR_NAMES.length];
            const verdictClass = result.verdict === 'unsafe' ? 'tc-verdict-unsafe' : 'tc-verdict-safe';
            return (
              <button
                key={`${result.session_id}-${result.mode}-${result.checked_at}-${index}`}
                className="tc-guard-card"
                onClick={() => {
                  if (!agent) return;
                  onSelectAgent({
                    agent,
                    charName,
                    state: getAgentState(agent.status),
                    event: latestEvent,
                    events: eventsByAgentList[result.session_id] || [],
                    isPending: agent.status === 'waiting',
                  });
                }}
              >
                <div className="tc-guard-head">
                  <div className="tc-guard-name">{agent?.name || `Agent-${shortId(result.session_id)}`}</div>
                  <div className={`tc-guard-verdict ${verdictClass}`}>{result.verdict || 'unknown'}</div>
                </div>
                <div className="tc-guard-meta">
                  <span>Mode: {result.mode || 'base'}</span>
                  <span>{result.checked_at ? fmtDate(result.checked_at * 1000) : ''}</span>
                </div>
                <div className="tc-guard-body">
                  <span>{result.failure_mode || result.risk_source || 'No risk notes returned.'}</span>
                  {result.real_world_harm ? <span>{result.real_world_harm}</span> : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function TasksTab({ events, agentsById, eventsByAgentList, charNameMap, onSelectTask }) {
  return (
    <div className="tc-task-grid">
      {events.length === 0 ? (
        <div className="tc-empty">No tasks found in trace yet.</div>
      ) : (
        events.map((event, index) => {
          const statusMeta = TASK_STATUS_META[event.status] || {
            label: String(event.status || 'UNKNOWN').toUpperCase(),
            className: 'tc-task-running',
          };
          const agent = agentsById[event.agent_id];
          const charName = charNameMap[event.agent_id] || CHAR_NAMES[index % CHAR_NAMES.length];
          const state = getAgentState(agent?.status);
          return (
            <button
              key={event.event_id}
              className="tc-task-card"
              onClick={() => onSelectTask({
                agent,
                charName,
                state,
                event,
                events: eventsByAgentList[event.agent_id] || [],
                isPending: event.status === 'waiting',
              })}
            >
              <div className="tc-task-head">
                <span className={`tc-task-badge ${statusMeta.className}`}>{statusMeta.label}</span>
                <span className="tc-task-time">{fmtDate(event.start_time)}</span>
              </div>
              <div className="tc-task-title">{event.event_type || 'chat'}</div>
              <div className="tc-task-agent">{agent?.name || event.agent_name || `Agent-${shortId(event.agent_id)}`}</div>
              <div className="tc-task-snippet">{pickEventSnippet(event) || 'Open to inspect this run.'}</div>
              <div className="tc-task-foot">
                <span>{event.conversations?.length || 0} msgs</span>
                <span>{event.duration ? `${Math.round(event.duration)}s` : 'live'}</span>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

export default function TownConsole({
  guardEnabled,
  onToggleGuard,
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
  const [guardResults, setGuardResults] = useState([]);
  const [unsafeSessionIds, setUnsafeSessionIds] = useState([]);
  const [modelProviders, setModelProviders] = useState([]);
  const [draftAgents, setDraftAgents] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState('running');
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
      setGuardResults(buildMockGuardResults(mock.agents, mock.events));
      setUnsafeSessionIds(mock.agents.filter((agent) => agent.status === 'waiting').map((agent) => agent.id));
      setModelProviders(MOCK_MODEL_PROVIDERS);
      return;
    }

    try {
      const [traceRes, guardRes, unsafeRes, scanRes] = await Promise.all([
        fetch('/api/trace/', { cache: 'no-store' }),
        fetch('/api/guard/results', { cache: 'no-store' }),
        fetch('/api/guard/unsafe-sessions', { cache: 'no-store' }),
        fetch('/api/system/onboard-scan', { cache: 'no-store' }),
      ]);

      if (traceRes.ok) {
        const traceJson = await traceRes.json();
        setTraceData(buildConsoleData(traceJson));
      }

      if (guardRes.ok) {
        const guardJson = await guardRes.json();
        setGuardResults(Array.isArray(guardJson) ? guardJson : []);
      }

      if (unsafeRes.ok) {
        const unsafeJson = await unsafeRes.json();
        setUnsafeSessionIds(unsafeJson.unsafe_session_ids || []);
      }

      if (scanRes.ok) {
        const scanJson = await scanRes.json();
        const providers = Array.isArray(scanJson.model_providers) && scanJson.model_providers.length
          ? scanJson.model_providers
          : MOCK_MODEL_PROVIDERS;
        setModelProviders(providers);
      } else {
        setModelProviders(MOCK_MODEL_PROVIDERS);
      }
    } catch (err) {
      console.warn('[TownConsole] fetch error:', err);
      setTraceData(buildConsoleData(null));
      setModelProviders(MOCK_MODEL_PROVIDERS);
    }
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
  const currentMessages = useMemo(() => {
    if (!currentIdentity) return [];
    const stored = messageMap[currentIdentity] || [];
    if (stored.length > 0) return stored;
    if (currentAgent?.mock) return buildMockHistory(currentAgent, currentEvents);
    return stored;
  }, [currentAgent, currentEvents, currentIdentity, messageMap]);
  const currentInput = currentIdentity ? (inputMap[currentIdentity] || '') : '';
  const currentSummary = summarizeTasks(currentEvents);

  const allModels = useMemo(() => {
    const flat = [];
    modelProviders.forEach((provider) => {
      (provider.models || []).forEach((model) => {
        flat.push({
          id: model.id,
          name: model.name || model.id,
          providerId: provider.id,
          providerName: provider.name || provider.id,
          reasoning: Boolean(model.reasoning),
          contextWindow: model.contextWindow || 0,
        });
      });
    });
    return flat;
  }, [modelProviders]);

  const filteredModels = useMemo(() => {
    const needle = modelSearch.trim().toLowerCase();
    if (!needle) return allModels;
    return allModels.filter((model) => {
      const haystack = `${model.name} ${model.id} ${model.providerName}`.toLowerCase();
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
      isPending: agent.status === 'waiting',
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
          channel: modelOption?.providerId === 'google' ? 'discord' : 'webchat',
        };
        const identity = getAgentIdentity(draftAgent);

        setDraftAgents((prev) => [draftAgent, ...prev]);
        setMessageMap((prev) => ({ ...prev, [identity]: [] }));
        setInputMap((prev) => ({ ...prev, [identity]: '' }));
        setSelectedFilter('idle');
        setSelectedIdentity(identity);
        setModelPickerOpen(false);
        setModelSearch('');
        setPendingModelId('');
        return;
      }

      const providerOverride = pendingModelId.includes('/') ? pendingModelId.split('/')[0] : '';
      const res = await fetch('/api/chat/start-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_override: pendingModelId,
          provider_override: providerOverride,
          label: modelOption?.name || pendingModelId,
        }),
      });

      if (!res.ok) {
        throw new Error(await readFetchError(res, 'Failed to create new agent session.'));
      }

      const json = await res.json();
      const sessionKey = json.session_key;
      const draftAgent = buildDraftAgent(sessionKey, modelOption);
      const identity = getAgentIdentity(draftAgent);

      setDraftAgents((prev) => [draftAgent, ...prev]);
      setMessageMap((prev) => ({ ...prev, [identity]: prev[identity] || [] }));
      setInputMap((prev) => ({ ...prev, [identity]: '' }));
      setSelectedFilter('idle');
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
                  currentEvents={currentEvents}
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
                  onInspectAgent={handleInspectAgent}
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

              {activeTab === 'guard' ? (
                <GuardTab
                  guardEnabled={guardEnabled}
                  onToggleGuard={onToggleGuard}
                  guardResults={guardResults}
                  unsafeSessionIds={unsafeSessionIds}
                  agentsById={traceAgentsById}
                  eventsByAgent={eventsByAgent}
                  eventsByAgentList={eventsByAgentList}
                  charNameMap={charNameMap}
                  onSelectAgent={onSelectAgent}
                />
              ) : null}

              {activeTab === 'tasks' ? (
                <TasksTab
                  events={events}
                  agentsById={traceAgentsById}
                  eventsByAgentList={eventsByAgentList}
                  charNameMap={charNameMap}
                  onSelectTask={onSelectAgent}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
