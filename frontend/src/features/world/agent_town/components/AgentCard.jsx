import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAR_BASE, USE_AGENT_TOWN_MOCK } from '../config/constants';
import { buildMockAssistantReply, buildMockHistory } from '../data/mockData';

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shortId(value) {
  return String(value || '').slice(0, 8).toUpperCase();
}

const EVENT_STATUS_META = {
  ok: { label: 'COMPLETE', className: 'tc-task-complete' },
  completed: { label: 'COMPLETE', className: 'tc-task-complete' },
  error: { label: 'FAILED', className: 'tc-task-failed' },
  failed: { label: 'FAILED', className: 'tc-task-failed' },
  running: { label: 'RUNNING', className: 'tc-task-running' },
  waiting: { label: 'FLAGGED', className: 'tc-task-flagged' },
  warning: { label: 'FLAGGED', className: 'tc-task-flagged' },
};

function fmtDur(s) {
  if (!s && s !== 0) return '–';
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
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

function readFetchError(response, fallbackText) {
  return response.json()
    .then((json) => json?.detail || json?.message || fallbackText)
    .catch(() => fallbackText);
}

function createAbortError() {
  try {
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  }
}

function delayWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    function cleanup() {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
    }

    function handleAbort() {
      cleanup();
      reject(createAbortError());
    }

    if (!signal) return;
    if (signal.aborted) {
      cleanup();
      reject(createAbortError());
      return;
    }
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function isAbortError(err) {
  return err?.name === 'AbortError';
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

function normalizeConversationMessage(msg, index) {
  if (!msg) return null;
  const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();
  const text = msg.text || msg.content_text || '';

  if (msg.role === 'user' || msg.role === 'assistant') {
    if (!text.trim()) return null;
    return {
      id: msg.id || `event-msg-${index}`,
      role: msg.role,
      content: text,
      timestamp,
    };
  }

  if (!text.trim()) return null;
  return {
    id: msg.id || `event-tool-${index}`,
    role: 'tool_call',
    content: '',
    timestamp,
    tool_name: msg.role === 'toolResult' ? 'tool-result' : 'tool-call',
    args: text,
    result: msg.role === 'toolResult' ? text : undefined,
    is_error: Boolean(msg.is_error),
    result_pending: false,
  };
}

function previewValue(value, limit = 180) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    return value.length > limit ? `${value.slice(0, limit)}…` : value;
  }
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    const text = String(value);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }
}

function ToolCallBubble({ msg }) {
  const argsPreview = previewValue(msg.args || msg.content || '', Number.POSITIVE_INFINITY);
  const resultPreview = previewValue(msg.result, Number.POSITIVE_INFINITY);
  const toolState = msg.result_pending
    ? 'TOOL RUNNING'
    : msg.is_error
      ? 'TOOL ERROR'
      : resultPreview
        ? 'TOOL RESULT'
        : 'TOOL CALL';
  const toolRoleClass = msg.result_pending
    ? 'agent-card-role-tool-running'
    : msg.is_error
      ? 'agent-card-role-tool-error'
      : resultPreview
        ? 'agent-card-role-tool-result'
        : 'agent-card-role-tool';

  return (
    <div className="tc-chat-tool agent-card-tool-bubble">
      <div className="tc-chat-tool-head">
        <span className="agent-card-head-main">
          <span className={`agent-card-role-chip ${toolRoleClass}`}>{toolState}</span>
          <span className="agent-card-tool-name">{msg.tool_name || 'unknown'}</span>
        </span>
        <span>{fmtTime(msg.timestamp)}</span>
      </div>
      {argsPreview ? (
        <div className="tc-chat-tool-preview">
          {argsPreview}
        </div>
      ) : null}
      {msg.result_pending ? (
        <div className="tc-chat-tool-result">Running...</div>
      ) : resultPreview ? (
        <div className={`tc-chat-tool-result ${msg.is_error ? 'agent-card-tool-result-error' : ''}`}>
          {resultPreview}
        </div>
      ) : null}
    </div>
  );
}

function ChatBubble({ msg }) {
  if (msg.role === 'tool_call') {
    return <ToolCallBubble msg={msg} />;
  }

  const bubbleClass = msg.stopped
    ? 'agent-card-bubble-stopped'
    : msg.role === 'user'
      ? 'tc-chat-bubble-user'
      : msg.role === 'error'
        ? 'tc-chat-bubble-error'
        : 'tc-chat-bubble-assistant';
  const roleLabel = msg.stopped
    ? 'STOP REQUESTED'
    : msg.role === 'user'
      ? 'COMMAND'
      : msg.role === 'error'
        ? 'ERROR'
        : 'AGENT';
  const roleChipClass = msg.stopped
    ? 'agent-card-role-stopped'
    : msg.role === 'user'
      ? 'agent-card-role-user'
      : msg.role === 'error'
        ? 'agent-card-role-error'
        : 'agent-card-role-assistant';

  return (
    <div className={`tc-chat-bubble ${bubbleClass}`}>
      <div className="tc-chat-bubble-head">
        <span className="agent-card-head-main">
          <span className={`agent-card-role-chip ${roleChipClass}`}>{roleLabel}</span>
        </span>
        <span>{fmtTime(msg.timestamp)}</span>
      </div>
      <div className="tc-chat-bubble-body">
        {msg.pending ? (
          <div className="tc-chat-typing">
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

export default function AgentCard({ data, onClose, onJourney }) {
  if (!data) return null;

  const { agent, charName, state, event, events = [], isPending } = data;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const streamControllerRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const sessionKey = agent?.session_key || '';
  const spriteUrl = `${CHAR_BASE}${charName}_idle_anim_32x32.png`;

  const stateDot = state === 'working'
    ? 'dot-working'
    : state === 'idle'
      ? 'dot-idle'
      : state === 'waiting'
        ? 'dot-waiting'
        : 'dot-offline';

  const stateLabel = state === 'working' ? 'RUNNING' : String(state || 'offline').toUpperCase();
  const boundEvents = useMemo(
    () => (Array.isArray(events) && events.length ? events : event ? [event] : []),
    [event, events],
  );
  const latestEvent = event || boundEvents[0] || null;
  const fallbackMessages = useMemo(
    () => (latestEvent?.conversations || []).map(normalizeConversationMessage).filter(Boolean),
    [latestEvent],
  );
  const displayMessages = messages.length ? messages : fallbackMessages;
  const threadStateLabel = sending
    ? 'Streaming reply'
    : loadingHistory
      ? 'Syncing history'
      : sessionKey
        ? 'Ready for next step'
        : 'Awaiting session bind';

  const threadSummary = useMemo(() => displayMessages.reduce((summary, msg) => {
    if (msg.role === 'user') summary.user += 1;
    else if (msg.role === 'assistant' || msg.role === 'error') summary.assistant += 1;
    else if (msg.role === 'tool_call') summary.tool += 1;
    return summary;
  }, {
    user: 0,
    assistant: 0,
    tool: 0,
  }), [displayMessages]);
  const latestStatusMeta = EVENT_STATUS_META[latestEvent?.status] || EVENT_STATUS_META.running;

  const loadHistory = useCallback(async () => {
    setMessages([]);

    if (!sessionKey) return;

    if (USE_AGENT_TOWN_MOCK) {
      const mockHistory = buildMockHistory(agent, boundEvents).map((msg) => ({
        ...msg,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
      }));
      setMessages(mockHistory);
      return;
    }

    setLoadingHistory(true);
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
      setMessages(history);
    } catch (err) {
      console.warn('[AgentCard] history error:', err);
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [agent, boundEvents, sessionKey]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [displayMessages.length, sending]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [agent?.id]);

  useEffect(() => () => {
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
  }, []);

  const finalizeStoppedMessage = useCallback((pendingId) => {
    setMessages((prev) => prev.map((msg) => (
      msg.id === pendingId
        ? {
            ...msg,
            content: 'Stop requested. The hard interrupt hook is reserved here for now.',
            pending: false,
            stopped: true,
          }
        : msg
    )));
  }, []);

  const handleStop = useCallback(() => {
    if (!sending) return;
    stopRequestedRef.current = true;
    streamControllerRef.current?.abort();
  }, [sending]);

  const handleSend = useCallback(async () => {
    if (!sessionKey || sending) return;
    const text = input.trim();
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

    setInput('');
    setMessages((prev) => {
      const base = prev.length ? prev : displayMessages;
      return [...base, userMsg, pendingMsg];
    });
    setSending(true);
    stopRequestedRef.current = false;

    const controller = new AbortController();
    streamControllerRef.current = controller;

    try {
      if (USE_AGENT_TOWN_MOCK) {
        const reply = buildMockAssistantReply(text, agent);
        await delayWithAbort(420, controller.signal);
        setMessages((prev) => prev.map((msg) => (
          msg.id === pendingId
            ? { ...msg, content: reply.text, pending: false }
            : msg
        )));
        return;
      }

      const response = await fetch('/api/chat/send-message-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_key: sessionKey, message: text }),
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
              setMessages((prev) => prev.map((msg) => (
                msg.id === pendingId
                  ? { ...msg, content: chunk.text, pending: false }
                  : msg
              )));
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
              setMessages((prev) => {
                const next = [...prev];
                const insertAt = next.findIndex((msg) => msg.id === pendingId);
                next.splice(insertAt >= 0 ? insertAt : next.length, 0, toolMsg);
                return next;
              });
            } else if (chunk.type === 'tool_result') {
              setMessages((prev) => prev.map((msg) => (
                msg.role === 'tool_call' && msg.tool_id === chunk.tool_id
                  ? {
                      ...msg,
                      result: chunk.result,
                      is_error: chunk.is_error,
                      result_pending: false,
                    }
                  : msg
              )));
            } else if (chunk.type === 'final') {
              setMessages((prev) => prev.map((msg) => (
                msg.id === pendingId
                  ? { ...msg, content: chunk.text || msg.content || '[No response]', pending: false }
                  : msg
              )));
            } else if (chunk.type === 'error' || chunk.type === 'timeout' || chunk.type === 'aborted') {
              setMessages((prev) => prev.map((msg) => (
                msg.id === pendingId
                  ? {
                      ...msg,
                      role: chunk.type === 'error' ? 'error' : 'assistant',
                      content: chunk.text || `[${chunk.type}]`,
                      pending: false,
                    }
                  : msg
              )));
            }
          } catch (err) {
            console.warn('[AgentCard] stream parse error:', err);
          }
        }
      }
    } catch (err) {
      if (stopRequestedRef.current || isAbortError(err)) {
        finalizeStoppedMessage(pendingId);
        return;
      }

      setMessages((prev) => prev.map((msg) => (
        msg.id === pendingId
          ? {
              ...msg,
              role: 'error',
              content: err instanceof Error ? err.message : 'Mission dispatch failed.',
              pending: false,
            }
          : msg
      )));
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
      stopRequestedRef.current = false;
      setSending(false);
    }
  }, [agent, displayMessages, finalizeStoppedMessage, input, sending, sessionKey]);

  return (
    <div className="card-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`agent-card ${isPending ? 'card-pending' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="agent-card-close" onClick={onClose}>
          CLOSE
        </button>

        <div className="agent-card-grid">
          <section className="tc-ornate-panel agent-card-summary-panel">
            <div className="agent-card-summary-bar">
              <div className="agent-card-summary-primary">
                <div className="agent-card-avatar-frame agent-card-avatar-frame-compact">
                  <div className="card-sprite-crop agent-card-sprite-crop agent-card-sprite-crop-compact">
                    <img
                      className="card-sprite-sheet agent-card-sprite-sheet agent-card-sprite-sheet-compact"
                      src={spriteUrl}
                      alt={charName}
                      draggable={false}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                  {isPending ? <div className="card-gold-glow" /> : null}
                </div>

                <div className="agent-card-identity">
                  <div className="agent-card-name">
                    <span className={`dot ${stateDot}`} />
                    <span>{String(agent.name || `Agent-${shortId(agent.id)}`)}</span>
                  </div>
                  <div className="agent-card-subline">
                    {String(agent.provider || 'unknown')} · {String(agent.model || 'model pending')}
                  </div>
                  <div className="agent-card-summary-inline">
                    <span className={`tc-ledger-badge ${latestStatusMeta.className}`}>{latestStatusMeta.label}</span>
                    <div className={`tc-stage-status-chip tc-status-${agent.status || 'offline'}`}>
                      {stateLabel}
                    </div>
                    <span className="agent-card-thread-chip">{threadStateLabel}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="tc-stage-inspect agent-card-journey-btn"
                onClick={() => onJourney?.({ agent, charName, state, events: boundEvents })}
              >
                View Work Journey
              </button>
            </div>

            <div className="agent-card-summary-meta">
              <span className="agent-card-thread-chip">{sessionKey || 'No session key'}</span>
              <span className="agent-card-thread-chip">{displayMessages.length} MSG</span>
              <span className="agent-card-thread-chip">{threadSummary.tool} TOOL</span>
              <span className="agent-card-thread-chip">{boundEvents.length} RUNS</span>
              <div className="agent-card-summary-status">
                <span className="agent-card-thread-chip">{fmtDate(latestEvent?.start_time || agent.first_seen_at) || 'just now'}</span>
              </div>
            </div>
          </section>

          <section className="tc-ornate-panel agent-card-chat-panel">
            <div className="agent-card-chat-head">
              <div>
                <div className="tc-control-overline">Continue Task</div>
                <h3 className="tc-control-title">Latest Conversation</h3>
              </div>
              <div className="agent-card-chat-badges">
                <span className="tc-control-badge">{displayMessages.length} MSG</span>
                <span className="tc-chat-live">
                  {sending ? 'TRANSMITTING' : loadingHistory ? 'SYNCING' : sessionKey ? 'READY' : 'UNBOUND'}
                </span>
              </div>
            </div>

            <div className="agent-card-chat-stage">
              <div className="agent-card-chat-scroll">
                <div className="tc-chat-messages agent-card-chat-messages">
                  {loadingHistory ? (
                    <div className="tc-chat-empty-inline">Syncing full session history...</div>
                  ) : displayMessages.length === 0 ? (
                    <div className="tc-chat-empty-inline">
                      No conversation loaded yet. Type below to brief this agent with the next task.
                    </div>
                  ) : (
                    displayMessages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div className="tc-chat-composer agent-card-composer">
                <div className="tc-chat-composer-head">
                  <span className="tc-chat-composer-label">Command Input</span>
                  <span className="tc-chat-composer-tip">
                    {sending ? 'Stop is reserved here as a relay placeholder.' : 'Enter to send, Shift+Enter for newline.'}
                  </span>
                </div>
                <textarea
                  ref={textareaRef}
                  className="tc-chat-input agent-card-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !isComposing && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={sessionKey ? 'Assign the next mission...' : 'This agent is not bound to an active session.'}
                  disabled={!sessionKey || sending}
                />
                <button
                  type="button"
                  className={`tc-chat-send agent-card-send ${sending ? 'agent-card-send-stop' : ''}`}
                  onClick={sending ? handleStop : handleSend}
                  disabled={sending ? false : !sessionKey || !input.trim()}
                >
                  {sending ? 'Stop' : 'Send Task'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
