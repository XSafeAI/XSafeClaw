import { useEffect, useMemo, useRef, useState } from 'react';
import { CHAR_BASE, CHAR_NAMES, formatAgentDisplayName } from '../config/constants';
import { getAgentTownText } from '../i18n';

const FILTER_META = [
  { id: 'working', label: 'WORKING' },
  { id: 'pending', label: 'PENDING' },
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
  const isActive = status === 'working';
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

async function copyText(value) {
  const text = String(value || '').trim();
  if (!text || text === '---') return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'absolute';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

function getHeatLevel(value) {
  const count = Number(value || 0);
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count >= 5) return 4;
  if (count >= 3) return 3;
  if (count >= 2) return 2;
  return 1;
}

/** Matches trace.py `_build_activity_heat_24h`: bin idx 0 = 23–24h ago, idx 23 = last hour. */
function formatHeatBinTooltip(idx, value) {
  const n = Number(value || 0);
  const tasks = `${n} task${n === 1 ? '' : 's'}`;
  if (idx === 23) return `${tasks} · last hour (0–1h ago)`;
  const hi = 24 - idx;
  const lo = 23 - idx;
  return `${tasks} · ${lo}–${hi}h ago`;
}

function SessionHeatCard({ bins, heatLabel, heatScore }) {
  const safeBins = Array.isArray(bins) && bins.length ? bins : new Array(24).fill(0);
  const hourMarks = [
    { idx: 0, text: '-24H' },
    { idx: 6, text: '-18H' },
    { idx: 12, text: '-12H' },
    { idx: 18, text: '-6H' },
    { idx: 23, text: 'NOW' },
  ];
  const labelRaw = String(heatLabel || '').trim();
  const scoreNum = Number(heatScore);
  const scoreLine = (labelRaw || Number.isFinite(scoreNum))
    ? [labelRaw, Number.isFinite(scoreNum) ? `score ${scoreNum}` : null].filter(Boolean).join(' · ')
    : '';

  return (
    <section className="tc-stage-info-card tc-stage-info-card-wide">
      <div className="tc-stage-info-card-head">
        <div className="tc-stage-info-card-head-row">
          <div className="tc-stage-info-card-title">SESSION HEAT</div>
          {scoreLine ? (
            <div className="tc-stage-heat-score-pill" title="From /api/trace working_heat_label + working_heat_score">
              {scoreLine}
            </div>
          ) : null}
        </div>
        <div className="tc-stage-heat-legend tc-stage-heat-legend-head">
          <span>Few</span>
          <div className="tc-stage-heat-legend-swatches" aria-hidden="true">
            <span className="tc-stage-heat-cell tc-stage-heat-cell-0" />
            <span className="tc-stage-heat-cell tc-stage-heat-cell-1" />
            <span className="tc-stage-heat-cell tc-stage-heat-cell-2" />
            <span className="tc-stage-heat-cell tc-stage-heat-cell-3" />
            <span className="tc-stage-heat-cell tc-stage-heat-cell-4" />
          </div>
          <span>More</span>
        </div>
      </div>
      <p className="tc-stage-heat-microcopy">
        Tasks started per hour (Event.started_at, rolling 24h) — same buckets as Monitor timeline.
      </p>

      <div className="tc-stage-heat-grid" aria-label="Session heat over the last 24 hours">
        {safeBins.map((value, idx) => (
          <div
            key={`heat-${idx}`}
            className={`tc-stage-heat-cell tc-stage-heat-cell-${getHeatLevel(value)}`}
            title={formatHeatBinTooltip(idx, value)}
          />
        ))}
      </div>

      <div className="tc-stage-heat-hours" aria-hidden="true">
        {hourMarks.map((mark) => (
          <span
            key={mark.text}
            className="tc-stage-heat-hour"
            style={{ gridColumn: `${mark.idx + 1} / span 1` }}
          >
            {mark.text}
          </span>
        ))}
      </div>
    </section>
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

function localSessionKey(sessionKey) {
  const value = String(sessionKey || '');
  const parts = value.split('::');
  if (parts.length >= 3 && ['openclaw', 'hermes', 'nanobot'].includes(parts[0])) {
    return parts.slice(2).join('::');
  }
  return value;
}

function sessionKeysMatch(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || !b) return false;
  if (a === b) return true;
  const localA = localSessionKey(a);
  const localB = localSessionKey(b);
  return Boolean(localA && localB && localA === localB);
}

function pendingApprovalToolMessage(item) {
  return {
    id: `pending-tool-${item.id}`,
    role: 'tool_call',
    content: '',
    timestamp: item.created_at ? new Date(item.created_at * 1000) : new Date(),
    tool_id: item.id,
    tool_name: item.tool_name || 'tool-call',
    args: item.params ?? null,
    result: null,
    is_error: false,
    result_pending: true,
  };
}

function ToolCallBubble({ msg, helpers }) {
  const argsPreview = previewChatValue(msg.args || msg.content || '');
  const resultPreview = msg.result_pending ? 'Running...' : previewChatValue(msg.result);
  const metaTag = msg.result_pending
    ? 'RUNNING'
    : msg.is_error
      ? 'ERROR'
      : 'TOOL';
  const metaClass = msg.result_pending
    ? 'console-dialog-tag-tool-running'
    : msg.is_error
      ? 'console-dialog-tag-tool-error'
      : 'console-dialog-tag-tool';
  const toolName = msg.tool_name || 'unknown';

  return (
    <div className="console-dialog-item console-dialog-item-tool">
      <div className="console-dialog-meta">
        <div className="console-dialog-meta-main">
          <span className={`console-dialog-tag ${metaClass}`}>{metaTag}</span>
          <span className="console-dialog-tool-name">{toolName}</span>
        </div>
        <span className="console-dialog-time">{helpers.fmtTime(msg.timestamp)}</span>
      </div>
      {(argsPreview || resultPreview) ? (
        <div className="console-dialog-tool-payload">
          {argsPreview ? (
            <div className="console-dialog-tool-row console-dialog-tool-row-call">
              <span className="console-dialog-tool-row-label">Call</span>
              <div className="console-dialog-code console-dialog-code-args">{argsPreview}</div>
            </div>
          ) : null}
          {resultPreview ? (
            <div className="console-dialog-tool-row console-dialog-tool-row-result">
              <span className="console-dialog-tool-row-label">Result</span>
              <div className={`console-dialog-code console-dialog-code-result ${msg.is_error ? 'console-dialog-code-error' : ''}`}>{resultPreview}</div>
            </div>
          ) : null}
        </div>
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
      {msg.images && msg.images.length > 0 && (
        <div className="console-dialog-images">
          {msg.images.map((img, i) => (
            <img
              key={i}
              src={img.dataUrl}
              alt={`attachment ${i + 1}`}
              className="console-dialog-img-thumb"
              onClick={() => window.open(img.dataUrl, '_blank')}
            />
          ))}
        </div>
      )}
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

function mapStageTaskStatus(status) {
  if (status === 'completed' || status === 'ok') return 'completed';
  if (status === 'error') return 'error';
  if (status === 'fail' || status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  if (status === 'running') return 'running';
  return 'running';
}

function formatStageTaskId(value, length = 12) {
  return String(value || '').slice(0, length) || '---';
}

function ledgerTitleFromDashboardEvent(event) {
  if (event?.user_message_id) return `msg ${String(event.user_message_id).slice(0, 16)}`;
  return `Task ${formatStageTaskId(event.id)}`;
}

function ledgerSnippetFromDashboardEvent(event) {
  const user = String(event?.user_message_preview || '').trim();
  if (user) return user.slice(0, 140);
  const err = String(event?.error_message || '').trim();
  if (err) return err.slice(0, 140);
  return '—';
}

function fmtStageTokens(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '---';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${(n / 1000000).toFixed(1)}m`;
}

function stageDurationStr(startTs, endTs) {
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

function stringifyStageTaskValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeStageTaskMessages(messages = [], idPrefix = 'event') {
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

function stageTaskToneFromStatus(status) {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'error' || status === 'fail') return 'danger';
  if (status === 'pending' || status === 'running') return 'warn';
  return 'neutral';
}

function StageTaskDetailFact({
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

function StageTaskDetailMessage({ msg, helpers }) {
  const timestamp = helpers.fmtDate(msg.timestamp);
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
        <div
          className={`tc-task-detail-tool tc-task-detail-tool-card${msg.is_error ? ' tc-task-detail-tool--error' : ''}`}
        >
          <div className="tc-task-detail-tool-head tc-task-detail-tool-head-main">
            <span className="tc-task-detail-tool-tag">
              {msg.result_pending ? 'RUNNING' : msg.is_error ? 'ERROR' : 'TOOL'}
            </span>
            <span className="tc-task-detail-tool-name">{msg.tool_name || 'tool-call'}</span>
            <span className="tc-task-detail-time">{timestamp}</span>
          </div>
          {(hasToolCall || hasToolResult) ? (
            <div className="tc-task-detail-tool-body">
              {hasToolCall ? (
                <div className="tc-task-detail-tool-block tc-task-detail-tool-block-call">
                  <div className="tc-task-detail-tool-subhead">Tool call</div>
                  <pre className="tc-task-detail-tool-payload">{stringifyStageTaskValue(msg.tool_arguments)}</pre>
                </div>
              ) : null}
              {hasToolResult ? (
                <div className="tc-task-detail-tool-block tc-task-detail-tool-block-result">
                  <div className="tc-task-detail-tool-subhead">Tool result</div>
                  <pre className="tc-task-detail-tool-payload">
                    {msg.result_pending ? 'Running...' : stringifyStageTaskValue(msg.tool_result)}
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

export default function CrewTab({
  agents,
  filter,
  countsByFilter,
  charNameMap,
  currentAgent,
  currentSummary,
  currentEvents,
  activeMessages,
  currentInput,
  loadingHistory,
  sending,
  onFilterChange,
  onChangeInput,
  onSendTask,
  onStopTask,
  onPreviousAgent,
  onNextAgent,
  onSelectAgent,
  modelPickerOpen,
  onToggleModelPicker,
  runtimeInstances = [],
  selectedRuntimeId = '',
  selectedRuntime = null,
  onChangeRuntime,
  selectedRuntimeUnavailable = false,
  runtimeUnavailableMessage = '',
  modelSearch,
  onChangeModelSearch,
  filteredModels,
  pendingModelId,
  onPickModel,
  // §46 — `isHermes` / `onDeleteModel` props 已移除（与 OpenClaw 对齐）：
  // picker 不再渲染行内 × 删除按钮。
  onOpenModelSetup,
  onCreateAgent,
  createAgentDisabled,
  createAgentLabel,
  createError,
  taskStatusMeta,
  pendingApprovals = [],
  onResolveGuardPending,
  guardResolvingId,
  onDeleteAgent,
  tokensByAgent = {},
  helpers,
  pendingImages = [],
  onAddImages,
  onRemoveImage,
  fileInputRef,
  onTaskDetailChange,
  imagesDisabled = false,
  imagesDisabledReason = '',
  townText = getAgentTownText('en'),
}) {
  const currentChar = currentAgent ? charNameMap[currentAgent.id] || CHAR_NAMES[0] : CHAR_NAMES[0];
  const chatEndRef = useRef(null);
  const copyTimerRef = useRef(null);
  const [selectedLedgerTask, setSelectedLedgerTask] = useState(null);
  const [detailMessages, setDetailMessages] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailEventData, setDetailEventData] = useState(null);
  const [copiedField, setCopiedField] = useState('');
  const currentSessionKey = currentAgent ? helpers.getAgentSessionKey(currentAgent) : '';
  const agentPendingItems = useMemo(() => {
    if (!currentSessionKey || !pendingApprovals?.length) return [];
    return pendingApprovals.filter((item) => !item.resolved && sessionKeysMatch(item.session_key, currentSessionKey));
  }, [currentSessionKey, pendingApprovals]);
  const conversationMessages = useMemo(() => {
    const baseMessages = activeMessages
      .filter((msg) => (
        msg.role === 'assistant'
        || msg.role === 'user'
        || msg.role === 'error'
        || msg.role === 'tool_call'
      ));
    const existingToolIds = new Set(
      baseMessages
        .filter((msg) => msg.role === 'tool_call')
        .map((msg) => String(msg.tool_id || msg.id || '')),
    );
    const pendingToolMessages = agentPendingItems
      .filter((item) => !existingToolIds.has(String(item.id)))
      .map(pendingApprovalToolMessage);
    return [...baseMessages, ...pendingToolMessages]
      .sort((a, b) => getMessageTimestampValue(a.timestamp) - getMessageTimestampValue(b.timestamp));
  }, [activeMessages, agentPendingItems]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [conversationMessages, currentAgent?.id, loadingHistory, sending]);

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    onTaskDetailChange?.(!!selectedLedgerTask);
  }, [selectedLedgerTask, onTaskDetailChange]);

  useEffect(() => {
    if (!selectedLedgerTask) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedLedgerTask(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedLedgerTask]);

  useEffect(() => {
    let disposed = false;

    if (!selectedLedgerTask) {
      setDetailMessages([]);
      setDetailLoading(false);
      setDetailEventData(null);
      setDetailError('');
      return () => {
        disposed = true;
      };
    }

    const fallbackMessages = [];

    const loadDetail = async () => {
      setDetailLoading(true);
      setDetailError('');
      try {
        const response = await fetch(`/api/events/${selectedLedgerTask.task.id}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Task detail request failed: ${response.status}`);
        }
        const payload = await response.json();
        if (disposed) return;
        const messages = normalizeStageTaskMessages(Array.isArray(payload.messages) ? payload.messages : [], selectedLedgerTask.task.id);
        setDetailEventData(payload);
        setDetailMessages(messages.length ? messages : fallbackMessages);
      } catch (err) {
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
  }, [selectedLedgerTask]);

  const detailTask = detailEventData || selectedLedgerTask?.task || null;
  const liveEvent = selectedLedgerTask?.task
    ? currentEvents.find((e) => e.id === selectedLedgerTask.task.id)
    : null;
  const liveStatus = liveEvent?.status || selectedLedgerTask?.task?.status;
  const detailStatusId = liveStatus === 'pending'
    ? 'pending'
    : mapStageTaskStatus(detailTask?.status || liveStatus);
  const sessionIdValue = currentAgent?.id || '---';
  const sessionKeyValue = helpers.getAgentSessionKey(currentAgent) || currentAgent?.session_key || '---';
  const handleCopyField = async (field, value) => {
    const copied = await copyText(value);
    if (!copied) return;
    setCopiedField(field);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedField(''), 1200);
  };

  return (
    <div className="tc-crew-layout">
      <aside className="tc-crew-sidebar">
        <section className="tc-ornate-panel tc-sidebar-section tc-summon-panel tc-summon-panel-top">
          <BannerHeader label={townText.create.title} tone="light" size="long" />
          <div className="tc-panel-microcopy">{townText.create.description}</div>
          <button type="button" className="tc-summon-toggle" onClick={onToggleModelPicker}>
            <span>{modelPickerOpen ? townText.create.hideModels : townText.create.showModels}</span>
            <span>{modelPickerOpen ? '▲' : '▼'}</span>
          </button>

          {modelPickerOpen ? (
            <div className="tc-model-drawer">
              <div className="tc-runtime-picker">
                <div className="tc-runtime-picker-head">
                  <span>{townText.create.runtimeLabel}</span>
                  <small>{selectedRuntime ? selectedRuntime.platform : townText.create.runtimeEmpty}</small>
                </div>
                <div className="tc-runtime-options">
                  {runtimeInstances.length === 0 ? (
                    <div className="tc-model-empty">{townText.create.runtimeEmpty}</div>
                  ) : runtimeInstances.map((instance) => {
                    const selected = instance.instance_id === selectedRuntimeId;
                    // §42: a runtime is "offline" if its health probe says so. We treat
                    // both Nanobot's "not healthy" and Hermes's "unreachable" as the same
                    // offline condition so creating an agent against either is greyed
                    // out the same way (the backend would 503 anyway).
                    const unhealthy = (
                      (instance.platform === 'nanobot' && instance.health_status !== 'healthy')
                      || (instance.platform === 'hermes' && instance.health_status === 'unreachable')
                    );
                    return (
                      <button
                        key={instance.instance_id}
                        type="button"
                        className={`tc-runtime-option ${selected ? 'tc-runtime-option-active' : ''} ${unhealthy ? 'tc-runtime-option-offline' : ''}`}
                        onClick={() => onChangeRuntime?.(instance.instance_id)}
                        aria-pressed={selected}
                      >
                        <span className="tc-runtime-option-name">{instance.display_name || instance.instance_id}</span>
                        <span className="tc-runtime-option-meta">
                          {instance.platform}
                          {unhealthy ? ` · ${townText.create.runtimeOffline}` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="tc-runtime-hint">{townText.create.runtimeHint}</div>
              </div>
              <input
                type="text"
                className="tc-model-search"
                value={modelSearch}
                onChange={(e) => onChangeModelSearch(e.target.value)}
                placeholder={townText.create.searchPlaceholder}
              />
              <div className="tc-model-list">
                {filteredModels.length === 0 ? (
                  <div className="tc-model-empty">{townText.create.modelEmpty}</div>
                ) : (
                  filteredModels.map((model) => {
                    const isSelected = pendingModelId === model.id;
                    // §46 — 删除按钮已移除（与 OpenClaw 对齐）。原 §36
                    // 的 ``canDelete`` 派生与行内 × 按钮渲染一并下线。
                    return (
                      <div
                        key={model.id}
                        className={`tc-model-entry ${isSelected ? 'tc-model-entry-selected' : ''}`}
                      >
                        <button
                          type="button"
                          className="tc-model-option"
                          onClick={() => onPickModel(model.id)}
                          aria-pressed={isSelected}
                        >
                          <div className="tc-model-option-head">
                            <span className="tc-model-option-name">{model.name}</span>
                            {model.isNew || model.isLastUsed ? (
                              <span className="tc-model-option-flags">
                                {model.isNew ? (
                                  <span className="tc-model-option-flag tc-model-option-flag-new">{townText.create.newFlag}</span>
                                ) : null}
                                {model.isLastUsed ? (
                                  <span className="tc-model-option-flag tc-model-option-flag-last-used">{townText.create.lastUsedFlag}</span>
                                ) : null}
                              </span>
                            ) : null}
                          </div>
                        </button>
                        {isSelected ? (
                          <div className="tc-model-option-expand">
                            <div className="tc-model-option-expand-row">
                              <span className="tc-model-option-expand-label">{townText.create.provider}</span>
                              <span className="tc-model-option-expand-value">{model.providerLabel || model.provider}</span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="tc-model-drawer-actions">
                <button
                  type="button"
                  className="tc-summon-secondary"
                  onClick={onOpenModelSetup}
                >
                  {townText.create.configureNewModel}
                </button>
                <button
                  type="button"
                  className="tc-summon-confirm"
                  onClick={onCreateAgent}
                  disabled={createAgentDisabled}
                >
                  {createAgentLabel}
                </button>
                {selectedRuntimeUnavailable && runtimeUnavailableMessage ? (
                  <div className="tc-inline-error">{runtimeUnavailableMessage}</div>
                ) : null}
                {createError ? (
                  <div className="tc-inline-error">
                    <span className="tc-inline-error-text">{createError}</span>
                    {(createError.includes('not installed') || createError.includes('未安装')) && (
                      <button
                        type="button"
                        className="tc-inline-error-link"
                        onClick={() => { window.location.href = '/setup'; }}
                      >
                        {townText.create.goToSetup}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section className="tc-ornate-panel tc-sidebar-section tc-status-panel">
          <BannerHeader label={townText.sidebar.statusTitle} />
          <div className="tc-panel-microcopy">{townText.sidebar.statusDescription}</div>
          <div className="tc-status-filter-col">
            {FILTER_META.map((item) => (
              <StatusFilterOption
                key={item.id}
                label={townText.filters[item.id] || item.label}
                count={countsByFilter[item.id] || 0}
                selected={filter === item.id}
                onClick={() => onFilterChange(item.id)}
              />
            ))}
          </div>
        </section>
        <section className="tc-ornate-panel tc-sidebar-section tc-roster-panel">
          <BannerHeader label={townText.sidebar.rosterTitle} />
          <div className="tc-panel-microcopy">{townText.sidebar.rosterDescription}</div>
          <div className="tc-roster-list">
            {agents.length === 0 ? (
              <div className="tc-empty">{townText.sidebar.rosterEmpty}</div>
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
              </div>

              <div className="tc-stage-info-panel">
                <div className="tc-stage-overline">{townText.stage.tacticalProfile}</div>
                <div className="tc-stage-info-head">
                  <div>
                    <div className="tc-stage-agent-name-row">
                      <div className="tc-stage-agent-name">{formatAgentDisplayName(currentAgent)}</div>
                      <div className={`tc-stage-status-chip tc-status-${currentAgent.status || 'offline'}`}>
                        {townText.stage[currentAgent.status || 'offline'] || String(currentAgent.status || 'offline').toUpperCase()}
                      </div>
                      <button
                        type="button"
                        className="tc-crew-delete-btn-inline"
                        onClick={() => { if (window.confirm(townText.stage.deleteConfirm)) onDeleteAgent?.(currentAgent); }}
                      >
                        {townText.stage.deleteAgent}
                      </button>
                    </div>
                    <div className="tc-stage-identity-inline tc-stage-identity-inline-top">
                      <div className="tc-stage-identity-chip">
                        <span className="tc-stage-identity-label">{townText.stage.sessionId}</span>
                        <span className="tc-stage-identity-value tc-stage-identity-value-mono" title={sessionIdValue}>{sessionIdValue}</span>
                        <button
                          type="button"
                          className="tc-stage-copy-btn"
                          onClick={() => handleCopyField('session-id', sessionIdValue)}
                        >
                          {copiedField === 'session-id' ? townText.stage.copied : townText.stage.copy}
                        </button>
                      </div>
                      <div className="tc-stage-identity-chip">
                        <span className="tc-stage-identity-label">{townText.stage.sessionKey}</span>
                        <span className="tc-stage-identity-value tc-stage-identity-value-mono" title={sessionKeyValue}>{sessionKeyValue}</span>
                        <button
                          type="button"
                          className="tc-stage-copy-btn"
                          onClick={() => handleCopyField('session-key', sessionKeyValue)}
                        >
                          {copiedField === 'session-key' ? townText.stage.copied : townText.stage.copy}
                        </button>
                      </div>
                    </div>
                    <div className="tc-stage-meta-strip tc-stage-meta-strip-top">
                      <div className="tc-stage-meta-pill">
                        <span className="tc-stage-meta-pill-label">{townText.stage.provider}</span>
                        <span className="tc-stage-meta-pill-value">{currentAgent.provider || townText.stage.unknown}</span>
                      </div>
                      <div className="tc-stage-meta-pill">
                        <span className="tc-stage-meta-pill-label">{townText.stage.model}</span>
                        <span className="tc-stage-meta-pill-value tc-stage-meta-pill-value-mono">{currentAgent.model || townText.stage.modelPending}</span>
                      </div>
                      <div className="tc-stage-meta-pill">
                        <span className="tc-stage-meta-pill-label">{townText.stage.channel}</span>
                        <span className="tc-stage-meta-pill-value tc-stage-meta-pill-value-mono">{currentAgent.channel || townText.stage.channelDefault}</span>
                      </div>
                      <div className="tc-stage-meta-pill">
                        <span className="tc-stage-meta-pill-label">{townText.stage.tokens}</span>
                        <span className="tc-stage-meta-pill-value tc-stage-meta-pill-value-mono">{fmtStageTokens(tokensByAgent[currentAgent.id])}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="tc-stage-summary-grid">
                  <SummaryTile label={townText.stage.running} value={currentSummary.running} tone="tc-summary-live" />
                  <SummaryTile label={townText.stage.pending} value={currentSummary.pending} tone="tc-summary-warn" />
                  <SummaryTile label={townText.stage.completed} value={currentSummary.completed} tone="tc-summary-good" />
                  <SummaryTile label={townText.stage.failed} value={currentSummary.failed} tone="tc-summary-failed" />
                  <SummaryTile label={townText.stage.error} value={currentSummary.error} tone="tc-summary-error" />
                </div>

                <SessionHeatCard
                  bins={currentAgent.activity_heat_24h}
                  heatLabel={currentAgent.working_heat_label}
                  heatScore={currentAgent.working_heat_score}
                />
              </div>
            </div>
          </section>

            <section className="tc-stage-bottom">
              <div className="tc-ornate-panel tc-ledger-panel">
                <BannerHeader label={townText.stage.taskLedger} tone="light" size="long" />
                <div className="tc-panel-microcopy">{townText.stage.taskLedgerDescription}</div>
                <div className="tc-ledger-list">
                  {currentEvents.length === 0 ? (
                    <div className="tc-empty">{townText.stage.noTask}</div>
                  ) : (
                    currentEvents.map((event) => {
                      const statusMeta = taskStatusMeta[event.status] || taskStatusMeta.running;
                      const snippet = ledgerSnippetFromDashboardEvent(event);
                      return (
                        <button
                          key={event.id}
                          type="button"
                          className={`tc-ledger-item tc-ledger-item-button tc-ledger-item-${event.status || 'running'} ${selectedLedgerTask?.task?.id === event.id ? 'tc-ledger-item-selected' : ''}`}
                          onClick={() => setSelectedLedgerTask({
                            task: event,
                            agentName: formatAgentDisplayName(currentAgent),
                          })}
                        >
                          <div className="tc-ledger-row">
                            <span className={`tc-ledger-badge ${statusMeta.className}`}>{statusMeta.label}</span>
                            <span className="tc-ledger-time">{helpers.fmtDate(event.started_at)}</span>
                          </div>
                          <div className="tc-ledger-title">{ledgerTitleFromDashboardEvent(event)}</div>
                          <div className="tc-ledger-note">{snippet}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <section className="console-dialog-shell">
                <div className="console-dialog-frame">
                  <div className="console-dialog-head">
                    <div className="console-dialog-title">{townText.stage.conversation}</div>
                    <div className="console-dialog-status">{sending ? townText.stage.transmitting : loadingHistory ? townText.stage.syncing : townText.stage.ready}</div>
                  </div>

                  <div className="console-dialog-log">
                    {loadingHistory ? (
                      <div className="console-dialog-empty">{townText.stage.syncingLog}</div>
                    ) : conversationMessages.length === 0 ? (
                      <div className="console-dialog-empty">{townText.stage.noMessages}</div>
                    ) : (
                      conversationMessages.map((msg) => (
                        <ChatBubble key={msg.id} msg={msg} helpers={helpers} />
                      ))
                    )}
                    {agentPendingItems.map((item) => (
                      <div key={item.id} className="cd-pending-strip">
                        <div className="cd-pending-strip-icon">⚠</div>
                        <div className="cd-pending-strip-body">
                          <div className="cd-pending-strip-top">
                            <code className="cd-pending-strip-tool">{item.tool_name || 'tool-call'}</code>
                            {item.guard_verdict ? <span className="cd-pending-tag cd-pending-tag-verdict">{item.guard_verdict}</span> : null}
                          </div>
                          {(() => {
                            const eff = getEffectiveRisk(item) || {};
                            return (
                              <div className="cd-pending-risk-row">
                                <span className="cd-pending-tag cd-pending-tag-risk"><b>{townText.tasks.riskSource}</b> {eff.risk_source || townText.tasks.none}</span>
                                <span className="cd-pending-tag cd-pending-tag-failure"><b>{townText.tasks.failureMode}</b> {eff.failure_mode || townText.tasks.none}</span>
                                <span className="cd-pending-tag cd-pending-tag-harm"><b>{townText.tasks.realWorldHarm}</b> {eff.real_world_harm || townText.tasks.none}</span>
                              </div>
                            );
                          })()}
                          <span className="cd-pending-strip-btns">
                            <button
                              type="button"
                              className="cd-pending-btn cd-pending-btn-approve"
                              disabled={guardResolvingId === item.id}
                              onClick={() => onResolveGuardPending?.(item.id, 'approved')}
                            >{guardResolvingId === item.id ? '…' : `✓ ${townText.tasks.approve}`}</button>
                            <button
                              type="button"
                              className="cd-pending-btn cd-pending-btn-reject"
                              disabled={guardResolvingId === item.id}
                              onClick={() => onResolveGuardPending?.(item.id, 'rejected')}
                            >✗ {townText.tasks.reject}</button>
                          </span>
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="console-dialog-compose">
                    {pendingImages.length > 0 && (
                      <div className="console-dialog-img-preview-strip">
                        {pendingImages.map((img) => (
                          <div key={img.id} className="console-dialog-img-preview-item">
                            <img src={img.dataUrl} alt="pending" className="console-dialog-img-preview" />
                            <button
                              type="button"
                              className="console-dialog-img-remove"
                              onClick={() => onRemoveImage(img.id)}
                              title={townText.stage.removeImage}
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="console-dialog-compose-row">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => { if (e.target.files && !imagesDisabled) onAddImages(e.target.files); e.target.value = ''; }}
                      />
                      <button
                        type="button"
                        className="console-dialog-img-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={imagesDisabled || !helpers.getAgentSessionKey(currentAgent) || pendingImages.length >= 8}
                        title={imagesDisabled ? (imagesDisabledReason || townText.stage.nanobotTextOnly) : townText.stage.attachImage}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      </button>
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
                        onPaste={(e) => {
                          const items = e.clipboardData?.items;
                          if (!items) return;
                          if (imagesDisabled) return;
                          const imageFiles = [];
                          for (let i = 0; i < items.length; i++) {
                            if (items[i].type.startsWith('image/')) {
                              const file = items[i].getAsFile();
                              if (file) imageFiles.push(file);
                            }
                          }
                          if (imageFiles.length > 0) {
                            e.preventDefault();
                            onAddImages(imageFiles);
                          }
                        }}
                        placeholder={imagesDisabled ? townText.stage.replyTextOnlyPlaceholder : townText.stage.replyPlaceholder}
                        disabled={!helpers.getAgentSessionKey(currentAgent)}
                      />
                      <button
                        type="button"
                        className={`console-dialog-send ${sending ? 'console-dialog-send-stop' : ''}`}
                        onClick={sending ? onStopTask : onSendTask}
                        disabled={sending ? false : !helpers.getAgentSessionKey(currentAgent) || (!currentInput.trim() && pendingImages.length === 0)}
                        aria-label={sending ? townText.stage.stopResponse : townText.stage.sendMessage}
                        title={sending ? townText.stage.stopResponse : townText.stage.sendMessage}
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
                </div>
              </section>
            </section>
          </>
        ) : (
          <div className="tc-empty tc-stage-empty">{townText.stage.selectAgent}</div>
        )}
      </section>

      {selectedLedgerTask ? (
        <div className="tc-task-modal-backdrop" onMouseDown={() => setSelectedLedgerTask(null)}>
          <section
            className="tc-ornate-panel tc-task-detail tc-task-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tc-task-modal-head">
              <div>
                <div className="tc-task-lane-overline">TASK DETAIL</div>
                <div className="tc-task-lane-title">Task {formatStageTaskId(selectedLedgerTask.task.id)}</div>
              </div>
              <button
                type="button"
                className="tc-task-detail-close"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedLedgerTask(null);
                }}
              >
                CLOSE
              </button>
            </div>

            <div className="tc-task-detail-summary tc-task-detail-summary-flat">
              <StageTaskDetailFact label="Task ID" value={formatStageTaskId(detailTask?.id || selectedLedgerTask.task.id, 18)} mono featured />
              <StageTaskDetailFact label="Agent" value={selectedLedgerTask.agentName} featured />
              <StageTaskDetailFact label="Session" value={detailTask?.session_id || selectedLedgerTask.task.session_id} mono wide tone="info" />
              <StageTaskDetailFact label="User Message" value={detailTask?.user_message_id || selectedLedgerTask.task.user_message_id || '---'} mono wide />
              <StageTaskDetailFact
                label="Status"
                value={(taskStatusMeta[detailStatusId] || taskStatusMeta.running).label}
                featured
                tone={stageTaskToneFromStatus(detailStatusId)}
              />
              <StageTaskDetailFact label="Started At" value={helpers.fmtDate(detailTask?.started_at || selectedLedgerTask.task.started_at)} />
              <StageTaskDetailFact label="Completed At" value={(detailTask?.completed_at || selectedLedgerTask.task.completed_at) ? helpers.fmtDate(detailTask?.completed_at || selectedLedgerTask.task.completed_at) : '---'} />
              <StageTaskDetailFact label="Duration" value={stageDurationStr(detailTask?.started_at || selectedLedgerTask.task.started_at, detailTask?.completed_at || selectedLedgerTask.task.completed_at)} />
              <StageTaskDetailFact label="Total Messages" value={String(detailTask?.total_messages ?? selectedLedgerTask.task.total_messages ?? 0)} />
              <StageTaskDetailFact label="Assistant Msgs" value={String(detailTask?.total_assistant_messages ?? '---')} />
              <StageTaskDetailFact label="Tool Result Msgs" value={String(detailTask?.total_tool_result_messages ?? '---')} />
              <StageTaskDetailFact label="Tool Calls" value={String(detailTask?.total_tool_calls ?? selectedLedgerTask.task.total_tool_calls ?? 0)} tone="tool" />
              <StageTaskDetailFact label="Input Tokens" value={fmtStageTokens(detailTask?.total_input_tokens)} />
              <StageTaskDetailFact label="Output Tokens" value={fmtStageTokens(detailTask?.total_output_tokens)} />
              <StageTaskDetailFact label="Total Tokens" value={fmtStageTokens(detailTask?.total_tokens ?? selectedLedgerTask.task.total_tokens)} featured tone="info" />
            </div>

            {detailTask?.error_message || selectedLedgerTask.task.error_message ? (
              <div className="tc-task-detail-alert">
                <div className="tc-task-detail-context-title">{townText.tasks.errorTitle}</div>
                <div className="tc-task-detail-alert-copy">{detailTask?.error_message || selectedLedgerTask.task.error_message}</div>
              </div>
            ) : null}

            <div className="tc-task-detail-stream">
              {detailLoading ? (
                <div className="tc-empty">{townText.tasks.loadingDetail}</div>
              ) : detailMessages.length === 0 ? (
                <div className="tc-empty">{detailError || townText.tasks.noTaskDetail}</div>
              ) : (
                detailMessages.map((msg) => (
                  <StageTaskDetailMessage key={msg.message_id} msg={msg} helpers={helpers} />
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
