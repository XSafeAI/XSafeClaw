import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { guardAPI } from '../../../../services/api';
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

function fmtTokens(n) {
  if (!n || n <= 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${(n / 1000000).toFixed(1)}m`;
}

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

function normalizeConversationMessages(messages = []) {
  const normalized = [];

  const tryAttachToolResult = (text, isError) => {
    for (let i = normalized.length - 1; i >= 0; i -= 1) {
      const prev = normalized[i];
      if (prev?.role !== 'tool_call') continue;
      if (!prev.result) {
        prev.result = text;
        prev.is_error = prev.is_error || isError;
        return true;
      }
      if (String(prev.result) === String(text)) {
        return true;
      }
      return false;
    }
    return false;
  };

  messages.forEach((msg, index) => {
    if (!msg) return;
    const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();
    const role = msg.role === 'tool' ? 'toolResult' : msg.role;
    const text = msg.text || msg.content_text || '';

    if ((role === 'user' || role === 'assistant') && text.trim()) {
      normalized.push({
        id: msg.id || `event-msg-${index}`,
        role,
        content: text,
        timestamp,
      });
    }

    const toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map((tc, toolIndex) => ({
          id: tc.id || `event-tool-${index}-${toolIndex}`,
          tool_name: tc.tool_name || 'tool-call',
          arguments: tc.arguments || null,
        }))
      : role === 'tool_call'
        ? [{
            id: msg.tool_id || msg.id || `event-tool-${index}`,
            tool_name: msg.tool_name || 'tool-call',
            arguments: msg.args ?? msg.arguments ?? null,
            result: msg.result,
            is_error: Boolean(msg.is_error),
            result_pending: Boolean(msg.result_pending),
          }]
        : [];

    toolCalls.forEach((toolCall, toolIndex) => {
      normalized.push({
        id: toolCall.id || `event-tool-${index}-${toolIndex}`,
        role: 'tool_call',
        content: '',
        timestamp,
        tool_id: toolCall.id,
        tool_name: toolCall.tool_name || 'tool-call',
        args: toolCall.arguments ?? null,
        result: toolCall.result,
        is_error: Boolean(toolCall.is_error),
        result_pending: Boolean(toolCall.result_pending),
      });
    });

    if (role === 'toolResult' && text.trim()) {
      if (tryAttachToolResult(text, Boolean(msg.is_error))) return;
      normalized.push({
        id: msg.id || `event-tool-result-${index}`,
        role: 'tool_call',
        content: '',
        timestamp,
        tool_name: msg.tool_name || 'tool-call',
        args: '',
        result: text,
        is_error: Boolean(msg.is_error),
        result_pending: false,
      });
    }
  });

  return normalized;
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

function AgentDialogToolMessage({ msg }) {
  const argsPreview = previewValue(msg.args || msg.content || '', Number.POSITIVE_INFINITY);
  const resultPreview = msg.result_pending ? 'Running...' : previewValue(msg.result, Number.POSITIVE_INFINITY);
  const metaTag = msg.result_pending
    ? 'RUNNING'
    : msg.is_error
      ? 'ERROR'
      : 'TOOL';
  const metaClass = msg.result_pending
    ? 'agent-dialog-tag-tool-running'
    : msg.is_error
      ? 'agent-dialog-tag-tool-error'
      : 'agent-dialog-tag-tool';

  return (
    <div className="agent-dialog-item agent-dialog-item-tool">
      <div className="agent-dialog-meta">
        <div className="agent-dialog-meta-main">
          <span className={`agent-dialog-tag ${metaClass}`}>{metaTag}</span>
          <span className="agent-dialog-tool-name">{msg.tool_name || 'unknown'}</span>
        </div>
        <span className="agent-dialog-time">{fmtTime(msg.timestamp)}</span>
      </div>
      {(argsPreview || resultPreview) ? (
        <div className="agent-dialog-tool-payload">
          {argsPreview ? (
            <div className="agent-dialog-tool-row agent-dialog-tool-row-call">
              <span className="agent-dialog-tool-row-label">Call</span>
              <div className="agent-dialog-code agent-dialog-code-args">{argsPreview}</div>
            </div>
          ) : null}
          {resultPreview ? (
            <div className="agent-dialog-tool-row agent-dialog-tool-row-result">
              <span className="agent-dialog-tool-row-label">Result</span>
              <div className={`agent-dialog-code agent-dialog-code-result ${msg.is_error ? 'agent-dialog-code-error' : ''}`}>
                {resultPreview}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgentDialogMessage({ msg }) {
  if (msg.role === 'tool_call') {
    return <AgentDialogToolMessage msg={msg} />;
  }

  const kindClass = msg.stopped
    ? 'agent-dialog-item-stop'
    : msg.role === 'user'
      ? 'agent-dialog-item-user'
      : msg.role === 'error'
        ? 'agent-dialog-item-error'
        : 'agent-dialog-item-assistant';
  const roleLabel = msg.stopped
    ? 'STOPPED'
    : msg.role === 'user'
      ? 'USER'
      : msg.role === 'error'
        ? 'ERROR'
        : 'ASSISTANT';
  const roleChipClass = msg.stopped
    ? 'agent-dialog-tag-stop'
    : msg.role === 'user'
      ? 'agent-dialog-tag-user'
      : msg.role === 'error'
        ? 'agent-dialog-tag-error'
        : 'agent-dialog-tag-agent';

  return (
    <div className={`agent-dialog-item ${kindClass}`}>
      <div className="agent-dialog-meta">
        <div className="agent-dialog-meta-main">
          <span className={`agent-dialog-tag ${roleChipClass}`}>{roleLabel}</span>
        </div>
        <span className="agent-dialog-time">{fmtTime(msg.timestamp)}</span>
      </div>
      {msg.images && msg.images.length > 0 && (
        <div className="agent-dialog-images">
          {msg.images.map((img, i) => (
            <img
              key={i}
              src={img.dataUrl}
              alt={`attachment ${i + 1}`}
              className="agent-dialog-img-thumb"
              onClick={() => window.open(img.dataUrl, '_blank')}
            />
          ))}
        </div>
      )}
      <div className="agent-dialog-text">
        {msg.pending ? (
          <div className="agent-dialog-typing">
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

export default function AgentCard({ data, onClose, onJourney }) {
  if (!data) return null;

  const { agent, charName, state, event, events = [], isPending, totalTokens = 0 } = data;
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
  const [guardPending, setGuardPending] = useState([]);
  const [gpResolving, setGpResolving] = useState(null);
  const [gpExpandedId, setGpExpandedId] = useState(null);
  const [pendingImages, setPendingImages] = useState([]);
  const [fetchedTokens, setFetchedTokens] = useState(0);
  const fileInputRef = useRef(null);
  const spriteUrl = `${CHAR_BASE}${charName}_idle_anim_32x32.png`;

  useEffect(() => {
    if (totalTokens > 0 || USE_AGENT_TOWN_MOCK || !agent?.id) return;
    let cancelled = false;
    fetch(`/api/events/?session_id=${encodeURIComponent(agent.id)}&limit=500`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json?.events) return;
        const sum = json.events.reduce((acc, evt) => acc + (evt.total_tokens || 0), 0);
        setFetchedTokens(sum);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [agent?.id, totalTokens]);

  const displayTokens = totalTokens > 0 ? totalTokens : fetchedTokens;

  const MAX_IMAGES = 8;
  const MAX_SINGLE_SIZE = 5 * 1024 * 1024;

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
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    const remaining = MAX_IMAGES - pendingImages.length;
    const toAdd = arr.slice(0, remaining);
    const results = [];
    for (const file of toAdd) {
      if (file.size > MAX_SINGLE_SIZE) continue;
      const { dataUrl, base64 } = await fileToBase64(file);
      results.push({ id: makeId(), file, dataUrl, base64, mimeType: file.type });
    }
    if (results.length > 0) {
      setPendingImages((prev) => [...prev, ...results]);
    }
  }, [pendingImages.length]);

  const removeImage = useCallback((imgId) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== imgId));
  }, []);

  const stateDot = state === 'working'
    ? 'dot-working'
    : state === 'idle'
      ? 'dot-idle'
      : state === 'pending'
        ? 'dot-pending'
        : 'dot-offline';

  const boundEvents = useMemo(
    () => (Array.isArray(events) && events.length ? events : event ? [event] : []),
    [event, events],
  );
  const latestEvent = event || boundEvents[0] || null;
  const fallbackMessages = useMemo(
    () => normalizeConversationMessages(latestEvent?.conversations || []),
    [latestEvent],
  );
  const displayMessages = messages.length ? messages : fallbackMessages;
  const threadStateLabel = sending
    ? 'Streaming reply'
    : loadingHistory
      ? 'Syncing history'
      : null;

  const latestTaskStatus = latestEvent?.status || null;

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
    if (!sessionKey || USE_AGENT_TOWN_MOCK) {
      setGuardPending([]);
      return undefined;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await guardAPI.pending(false);
        if (cancelled) return;
        const forSession = (data || []).filter(
          (p) => p.session_key === sessionKey || (p.session_key && p.session_key.endsWith(sessionKey)),
        );
        setGuardPending(
          forSession.map((p) => ({
            id: p.id,
            tool_name: p.tool_name,
            params: p.params ?? {},
            guard_verdict: p.guard_verdict ?? 'unsafe',
            guard_raw: p.guard_raw ?? '',
            session_context: p.session_context ?? '',
            risk_source: p.risk_source ?? null,
            failure_mode: p.failure_mode ?? null,
            real_world_harm: p.real_world_harm ?? null,
            created_at: p.created_at ?? 0,
          })),
        );
      } catch {
        if (!cancelled) setGuardPending([]);
      }
    };
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionKey]);

  const handleGuardResolve = useCallback(
    async (pendingId, resolution) => {
      if (!pendingId || USE_AGENT_TOWN_MOCK) return;
      setGpResolving(pendingId);
      try {
        await guardAPI.resolve(pendingId, resolution);
        const { data } = await guardAPI.pending(false);
        const forSession = (data || []).filter(
          (p) => p.session_key === sessionKey || (p.session_key && p.session_key.endsWith(sessionKey)),
        );
        setGuardPending(
          forSession.map((p) => ({
            id: p.id,
            tool_name: p.tool_name,
            params: p.params ?? {},
            guard_verdict: p.guard_verdict ?? 'unsafe',
            guard_raw: p.guard_raw ?? '',
            session_context: p.session_context ?? '',
            risk_source: p.risk_source ?? null,
            failure_mode: p.failure_mode ?? null,
            real_world_harm: p.real_world_harm ?? null,
            created_at: p.created_at ?? 0,
          })),
        );
      } catch (err) {
        console.warn('[AgentCard] guard resolve error:', err);
      } finally {
        setGpResolving(null);
      }
    },
    [sessionKey],
  );

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
    const imagesToSend = [...pendingImages];
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

    setInput('');
    setPendingImages([]);
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
        const reply = buildMockAssistantReply(text || '(image)', agent);
        await delayWithAbort(420, controller.signal);
        setMessages((prev) => prev.map((msg) => (
          msg.id === pendingId
            ? { ...msg, content: reply.text, pending: false }
            : msg
        )));
        return;
      }

      const body = { session_key: sessionKey, message: text || '(see attached image)' };
      if (imagesToSend.length > 0) {
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
  }, [agent, displayMessages, finalizeStoppedMessage, input, pendingImages, sending, sessionKey]);

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
                    {latestTaskStatus ? (
                      <span className={`agent-card-task-status agent-card-task-status-${latestTaskStatus}`}>
                        {latestTaskStatus.toUpperCase()}
                      </span>
                    ) : null}
                    <span className="agent-card-thread-chip">{sessionKey || 'No session'}</span>
                    <span className="agent-card-thread-chip">{displayMessages.length} MSG</span>
                    <span className="agent-card-thread-chip">{threadSummary.tool} TOOL</span>
                    <span className="agent-card-thread-chip">{boundEvents.length} RUNS</span>
                    <span className="agent-card-thread-chip">{fmtTokens(displayTokens)} TKN</span>
                    <span className="agent-card-thread-chip">{fmtDate(latestEvent?.start_time || agent.first_seen_at) || 'just now'}</span>
                    {threadStateLabel ? <span className="agent-card-thread-chip">{threadStateLabel}</span> : null}
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
          </section>

          {guardPending.length > 0 ? (
            <section className="tc-ornate-panel agent-card-guard-panel" aria-label="Guard pending approvals">
              <div className="agent-card-guard-strip-head">
                <div className="agent-dialog-overline">Guard</div>
                <h3 className="agent-dialog-title agent-card-guard-title">Review required</h3>
                <p className="agent-card-guard-hint">
                  Tool calls are paused until you approve or reject — same as Monitor.
                </p>
              </div>
              <div className="agent-card-guard-list">
                {guardPending.map((gp) => (
                  <div key={gp.id} className="agent-card-guard-card">
                    <div className="agent-card-guard-card-top">
                      <div className="agent-card-guard-card-main">
                        <div className="agent-card-guard-card-headline">
                          <span className="agent-card-guard-tool">{gp.tool_name}</span>
                          <span className="agent-card-guard-verdict-pill">{gp.guard_verdict}</span>
                        </div>
                        {(() => {
                          const eff = getEffectiveRisk(gp);
                          if (!eff) return null;
                          return (
                            <div className="agent-card-guard-tags">
                              {eff.risk_source ? <span className="agent-card-guard-tag agent-card-guard-tag-risk">{eff.risk_source}</span> : null}
                              {eff.failure_mode ? <span className="agent-card-guard-tag agent-card-guard-tag-failure">{eff.failure_mode}</span> : null}
                              {eff.real_world_harm ? <span className="agent-card-guard-tag agent-card-guard-tag-harm">{eff.real_world_harm}</span> : null}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="agent-card-guard-card-actions">
                        <button
                          type="button"
                          className="agent-card-guard-btn agent-card-guard-btn-approve"
                          disabled={gpResolving === gp.id}
                          onClick={() => handleGuardResolve(gp.id, 'approved')}
                        >
                          {gpResolving === gp.id ? '…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="agent-card-guard-btn agent-card-guard-btn-reject"
                          disabled={gpResolving === gp.id}
                          onClick={() => handleGuardResolve(gp.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                    {gp.session_context ? (
                      <div className="agent-card-guard-trajectory">
                        <div className="agent-card-guard-trajectory-label">Session trajectory</div>
                        <pre className="agent-card-guard-trajectory-body">{gp.session_context}</pre>
                      </div>
                    ) : null}
                    <div className="agent-card-guard-params">
                      <button
                        type="button"
                        className="agent-card-guard-params-toggle"
                        onClick={() => setGpExpandedId(gpExpandedId === gp.id ? null : gp.id)}
                      >
                        {gpExpandedId === gp.id ? '▼' : '▶'} Parameters
                      </button>
                      {gpExpandedId === gp.id ? (
                        <pre className="agent-card-guard-params-pre">
                          {JSON.stringify(gp.params, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="agent-dialog-panel">
            <div className="agent-dialog-head">
              <div className="agent-dialog-head-copy">
                <div className="agent-dialog-overline">Bound Session</div>
                <h3 className="agent-dialog-title">Conversation</h3>
              </div>
              <div className="agent-dialog-head-side">
                <span className="agent-dialog-counter">{displayMessages.length} MSG</span>
                <span className="agent-dialog-status">
                  {sending ? 'TRANSMITTING' : loadingHistory ? 'SYNCING' : sessionKey ? 'READY' : 'UNBOUND'}
                </span>
              </div>
            </div>

            <div className="agent-dialog-log">
              {loadingHistory ? (
                <div className="agent-dialog-empty">Syncing full session history...</div>
              ) : displayMessages.length === 0 ? (
                <div className="agent-dialog-empty">
                  No conversation loaded yet. Type below to continue this session.
                </div>
              ) : (
                displayMessages.map((msg) => <AgentDialogMessage key={msg.id} msg={msg} />)
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="agent-dialog-compose">
              {pendingImages.length > 0 && (
                <div className="agent-dialog-img-preview-strip">
                  {pendingImages.map((img) => (
                    <div key={img.id} className="agent-dialog-img-preview-item">
                      <img src={img.dataUrl} alt="pending" className="agent-dialog-img-preview" />
                      <button
                        type="button"
                        className="agent-dialog-img-remove"
                        onClick={() => removeImage(img.id)}
                        title="Remove image"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                className="agent-dialog-input"
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
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const imageFiles = [];
                  for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                      const file = items[i].getAsFile();
                      if (file) imageFiles.push(file);
                    }
                  }
                  if (imageFiles.length > 0) {
                    e.preventDefault();
                    addImages(imageFiles);
                  }
                }}
                placeholder={sessionKey ? 'Reply in this session...' : 'This agent is not bound to an active session.'}
                disabled={!sessionKey || sending}
              />
              <div className="agent-dialog-compose-toolbar">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files) addImages(e.target.files); e.target.value = ''; }}
                />
                <button
                  type="button"
                  className="agent-dialog-img-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!sessionKey || pendingImages.length >= MAX_IMAGES}
                  title="Attach image"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`agent-dialog-send ${sending ? 'agent-dialog-send-stop' : ''}`}
                  onClick={sending ? handleStop : handleSend}
                  disabled={sending ? false : !sessionKey || (!input.trim() && pendingImages.length === 0)}
                  aria-label={sending ? 'Stop current response' : 'Send message'}
                  title={sending ? 'Stop current response' : 'Send message'}
                >
                  {sending ? (
                    <svg className="agent-dialog-send-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="1.5" />
                    </svg>
                  ) : (
                    <svg className="agent-dialog-send-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 12.5 19 4l-3.8 16-4.3-5-6.9-2.5Z" />
                      <path d="M10.9 15 19 4" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
