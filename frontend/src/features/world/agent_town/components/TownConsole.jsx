import { useEffect, useMemo, useState } from 'react';
import { CHAR_BASE, CHAR_NAMES } from '../config/constants';

const TAB_META = [
  { id: 'crew', label: 'Crew Ledger' },
  { id: 'guard', label: 'Watch Ward' },
  { id: 'tasks', label: 'Quest Board' },
];

const STATUS_META = {
  running: { label: 'ACTIVE', dotClass: 'dot-working', groupClass: 'tc-status-active' },
  idle: { label: 'IDLE', dotClass: 'dot-idle', groupClass: 'tc-status-idle' },
  waiting: { label: 'FLAGGED', dotClass: 'dot-waiting', groupClass: 'tc-status-waiting' },
  offline: { label: 'OFFLINE', dotClass: 'dot-offline', groupClass: 'tc-status-offline' },
};

const TASK_STATUS_META = {
  ok: { label: 'COMPLETE', className: 'tc-task-complete' },
  error: { label: 'FAILED', className: 'tc-task-failed' },
  running: { label: 'RUNNING', className: 'tc-task-running' },
  waiting: { label: 'FLAGGED', className: 'tc-task-flagged' },
};

function shortId(value) {
  return String(value || '').slice(0, 8);
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

function getAgentState(status) {
  if (status === 'running') return 'working';
  return status || 'offline';
}

function AgentSprite({ charName, status }) {
  const isActive = status === 'running';
  const isOffline = status === 'offline';
  const spriteUrl = `${CHAR_BASE}${charName}_idle_anim_32x32.png`;

  return (
    <div className={`tc-sprite-wrap ${isOffline ? 'tc-sprite-grey' : ''}`}>
      <div className="tc-sprite-crop">
        <img
          className={`tc-sprite-sheet ${isActive ? 'tc-sprite-animated' : ''}`}
          src={spriteUrl}
          alt={charName}
          draggable={false}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      </div>
    </div>
  );
}

function CrewTab({ agents, eventsByAgent, eventsByAgentList, charNameMap, onSelectAgent }) {
  return (
    <div className="tc-grid">
      {agents.map((agent) => {
        const meta = STATUS_META[agent.status] || STATUS_META.offline;
        const latestEvent = eventsByAgent[agent.id] || null;
        const charName = charNameMap[agent.id] || CHAR_NAMES[0];
        return (
          <button
            key={agent.id}
            className="tc-agent-card"
            onClick={() => onSelectAgent({
              agent,
              charName,
              state: getAgentState(agent.status),
              event: latestEvent,
              events: eventsByAgentList[agent.id] || [],
              isPending: agent.status === 'waiting',
            })}
          >
            <div className="tc-agent-top">
              <AgentSprite charName={charName} status={agent.status} />
              <div className="tc-agent-main">
                <div className="tc-agent-name">
                  <span className={`dot ${meta.dotClass}`} />
                  {agent.name}
                </div>
                <div className="tc-agent-sub">{agent.model || agent.provider || 'Unknown model'}</div>
                <div className={`tc-agent-pill ${meta.groupClass}`}>{meta.label}</div>
              </div>
            </div>
            <div className="tc-agent-foot">
              <span>{latestEvent?.event_type || 'No recent task'}</span>
              <span>{latestEvent?.start_time ? fmtTime(latestEvent.start_time) : '—'}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function GuardTab({ guardEnabled, onToggleGuard, guardResults, unsafeSessionIds, agentsById, eventsByAgent, eventsByAgentList, charNameMap, onSelectAgent }) {
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
        <button
          className={`tc-guard-switch ${guardEnabled ? 'tc-guard-switch-on' : ''}`}
          onClick={onToggleGuard}
        >
          {guardEnabled ? 'Disable Guard' : 'Enable Guard'}
        </button>
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
                  {result.real_world_harm && <span>{result.real_world_harm}</span>}
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

export default function TownConsole({ guardEnabled, onToggleGuard, onSelectAgent }) {
  const [activeTab, setActiveTab] = useState('crew');
  const [traceData, setTraceData] = useState({ agents: [], events: [] });
  const [guardResults, setGuardResults] = useState([]);
  const [unsafeSessionIds, setUnsafeSessionIds] = useState([]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const [traceRes, guardRes, unsafeRes] = await Promise.all([
          fetch('/api/trace/', { cache: 'no-store' }),
          fetch('/api/guard/results', { cache: 'no-store' }),
          fetch('/api/guard/unsafe-sessions', { cache: 'no-store' }),
        ]);

        if (!disposed && traceRes.ok) {
          const traceJson = await traceRes.json();
          setTraceData({
            agents: traceJson.agents || [],
            events: traceJson.events || [],
          });
        }
        if (!disposed && guardRes.ok) {
          const guardJson = await guardRes.json();
          setGuardResults(Array.isArray(guardJson) ? guardJson : []);
        }
        if (!disposed && unsafeRes.ok) {
          const unsafeJson = await unsafeRes.json();
          setUnsafeSessionIds(unsafeJson.unsafe_session_ids || []);
        }
      } catch (err) {
        if (!disposed) console.warn('[TownConsole] fetch error:', err);
      }
    };

    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const { agents, events } = traceData;

  const charNameMap = useMemo(() => {
    const map = {};
    agents.forEach((agent, index) => {
      map[agent.id] = CHAR_NAMES[index % CHAR_NAMES.length];
    });
    return map;
  }, [agents]);

  const agentsById = useMemo(() => {
    const map = {};
    agents.forEach((agent) => {
      map[agent.id] = agent;
    });
    return map;
  }, [agents]);

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
    return map;
  }, [events]);

  const totalActive = agents.filter((agent) => agent.status === 'running').length;
  const totalWaiting = agents.filter((agent) => agent.status === 'waiting').length;
  const totalTasks = events.length;

  return (
    <div className="tc-shell">
      <div className="tc-frame">
        <div className="tc-header">
          <div className="tc-title-wrap">
            <div className="tc-kicker">Town Interface</div>
            <div className="tc-title">Pixel Command Deck</div>
          </div>
          <div className="tc-overview">
            <span className="tc-overview-chip">{agents.length} agents</span>
            <span className="tc-overview-chip">{totalActive} active</span>
            <span className="tc-overview-chip">{totalWaiting} flagged</span>
            <span className="tc-overview-chip">{totalTasks} tasks</span>
          </div>
        </div>

        <div className="tc-tabs">
          {TAB_META.map((tab) => (
            <button
              key={tab.id}
              className={`tc-tab ${activeTab === tab.id ? 'tc-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tc-body">
          {activeTab === 'crew' && (
            <CrewTab
              agents={agents}
              eventsByAgent={eventsByAgent}
              eventsByAgentList={eventsByAgentList}
              charNameMap={charNameMap}
              onSelectAgent={onSelectAgent}
            />
          )}

          {activeTab === 'guard' && (
            <GuardTab
              guardEnabled={guardEnabled}
              onToggleGuard={onToggleGuard}
              guardResults={guardResults}
              unsafeSessionIds={unsafeSessionIds}
              agentsById={agentsById}
              eventsByAgent={eventsByAgent}
              eventsByAgentList={eventsByAgentList}
              charNameMap={charNameMap}
              onSelectAgent={onSelectAgent}
            />
          )}

          {activeTab === 'tasks' && (
            <TasksTab
              events={events}
              agentsById={agentsById}
              eventsByAgentList={eventsByAgentList}
              charNameMap={charNameMap}
              onSelectTask={onSelectAgent}
            />
          )}
        </div>
      </div>
    </div>
  );
}
