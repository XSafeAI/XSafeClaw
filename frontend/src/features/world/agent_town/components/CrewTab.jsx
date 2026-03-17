import { useEffect, useMemo, useRef, useState } from 'react';
import { CHAR_BASE, CHAR_NAMES } from '../config/constants';

const FILTER_META = [
  { id: 'running', label: 'ACTIVE' },
  { id: 'idle', label: 'IDLE' },
  { id: 'waiting', label: 'FLAGGED' },
  { id: 'offline', label: 'OFFLINE' },
];

const SHOW_CHARACTER_URL = '/UI/png/show_charactor/show_charactor.png';
const SELECT_URL = '/UI/png/select/select.png';
const TEXT_BAR_DARK_SHORT_URL = '/UI/png/text_bar/text_bar_dark_short.png';
const TEXT_BAR_DARK_LONG_URL = '/UI/png/text_bar/text_bar_dark_long.png';
const TEXT_BAR_LIGHT_LONG_URL = '/UI/png/text_bar/text_bar_light_long.png';
const DECORATE_MID_URL = '/UI/png/decorate/decorate_mid.png';
const LEFT_BUTTON_FRAMES = [1, 2, 3, 4, 5].map((n) => `/UI/png/button_change/left/left_state_${n}.png`);
const RIGHT_BUTTON_FRAMES = [1, 2, 3, 4, 5].map((n) => `/UI/png/button_change/right/right_state_${n}.png`);
const BUTTON_CLICK_FRAME_MS = 75;

function pickActiveShowcaseMode(seed) {
  let hash = 0;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 9973;
  }
  return hash % 3 === 0 ? 'phone' : 'run';
}

function BannerHeader({ label, tone = 'dark', size = 'short' }) {
  const bgSrc = tone === 'light'
    ? TEXT_BAR_LIGHT_LONG_URL
    : size === 'long'
      ? TEXT_BAR_DARK_LONG_URL
      : TEXT_BAR_DARK_SHORT_URL;
  return (
    <div className="tc-status-header-row" aria-hidden="true">
      <img className="tc-status-header-decor" src={DECORATE_MID_URL} alt="" draggable={false} />
      <div className={`tc-status-header ${size === 'long' || tone === 'light' ? 'tc-status-header-long' : 'tc-status-header-short'}`}>
        <img className="tc-status-header-bg" src={bgSrc} alt="" draggable={false} />
        <span className="tc-status-header-label">{label}</span>
      </div>
      <img className="tc-status-header-decor" src={DECORATE_MID_URL} alt="" draggable={false} />
    </div>
  );
}

function StatusFilterOption({ label, selected = false, count = null, onClick }) {
  return (
    <button
      type="button"
      className={`tc-status-filter-option ${selected ? 'tc-status-filter-option-selected' : ''}`}
      onClick={onClick}
    >
      <span className="tc-status-filter-marker-wrap" aria-hidden="true">
        {selected ? (
          <img className="tc-status-filter-marker" src={SELECT_URL} alt="" draggable={false} />
        ) : null}
      </span>
      <span className="tc-status-filter-text">{label}</span>
      {count !== null ? <span className="tc-status-filter-count">{count}</span> : null}
    </button>
  );
}

function ShowcaseNavButton({ direction, onClick }) {
  const frames = direction === 'left' ? LEFT_BUTTON_FRAMES : RIGHT_BUTTON_FRAMES;
  const [frameIdx, setFrameIdx] = useState(frames.length - 1);
  const [isAnimating, setIsAnimating] = useState(false);
  const timersRef = useRef([]);

  useEffect(() => {
    frames.forEach((src) => {
      const img = new Image();
      img.src = src;
    });

    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    };
  }, [frames]);

  const playClickAnimation = () => new Promise((resolve) => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    setIsAnimating(true);
    setFrameIdx(0);

    frames.slice(1).forEach((_, idx) => {
      const timer = window.setTimeout(() => {
        setFrameIdx(idx + 1);
      }, (idx + 1) * BUTTON_CLICK_FRAME_MS);
      timersRef.current.push(timer);
    });

    const resetTimer = window.setTimeout(() => {
      setFrameIdx(frames.length - 1);
      setIsAnimating(false);
      resolve();
    }, (frames.length - 1) * BUTTON_CLICK_FRAME_MS + 90);
    timersRef.current.push(resetTimer);
  });

  return (
    <button
      type="button"
      className={`tc-showcase-nav tc-showcase-nav-${direction} ${isAnimating ? 'tc-showcase-nav-animating' : ''}`}
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await playClickAnimation();
        onClick();
      }}
    >
      <img className="tc-showcase-nav-img" src={frames[frameIdx]} alt="" draggable={false} />
    </button>
  );
}

function AgentShowcase({ agentId, charName, status }) {
  const isActive = status === 'running';
  const isOffline = status === 'offline';
  const [phoneFailed, setPhoneFailed] = useState(false);
  const idleUrl = `${CHAR_BASE}${charName}_idle_anim_32x32.png`;
  const runUrl = `${CHAR_BASE}${charName}_run_32x32.png`;
  const phoneUrl = `${CHAR_BASE}${charName}_phone_32x32.png`;
  const activeMode = pickActiveShowcaseMode(`${agentId}-${charName}`);

  let spriteUrl = idleUrl;
  let spriteClass = 'tc-showcase-sheet tc-showcase-idle-sheet';
  if (isActive && activeMode === 'phone' && !phoneFailed) {
    spriteUrl = phoneUrl;
    spriteClass = 'tc-showcase-sheet tc-showcase-phone-sheet tc-showcase-phone-animated';
  } else if (isActive) {
    spriteUrl = runUrl;
    spriteClass = 'tc-showcase-sheet tc-showcase-run-sheet tc-showcase-run-animated';
  }

  return (
    <div className={`tc-showcase ${isOffline ? 'tc-showcase-offline' : ''}`}>
      <img className="tc-showcase-frame" src={SHOW_CHARACTER_URL} alt="" draggable={false} />
      <div className="tc-showcase-crop">
        <img
          className={spriteClass}
          src={spriteUrl}
          alt={charName}
          draggable={false}
          onError={(e) => {
            if (isActive && activeMode === 'phone' && !phoneFailed) {
              setPhoneFailed(true);
              return;
            }
            e.target.style.display = 'none';
          }}
        />
      </div>
    </div>
  );
}

function RosterPortrait({ charName, status }) {
  const [failed, setFailed] = useState(false);
  const idleUrl = `${CHAR_BASE}${charName}_idle_anim_32x32.png`;

  return (
    <div className={`tc-roster-portrait ${status === 'offline' ? 'tc-roster-portrait-offline' : ''}`}>
      {!failed ? (
        <div className="tc-roster-portrait-crop">
          <img
            className="tc-roster-portrait-img"
            src={idleUrl}
            alt={charName}
            draggable={false}
            onError={() => setFailed(true)}
          />
        </div>
      ) : (
        <div className="tc-roster-avatar">{charName.slice(0, 2).toUpperCase()}</div>
      )}
    </div>
  );
}

function RosterCard({ agent, selected, charName, onSelect, helpers }) {
  const identity = helpers.getAgentIdentity(agent);
  const serial = String(agent.pid || helpers.shortId(identity || agent.id || 'UNSET')).toUpperCase();
  const statusKey = agent.status || 'offline';
  const statusLabel = FILTER_META.find((item) => item.id === statusKey)?.label || String(statusKey).toUpperCase();
  return (
    <button
      type="button"
      className={`tc-roster-card tc-roster-card-compact ${selected ? 'tc-roster-card-selected' : ''}`}
      onClick={onSelect}
      title={identity || agent.id || agent.pid || 'unknown-agent'}
      aria-label={`Open operative ${serial}`}
    >
      <div className="tc-roster-card-head tc-roster-card-head-compact">
        <RosterPortrait charName={charName} status={agent.status || 'offline'} />
        <div className="tc-roster-copy tc-roster-copy-compact">
          <span className={`tc-roster-status-text tc-roster-status-${statusKey}`}>{statusLabel}</span>
          <span className="tc-roster-id-text">{`ID ${serial}`}</span>
        </div>
      </div>
    </button>
  );
}

function SummaryTile({ label, value, tone = '' }) {
  return (
    <div className={`tc-summary-tile ${tone}`}>
      <span className="tc-summary-value">{value}</span>
      <span className="tc-summary-label">{label}</span>
    </div>
  );
}

function previewChatValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getMessageTimestampValue(value) {
  if (value instanceof Date) return value.getTime();
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function ToolCallBubble({ msg, helpers }) {
  const argsPreview = previewChatValue(msg.args || msg.content || '');
  const resultPreview = previewChatValue(msg.result);
  const toolState = msg.result_pending
    ? 'TOOL RUNNING'
    : msg.is_error
      ? 'TOOL ERROR'
      : resultPreview
        ? 'TOOL RESULT'
        : 'TOOL CALL';
  const toolName = msg.tool_name || 'unknown';

  return (
    <div className="console-dialog-item console-dialog-item-tool">
      <div className="console-dialog-meta">
        <div className="console-dialog-meta-main">
          <span className="console-dialog-tag console-dialog-tag-tool">{toolState}</span>
          <span className="console-dialog-tool-name">{toolName}</span>
        </div>
        <span className="console-dialog-time">{helpers.fmtTime(msg.timestamp)}</span>
      </div>
      {argsPreview ? <div className="console-dialog-code console-dialog-code-args">{argsPreview}</div> : null}
      {msg.result_pending ? (
        <div className="console-dialog-code console-dialog-code-result">Running...</div>
      ) : resultPreview ? (
        <div className={`console-dialog-code console-dialog-code-result ${msg.is_error ? 'console-dialog-code-error' : ''}`}>{resultPreview}</div>
      ) : null}
    </div>
  );
}

function ChatBubble({ msg, helpers }) {
  if (msg.role === 'tool_call') {
    return <ToolCallBubble msg={msg} helpers={helpers} />;
  }

  const entryClass = msg.stopped
    ? 'console-dialog-item-stop'
    : msg.role === 'user'
      ? 'console-dialog-item-user'
      : msg.role === 'error'
        ? 'console-dialog-item-error'
        : 'console-dialog-item-assistant';
  const roleLabel = msg.stopped
    ? 'STOPPED'
    : msg.role === 'user'
      ? 'USER'
      : msg.role === 'error'
        ? 'ERROR'
        : 'ASSISTANT';
  const roleClass = msg.stopped
    ? 'console-dialog-tag-stop'
    : msg.role === 'user'
      ? 'console-dialog-tag-user'
      : msg.role === 'error'
        ? 'console-dialog-tag-error'
        : 'console-dialog-tag-agent';

  return (
    <div className={`console-dialog-item ${entryClass}`}>
      <div className="console-dialog-meta">
        <div className="console-dialog-meta-main">
          <span className={`console-dialog-tag ${roleClass}`}>{roleLabel}</span>
        </div>
        <span className="console-dialog-time">{helpers.fmtTime(msg.timestamp)}</span>
      </div>
      <div className="console-dialog-text">
        {msg.pending ? (
          <div className="console-dialog-typing">
            <span />
            <span />
            <span />
          </div>
        ) : (
          msg.content
        )}
      </div>
    </div>
  );
}

export default function CrewTab({
  agents,
  filter,
  countsByFilter,
  charNameMap,
  currentAgent,
  currentSummary,
  currentEvents,
  eventsByAgentList,
  eventsByAgent,
  activeMessages,
  currentInput,
  loadingHistory,
  sending,
  onFilterChange,
  onChangeInput,
  onSendTask,
  onStopTask,
  onInspectAgent,
  onPreviousAgent,
  onNextAgent,
  onSelectAgent,
  modelPickerOpen,
  onToggleModelPicker,
  modelSearch,
  onChangeModelSearch,
  filteredModels,
  pendingModelId,
  onPickModel,
  onCreateAgent,
  creatingAgent,
  createError,
  taskStatusMeta,
  helpers,
}) {
  const currentChar = currentAgent ? charNameMap[currentAgent.id] || CHAR_NAMES[0] : CHAR_NAMES[0];
  const chatEndRef = useRef(null);
  const conversationMessages = useMemo(() => activeMessages
    .filter((msg) => (
      msg.role === 'assistant'
      || msg.role === 'user'
      || msg.role === 'error'
      || msg.role === 'tool_call'
    ))
    .sort((a, b) => getMessageTimestampValue(a.timestamp) - getMessageTimestampValue(b.timestamp)), [activeMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [conversationMessages, currentAgent?.id, loadingHistory, sending]);

  return (
    <div className="tc-crew-layout">
      <aside className="tc-crew-sidebar">
        <section className="tc-ornate-panel tc-sidebar-section tc-summon-panel tc-summon-panel-top">
          <BannerHeader label="NEW AGENT" />
          <div className="tc-panel-microcopy">Forge a new operative from the model deck.</div>
          <button type="button" className="tc-summon-toggle" onClick={onToggleModelPicker}>
            <span>{modelPickerOpen ? 'Hide Model Deck' : 'Summon From Model Deck'}</span>
            <span>{modelPickerOpen ? '▲' : '▼'}</span>
          </button>

          {modelPickerOpen ? (
            <div className="tc-model-drawer">
              <input
                type="text"
                className="tc-model-search"
                value={modelSearch}
                onChange={(e) => onChangeModelSearch(e.target.value)}
                placeholder="Search model..."
              />
              <div className="tc-model-list">
                {filteredModels.length === 0 ? (
                  <div className="tc-model-empty">No model matched this search.</div>
                ) : (
                  filteredModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={`tc-model-option ${pendingModelId === model.id ? 'tc-model-option-selected' : ''}`}
                      onClick={() => onPickModel(model.id)}
                    >
                      <span className="tc-model-option-name">{model.name}</span>
                      <span className="tc-model-option-meta">{model.id}</span>
                      <span className="tc-model-option-foot">
                        <span className="tc-model-option-provider">{model.providerName}</span>
                        <span className="tc-model-option-badge">{model.reasoning ? 'REASON' : 'STD'}</span>
                        {model.contextWindow ? (
                          <span className="tc-model-option-badge">{Math.round(model.contextWindow / 1000)}K CTX</span>
                        ) : null}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                className="tc-summon-confirm"
                onClick={onCreateAgent}
                disabled={!pendingModelId || creatingAgent}
              >
                {creatingAgent ? 'Summoning...' : 'Create Agent'}
              </button>
              {createError ? <div className="tc-inline-error">{createError}</div> : null}
            </div>
          ) : null}
        </section>

        <section className="tc-ornate-panel tc-sidebar-section tc-status-panel">
          <BannerHeader label="STATUS" />
          <div className="tc-panel-microcopy">Signal routing and roster visibility.</div>
          <div className="tc-status-filter-col">
            {FILTER_META.map((item) => (
              <StatusFilterOption
                key={item.id}
                label={item.label}
                count={countsByFilter[item.id] || 0}
                selected={filter === item.id}
                onClick={() => onFilterChange(item.id)}
              />
            ))}
          </div>
        </section>
        <section className="tc-ornate-panel tc-sidebar-section tc-roster-panel">
          <BannerHeader label="ROSTER" />
          <div className="tc-panel-microcopy">Select one operative to expand details.</div>
          <div className="tc-roster-list">
            {agents.length === 0 ? (
              <div className="tc-empty">No agent matched this status.</div>
            ) : (
              agents.map((agent) => (
                <RosterCard
                  key={`${agent.id}-${helpers.getAgentIdentity(agent)}`}
                  agent={agent}
                  charName={charNameMap[agent.id] || CHAR_NAMES[0]}
                  selected={currentAgent ? helpers.getAgentIdentity(agent) === helpers.getAgentIdentity(currentAgent) : false}
                  onSelect={() => onSelectAgent(agent)}
                  helpers={helpers}
                />
              ))
            )}
          </div>
        </section>
      </aside>

      <section className="tc-crew-stage">
        {currentAgent ? (
          <>
            <section className="tc-ornate-panel tc-stage-hero">
            <div className="tc-stage-hero-main">
              <div className="tc-stage-showcase-panel">
                <div className="tc-stage-showcase-topline">VIEW PORT</div>
                <div className="tc-stage-showcase-frame">
                  <div className="tc-showcase-wrap">
                    <ShowcaseNavButton direction="left" onClick={onPreviousAgent} />
                    <AgentShowcase
                      agentId={currentAgent.id}
                      charName={currentChar}
                      status={currentAgent.status}
                    />
                    <ShowcaseNavButton direction="right" onClick={onNextAgent} />
                  </div>
                </div>
                <div className="tc-stage-showcase-floor">L/R cycle active shell</div>
              </div>

              <div className="tc-stage-info-panel">
                <div className="tc-stage-overline">TACTICAL PROFILE</div>
                <div className="tc-stage-info-head">
                  <div>
                    <div className="tc-stage-agent-name">{currentAgent.name}</div>
                    <div className="tc-stage-agent-sub">
                      {currentAgent.provider || 'unknown'} · {currentAgent.model || 'model pending'}
                    </div>
                  </div>
                  <div className={`tc-stage-status-chip tc-status-${currentAgent.status || 'offline'}`}>
                    {(currentAgent.status || 'offline').toUpperCase()}
                  </div>
                </div>

                <div className="tc-stage-summary-grid">
                  <SummaryTile label="Completed" value={currentSummary.completed} tone="tc-summary-good" />
                  <SummaryTile label="Failed" value={currentSummary.failed} tone="tc-summary-bad" />
                  <SummaryTile label="Running" value={currentSummary.running} tone="tc-summary-live" />
                  <SummaryTile label="Flagged" value={currentSummary.flagged} tone="tc-summary-warn" />
                </div>

                <div className="tc-stage-kv-grid">
                  <div>PID</div>
                  <span>{currentAgent.pid || helpers.shortId(currentAgent.id)}</span>
                  <div>Channel</div>
                  <span>{currentAgent.channel || 'session'}</span>
                  <div>Seen</div>
                  <span>{helpers.fmtDate(currentAgent.first_seen_at)}</span>
                  <div>Latest</div>
                  <span>{currentEvents[0]?.start_time ? helpers.fmtDate(currentEvents[0].start_time) : 'No task yet'}</span>
                </div>

                <div className="tc-stage-blurb">
                  {helpers.pickEventSnippet(currentEvents[0]) || 'This agent is waiting for your next mission dispatch.'}
                </div>

                <div className="tc-stage-actions">
                  <button type="button" className="tc-stage-inspect" onClick={() => onInspectAgent(currentAgent)}>
                    Inspect Log
                  </button>
                  <span className="tc-stage-tip">Journey stays tucked into inspect view.</span>
                </div>
              </div>
            </div>
          </section>

            <section className="tc-stage-bottom">
              <div className="tc-ornate-panel tc-ledger-panel">
                <BannerHeader label="TASK LEDGER" tone="light" size="long" />
                <div className="tc-panel-microcopy">Recent task states and short event traces.</div>
                <div className="tc-ledger-list">
                  {currentEvents.length === 0 ? (
                    <div className="tc-empty">This agent has no recorded task yet.</div>
                  ) : (
                    currentEvents.slice(0, 5).map((event) => {
                      const statusMeta = taskStatusMeta[event.status] || taskStatusMeta.running;
                      return (
                        <div key={event.event_id} className={`tc-ledger-item tc-ledger-item-${event.status || 'running'}`}>
                          <div className="tc-ledger-row">
                            <span className={`tc-ledger-badge ${statusMeta.className}`}>{statusMeta.label}</span>
                            <span className="tc-ledger-time">{helpers.fmtDate(event.start_time)}</span>
                          </div>
                          <div className="tc-ledger-title">{event.event_type || 'chat'}</div>
                          <div className="tc-ledger-note">{helpers.pickEventSnippet(event) || 'Awaiting operator review.'}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <section className="console-dialog-shell">
                <div className="console-dialog-frame">
                  <div className="console-dialog-head">
                    <div className="console-dialog-title">CONVERSATION</div>
                    <div className="console-dialog-status">{sending ? 'TRANSMITTING' : loadingHistory ? 'SYNCING' : 'READY'}</div>
                  </div>

                  <div className="console-dialog-log">
                    {loadingHistory ? (
                      <div className="console-dialog-empty">Syncing session log...</div>
                    ) : conversationMessages.length === 0 ? (
                      <div className="console-dialog-empty">No session messages yet.</div>
                    ) : (
                      conversationMessages.map((msg) => (
                        <ChatBubble key={msg.id} msg={msg} helpers={helpers} />
                      ))
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="console-dialog-compose">
                    <input
                      type="text"
                      className="console-dialog-input"
                      value={currentInput}
                      onChange={(e) => onChangeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (sending) {
                            onStopTask?.();
                          } else {
                            onSendTask();
                          }
                        }
                      }}
                      placeholder="Reply in this session..."
                      disabled={!helpers.getAgentSessionKey(currentAgent)}
                    />
                    <button
                      type="button"
                      className={`console-dialog-send ${sending ? 'console-dialog-send-stop' : ''}`}
                      onClick={sending ? onStopTask : onSendTask}
                      disabled={sending ? false : !helpers.getAgentSessionKey(currentAgent) || !currentInput.trim()}
                      aria-label={sending ? 'Stop current response' : 'Send message'}
                      title={sending ? 'Stop current response' : 'Send message'}
                    >
                      {sending ? (
                        <svg className="console-dialog-send-icon" viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="7" y="7" width="10" height="10" rx="1.5" />
                        </svg>
                      ) : (
                        <svg className="console-dialog-send-icon" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 12.5 19 4l-3.8 16-4.3-5-6.9-2.5Z" />
                          <path d="M10.9 15 19 4" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </section>
            </section>
          </>
        ) : (
          <div className="tc-empty tc-stage-empty">Select or summon an agent to open the command console.</div>
        )}
      </section>
    </div>
  );
}
