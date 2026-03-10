import { useState } from 'react';
import { CHAR_BASE } from '../config/constants';

function fmtDur(s) {
  if (!s && s !== 0) return '–';
  if (s < 60) return Math.round(s) + 's';
  return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
}

function fmtTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return ''; }
}

const ROLE_META = {
  user:      { label: 'User',        icon: '👤', dotClass: 'card-msg-dot-user' },
  assistant: { label: 'Assistant',   icon: '🤖', dotClass: 'card-msg-dot-assistant' },
  tool:      { label: 'Tool Call',   icon: '⚙',  dotClass: 'card-msg-dot-tool' },
  toolResult:{ label: 'Tool Result', icon: '⚙',  dotClass: 'card-msg-dot-tool' },
};

function MessageItem({ msg, index }) {
  const [expanded, setExpanded] = useState(false);
  const role = msg.role || 'user';
  const meta = ROLE_META[role] || ROLE_META.user;
  const text = msg.text || msg.content_text || '';
  const isLong = text.length > 300;
  const displayText = expanded || !isLong ? text : text.slice(0, 300) + '…';
  const toolCalls = msg.tool_calls || [];
  const timestamp = msg.timestamp || '';

  return (
    <div className={`card-msg card-msg-${role}`}>
      <div className="card-msg-header">
        <div className="card-msg-role">
          <span className={`card-msg-dot ${meta.dotClass}`} />
          {meta.label}
        </div>
        <div className="card-msg-meta">
          {timestamp && <span className="card-msg-time">{fmtTime(timestamp)}</span>}
          {toolCalls.length > 0 && (
            <span className="card-msg-tc-badge">{toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {text && (
        <div className={`card-msg-text ${role === 'tool' || role === 'toolResult' ? 'card-msg-text-mono' : ''}`}>
          {displayText}
          {isLong && (
            <span className="card-msg-toggle" onClick={() => setExpanded(!expanded)}>
              {expanded ? ' [collapse]' : ' [more]'}
            </span>
          )}
        </div>
      )}

      {toolCalls.length > 0 && (
        <div className="card-tc-list">
          {toolCalls.map((tc, ti) => (
            <ToolCallBlock key={tc.id || ti} tc={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ tc }) {
  const [showArgs, setShowArgs] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const argsStr = tc.arguments ? JSON.stringify(tc.arguments, null, 2) : null;
  const resultStr = tc.result_text || null;

  return (
    <div className={`card-tc ${tc.is_error ? 'card-tc-error' : ''}`}>
      <div className="card-tc-header">
        <span className="card-tc-name">⚙ {tc.tool_name || 'tool'}</span>
        {tc.status && <span className={`card-tc-status card-tc-status-${tc.status}`}>{tc.status}</span>}
        {tc.id && <span className="card-tc-id">{String(tc.id).slice(0, 12)}</span>}
      </div>
      {argsStr && (
        <div className="card-tc-section">
          <div className="card-tc-section-head">
            <span>Arguments</span>
            {argsStr.length > 120 && (
              <span className="card-tc-toggle" onClick={() => setShowArgs(!showArgs)}>
                {showArgs ? 'collapse' : 'expand'}
              </span>
            )}
          </div>
          <pre className="card-tc-code">
            {showArgs || argsStr.length <= 120 ? argsStr : argsStr.slice(0, 120) + '…'}
          </pre>
        </div>
      )}
      {resultStr && (
        <div className="card-tc-section">
          <div className="card-tc-section-head">
            <span>Result</span>
            <span className="card-tc-toggle" onClick={() => setShowResult(!showResult)}>
              {showResult ? 'hide' : 'show'}
            </span>
          </div>
          {showResult && (
            <pre className="card-tc-code">{resultStr.length > 500 ? resultStr.slice(0, 500) + '…' : resultStr}</pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Pixel-art agent info card — centered overlay.
 * Shows the full event content: user messages, assistant replies, tool calls.
 */
export default function AgentCard({ data, onClose, onJourney }) {
  if (!data) return null;
  const { agent, charName, state, event, events, isPending } = data;
  const spriteUrl = `${CHAR_BASE}${charName}_idle_anim_32x32.png`;

  const stateDot = state === 'working' ? 'dot-working'
    : state === 'idle' ? 'dot-idle'
    : state === 'waiting' ? 'dot-waiting'
    : 'dot-offline';

  const conversations = event?.conversations || [];
  const userCount = conversations.filter(c => c.role === 'user').length;
  const assistantCount = conversations.filter(c => c.role === 'assistant').length;
  const toolMsgCount = conversations.filter(c => c.role === 'tool' || c.role === 'toolResult').length;
  const toolCallCount = conversations.reduce((n, c) => n + (c.tool_calls?.length || 0), 0);
  const toolCount = toolMsgCount + toolCallCount;

  return (
    <div className="card-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`agent-card ${isPending ? 'card-pending' : ''}`}>
        <span className="card-close" onClick={onClose}>×</span>

        {/* ── Top: standalone character + info ── */}
        <div className="card-top">
          <div className="card-char-standalone">
            <div className="card-sprite-crop">
              <img
                className="card-sprite-sheet"
                src={spriteUrl}
                alt={charName}
                draggable={false}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
            {isPending && <div className="card-gold-glow" />}
            <div className="card-charname">{charName}</div>
          </div>

          <div className="card-info">
            <div className="card-agent-name">
              <span className={`dot ${stateDot}`} />
              {String(agent.name || '')}
            </div>
            <div className="card-kv">
              <div>Status</div><span>{state}</span>
              <div>Provider</div><span>{String(agent.provider || '—')}</span>
              <div>Model</div><span>{String(agent.model || '—')}</span>
              <div>PID</div><span>{String(agent.pid || '—')}</span>
              {event && (
                <>
                  <div>Task</div><span>{String(event.event_type || '')}</span>
                  <div>Duration</div><span>{fmtDur(event.duration)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Full event conversation log (scrollable) ── */}
        {conversations.length > 0 && (
          <div className="card-event-log">
            <div className="card-event-log-header">
              <span className="card-event-log-label">Event Log</span>
              <div className="card-event-log-badges">
                {userCount > 0 && <span className="card-badge card-badge-user">{userCount} user</span>}
                {assistantCount > 0 && <span className="card-badge card-badge-assistant">{assistantCount} assistant</span>}
                {toolCount > 0 && <span className="card-badge card-badge-tool">{toolCount} tool</span>}
              </div>
            </div>
            <div className="card-event-log-scroll">
              {conversations.map((c, i) => (
                <MessageItem key={i} msg={c} index={i} />
              ))}
            </div>
          </div>
        )}

        {/* ── Journey button ── */}
        <div className="card-footer">
          <button
            className="btn journey-btn"
            onClick={() => onJourney?.({ agent, charName, state, events })}
          >
            ▶ &nbsp;View Work Journey
          </button>
        </div>
      </div>
    </div>
  );
}
