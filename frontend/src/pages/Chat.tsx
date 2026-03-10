import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  Send, Loader2, Bot, Plus, RotateCcw, Trash2, MessageSquare, Clock,
  Wrench, ChevronDown, ChevronRight, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { chatAPI, systemAPI } from '../services/api';

/* ==================== Types ==================== */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error' | 'tool_call';
  content: string;
  timestamp: Date;
  pending?: boolean;
  images?: string[];
  // tool call fields
  tool_id?: string;
  tool_name?: string;
  args?: any;
  result?: any;
  is_error?: boolean;
  result_pending?: boolean; // true while waiting for the result
}

interface StoredSession {
  key: string;
  label: string;
  createdAt: string; // ISO string for JSON serialization
}

/* ==================== localStorage helpers ==================== */
const LS_KEY = 'safetyagent:chat:sessions';

function loadStoredSessions(): StoredSession[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveStoredSessions(sessions: StoredSession[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(sessions));
}

/* ==================== Helpers ==================== */
function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ==================== Extract text from OpenClaw message ==================== */
function extractMessageText(msg: any): string {
  if (!msg) return '';
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('');
  }
  if (typeof msg.text === 'string') return msg.text;
  return '';
}

const QUICK_MODELS = [
  'openai/gpt-5.2',
  'openai/gpt-5.2-mini',
  'anthropic/claude-opus-4-5',
  'anthropic/claude-sonnet-4-5',
  'google/gemini-2.5-pro',
];

function parsePromptModelSwitch(input: string): string | null {
  const text = input.trim();

  const patterns: RegExp[] = [
    /^switch\s+model\s+to\s+(.+)$/i,
    /^use\s+model\s+(.+)$/i,
    /^切换模型(?:到|为)?\s*(.+)$/,
    /^改用模型\s*(.+)$/,
    /^换模型(?:到|为)?\s*(.+)$/,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const ref = (m[1] || '').trim();
    if (!ref || ref.includes(' ')) return null;
    return `/model ${ref}`;
  }

  return null;
}

/* ==================== Tool Call Bubble ==================== */
function ToolCallBubble({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);

  const formatValue = (v: any): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };

  return (
    <div className="max-w-[800px] mx-auto w-full pl-10">
      <div className="border border-border rounded-xl overflow-hidden bg-surface-1/50">
        {/* Header */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-2/50 transition-colors text-left"
        >
          <div className="w-5 h-5 rounded-md bg-purple-500/15 flex items-center justify-center flex-shrink-0">
            <Wrench className="w-3 h-3 text-purple-400" />
          </div>
          <span className="text-[12px] font-semibold text-purple-400 flex-shrink-0">{msg.tool_name || 'tool'}</span>
          <span className="text-[11px] font-mono text-text-muted truncate flex-1">
            {msg.args ? formatValue(msg.args).replace(/\n/g,' ').slice(0, 60) : ''}
          </span>
          {msg.result_pending ? (
            <Loader2 className="w-3.5 h-3.5 text-text-muted animate-spin flex-shrink-0" />
          ) : msg.is_error ? (
            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          ) : msg.result !== undefined ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          ) : null}
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />}
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="border-t border-border">
            {/* Arguments */}
            {msg.args !== undefined && (
              <div className="px-4 py-3 border-b border-border/60">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Arguments</p>
                <pre className="text-[11px] font-mono text-text-secondary bg-surface-0/60 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                  {formatValue(msg.args)}
                </pre>
              </div>
            )}

            {/* Result */}
            {msg.result_pending ? (
              <div className="px-4 py-3 flex items-center gap-2 text-text-muted">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-[12px]">Running…</span>
              </div>
            ) : msg.result !== undefined ? (
              <div className="px-4 py-3">
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${msg.is_error ? 'text-red-400' : 'text-text-muted'}`}>
                  {msg.is_error ? 'Error' : 'Result'}
                </p>
                <pre className={`text-[11px] font-mono rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all max-h-64 ${
                  msg.is_error
                    ? 'text-red-300 bg-red-500/8'
                    : 'text-text-secondary bg-surface-0/60'
                }`}>
                  {formatValue(msg.result)}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================== Message Bubble ==================== */
function Bubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'tool_call') return <ToolCallBubble msg={msg} />;

  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-end max-w-[800px] mx-auto w-full`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-accent/20' : isError ? 'bg-red-500/20' : 'bg-emerald-500/20'
      }`}>
        {isUser
          ? <span className="text-[11px] font-semibold text-accent">U</span>
          : <Bot className={`w-3.5 h-3.5 ${isError ? 'text-red-400' : 'text-emerald-400'}`} />}
      </div>

      <div className={`flex flex-col gap-1 flex-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-[12px] font-medium text-text-secondary">{isUser ? 'You' : 'Assistant'}</span>
          <span className="text-[11px] text-text-muted">{fmtTime(msg.timestamp)}</span>
        </div>
        <div className={`rounded-2xl px-4 py-2.5 max-w-[85%] ${
          isUser
            ? 'bg-accent/15 border border-accent/20 rounded-tr-sm'
            : isError
              ? 'bg-red-500/10 border border-red-500/20 rounded-tl-sm'
              : 'bg-surface-2 border border-border rounded-tl-sm'
        }`}>
          {msg.pending ? (
            <div className="flex items-center gap-1.5 py-0.5 px-1">
              <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          ) : (
            <div className="space-y-2">
              {msg.content && (
                <p className="text-[13px] text-text-primary whitespace-pre-wrap leading-relaxed break-words">
                  {msg.content}
                </p>
              )}
              {msg.images && msg.images.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {msg.images.map((img, idx) => (
                    <img key={idx} src={img} alt={`pasted-${idx}`} className="w-24 h-24 object-cover rounded-lg border border-border" />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== Main ==================== */
export default function Chat() {
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<StoredSession[]>(loadStoredSessions);
  const [activeKey, setActiveKey] = useState<string | null>(() => loadStoredSessions()[0]?.key ?? null);
  const [messageMap, setMessageMap] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null); // key being loaded
  const [selectedModel, setSelectedModel] = useState<string>(QUICK_MODELS[0]);
  const [isComposing, setIsComposing] = useState(false);
  const [pastedImages, setPastedImages] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inFlightRef = useRef(false);

  const activeMessages: ChatMessage[] = activeKey ? (messageMap[activeKey] ?? []) : [];

  // Persist sessions to localStorage whenever they change
  useEffect(() => {
    saveStoredSessions(sessions);
  }, [sessions]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length]);

  // Auto-focus textarea
  useEffect(() => {
    if (activeKey) setTimeout(() => textareaRef.current?.focus(), 100);
  }, [activeKey]);

  // Load history when switching to a session that has no messages loaded yet
  const loadHistory = useCallback(async (key: string, force = false) => {
    if (!force && messageMap[key] !== undefined) return; // already loaded
    setLoadingHistory(key);
    try {
      const res = await chatAPI.getHistory(key);
      const rawMessages: any[] = res.data.messages ?? [];
      const loaded: ChatMessage[] = rawMessages
        .map((m: any): ChatMessage | null => {
          if (m.role === 'tool_call') {
            // Tool call messages from history (backend already parsed them)
            return {
              id: m.id || uuidv4(),
              role: 'tool_call',
              content: '',
              timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
              tool_id:        m.tool_id,
              tool_name:      m.tool_name,
              args:           m.args,
              result:         m.result,
              is_error:       m.is_error,
              result_pending: m.result_pending ?? false,
            };
          }
          if (m.role === 'user' || m.role === 'assistant') {
            const text = typeof m.content === 'string' ? m.content : extractMessageText(m);
            if (!text.trim()) return null;
            return {
              id: m.id || uuidv4(),
              role: m.role as 'user' | 'assistant',
              content: text,
              timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
            };
          }
          return null;
        })
        .filter((m): m is ChatMessage => m !== null);
      setMessageMap(prev => ({ ...prev, [key]: loaded }));
    } catch {
      setMessageMap(prev => ({ ...prev, [key]: [] }));
    } finally {
      setLoadingHistory(null);
    }
  }, [messageMap]);

  // When activeKey changes, load history if needed
  useEffect(() => {
    if (activeKey) loadHistory(activeKey);
  }, [activeKey]); // eslint-disable-line

  /* --- New Session --- */
  const handleNewSession = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const res = await chatAPI.startSession();
      const key = res.data.session_key;
      const newSession: StoredSession = {
        key,
        label: `Chat ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
        createdAt: new Date().toISOString(),
      };
      setSessions(prev => [newSession, ...prev]);
      setMessageMap(prev => ({ ...prev, [key]: [] }));
      setActiveKey(key);
    } catch (err: any) {
      try {
        const status = await systemAPI.status();
        if (!status.data.openclaw_installed) {
          const goSetup = window.confirm(
            'OpenClaw is not installed yet. Click OK to open the setup page for guided install.'
          );
          if (goSetup) navigate('/setup');
          return;
        }
      } catch {
        // ignore status check errors and fall back to gateway guidance
      }

      const detail = err.response?.data?.detail;
      alert(
        detail ||
        'Cannot connect to OpenClaw gateway. Please run `openclaw dashboard` (or `openclaw gateway`) first, then retry.'
      );
    } finally {
      setConnecting(false);
    }
  };

  /* --- Switch session --- */
  const handleSelectSession = (key: string) => {
    setActiveKey(key);
  };

  /* --- Refresh active session history from backend --- */
  const handleRefreshHistory = async () => {
    if (!activeKey || loadingHistory === activeKey) return;
    await loadHistory(activeKey, true);
  };

  /* --- Delete session --- */
  const handleDeleteSession = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await chatAPI.closeSession(key); } catch { /* ignore */ }
    setSessions(prev => prev.filter(s => s.key !== key));
    setMessageMap(prev => { const next = { ...prev }; delete next[key]; return next; });
    if (activeKey === key) {
      const remaining = sessions.filter(s => s.key !== key);
      setActiveKey(remaining[0]?.key ?? null);
    }
  };

  /* --- Send (streaming via SSE) --- */
  const sendText = async (rawText: string, userVisibleText?: string, images?: string[]) => {
    const text = rawText.trim();
    const imagePayload = (images ?? []).filter(Boolean);
    if ((!text && imagePayload.length === 0) || !activeKey || inFlightRef.current) return;

    const key = activeKey;
    inFlightRef.current = true;

    setInput('');
    setPastedImages([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setSending(true);

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: (userVisibleText ?? rawText).trim() || (imagePayload.length ? `[Pasted ${imagePayload.length} image${imagePayload.length > 1 ? 's' : ''}]` : ''),
      images: imagePayload.length ? imagePayload : undefined,
      timestamp: new Date(),
    };
    const pendingId = uuidv4();
    const pendingMsg: ChatMessage = { id: pendingId, role: 'assistant', content: '', timestamp: new Date(), pending: true };

    setMessageMap(prev => ({ ...prev, [key]: [...(prev[key] ?? []), userMsg, pendingMsg] }));

    try {
      const response = await fetch('/api/chat/send-message-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_key: key, message: text, images: imagePayload }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
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
              type: string; text?: string;
              tool_id?: string; tool_name?: string; args?: any; result?: any; is_error?: boolean;
            };

            if (chunk.type === 'delta' && chunk.text) {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(m =>
                  m.id === pendingId
                    ? { ...m, content: chunk.text!, pending: false }
                    : m
                ),
              }));

            } else if (chunk.type === 'tool_start') {
              const toolMsg: ChatMessage = {
                id: `tool-${chunk.tool_id || uuidv4()}`,
                role: 'tool_call',
                content: '',
                timestamp: new Date(),
                tool_id: chunk.tool_id,
                tool_name: chunk.tool_name,
                args: chunk.args,
                result_pending: true,
              };
              setMessageMap(prev => {
                const msgs = prev[key] ?? [];
                const assistantIdx = msgs.findIndex(m => m.id === pendingId);
                const insertAt = assistantIdx >= 0 ? assistantIdx : msgs.length - 1;
                const next = [...msgs];
                next.splice(insertAt, 0, toolMsg);
                return { ...prev, [key]: next };
              });

            } else if (chunk.type === 'tool_result') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(m =>
                  m.role === 'tool_call' && m.tool_id === chunk.tool_id
                    ? { ...m, result: chunk.result, is_error: chunk.is_error, result_pending: false }
                    : m
                ),
              }));

            } else if (chunk.type === 'final') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(m =>
                  m.id === pendingId
                    ? { ...m, content: chunk.text || m.content || '[No response]', pending: false }
                    : m
                ),
              }));
            } else if (chunk.type === 'error' || chunk.type === 'timeout' || chunk.type === 'aborted') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(m =>
                  m.id === pendingId
                    ? {
                        ...m,
                        role: chunk.type === 'error' ? 'error' as const : 'assistant' as const,
                        content: chunk.text || `[${chunk.type}]`,
                        pending: false,
                      }
                    : m
                ),
              }));
            }
          } catch { /* ignore JSON parse errors */ }
        }
      }

      setMessageMap(prev => ({
        ...prev,
        [key]: (prev[key] ?? []).map(m =>
          m.id === pendingId && m.pending
            ? { ...m, content: m.content || '[No response]', pending: false }
            : m
        ),
      }));

    } catch (err: any) {
      setMessageMap(prev => ({
        ...prev,
        [key]: (prev[key] ?? []).map(m =>
          m.id === pendingId
            ? { ...m, role: 'error' as const, content: `[Error] ${err.message}`, pending: false }
            : m
        ),
      }));
    } finally {
      setSending(false);
      inFlightRef.current = false;
    }
  };

  const handleSend = async () => {
    const original = input.trim();
    if (!original && pastedImages.length === 0) return;
    const modelCommand = parsePromptModelSwitch(original);
    if (modelCommand) {
      await sendText(modelCommand, original, pastedImages);
      return;
    }
    await sendText(original, undefined, pastedImages);
  };

  const handleQuickModelSwitch = async (modelRef: string) => {
    if (!activeKey || sending || inFlightRef.current) return;
    await sendText(`/model ${modelRef}`, `/model ${modelRef}`);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter(i => i.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();
    const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const urls: string[] = [];
    for (const item of imageItems.slice(0, 3)) {
      const file = item.getAsFile();
      if (!file) continue;
      const dataUrl = await toDataUrl(file);
      if (dataUrl.startsWith('data:image/')) urls.push(dataUrl);
    }

    if (urls.length > 0) {
      setPastedImages(prev => [...prev, ...urls].slice(0, 3));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-8 py-5 flex items-center justify-between bg-surface-0">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Safe Chat</h1>
          <p className="text-[13px] text-text-muted mt-1">A secure gateway to chat with your Claw agent.</p>
        </div>
        <button
          onClick={handleNewSession}
          disabled={connecting}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-accent-dim disabled:opacity-40 transition-all shadow-lg shadow-accent/20"
        >
          {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {connecting ? 'Connecting…' : 'New Session'}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Sidebar — session list */}
        <div className="w-56 flex-shrink-0 border-r border-border bg-surface-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 flex-shrink-0 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Sessions ({sessions.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
            {sessions.length === 0 ? (
              <div className="text-center py-10">
                <MessageSquare className="w-6 h-6 text-text-muted mx-auto mb-2" />
                <p className="text-[11px] text-text-muted">No sessions yet</p>
              </div>
            ) : (
              sessions.map(s => {
                const isActive = s.key === activeKey;
                const msgCount = (messageMap[s.key] ?? []).filter(m => !m.pending).length;
                const isLoading = loadingHistory === s.key;
                return (
                  <div
                    key={s.key}
                    onClick={() => handleSelectSession(s.key)}
                    className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                      isActive
                        ? 'bg-accent/15 text-accent'
                        : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                    }`}
                  >
                    {isLoading
                      ? <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-text-muted" />
                      : <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-accent' : 'text-text-muted'}`} />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate">{s.label}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5 text-text-muted flex-shrink-0" />
                        <p className="text-[10px] text-text-muted truncate">
                          {fmtDate(s.createdAt)}
                          {messageMap[s.key] !== undefined && ` · ${msgCount} msg${msgCount !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={e => handleDeleteSession(s.key, e)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-red-400 transition-all flex-shrink-0"
                      title="Delete session"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Main chat area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-surface-0">
          {!activeKey ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-20 h-20 rounded-3xl bg-surface-1 border border-border flex items-center justify-center mb-6">
                <MessageSquare className="w-10 h-10 text-text-muted" />
              </div>
              <h2 className="text-lg font-semibold text-text-secondary mb-2">No session selected</h2>
              <p className="text-[13px] text-text-muted max-w-sm mb-6">
                Select a previous session from the sidebar, or start a new one.
              </p>
              <button
                onClick={handleNewSession}
                disabled={connecting}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-accent-dim disabled:opacity-40 transition-all shadow-lg shadow-accent/20"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {connecting ? 'Connecting…' : 'New Session'}
              </button>
            </div>
          ) : (
            <>
              {/* Session info bar */}
              <div className="flex-shrink-0 px-6 py-2.5 border-b border-border flex items-center justify-between bg-surface-1/40">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-[12px] font-semibold text-text-primary truncate">
                    {sessions.find(s => s.key === activeKey)?.label ?? activeKey}
                  </p>
                  <span className="text-[10px] font-mono text-text-muted border border-border rounded px-1.5 py-0.5 flex-shrink-0">
                    {activeKey.slice(0, 18)}…
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                    className="text-[12px] bg-surface-0 border border-border rounded px-2 py-1 text-text-secondary"
                    title="Choose model"
                  >
                    {QUICK_MODELS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleQuickModelSwitch(selectedModel)}
                    disabled={sending || !activeKey}
                    className="px-2.5 py-1 text-[12px] rounded border border-border text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:opacity-50"
                    title="Switch model with /model"
                  >
                    Switch Model
                  </button>
                  <button
                    onClick={handleRefreshHistory}
                    disabled={loadingHistory === activeKey}
                    title="Reload latest history from OpenClaw session file"
                    className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-md transition-all"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${loadingHistory === activeKey ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-8 py-5 space-y-5">
                {loadingHistory === activeKey ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <Loader2 className="w-8 h-8 text-text-muted animate-spin mb-3" />
                    <p className="text-[13px] text-text-muted">Loading history…</p>
                  </div>
                ) : activeMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Bot className="w-10 h-10 text-text-muted mb-3" />
                    <p className="text-sm text-text-secondary">Session ready. Say something to get started.</p>
                    <p className="text-[12px] text-text-muted mt-1">↵ to send · Shift+↵ for new line</p>
                  </div>
                ) : (
                  activeMessages.map(msg => <Bubble key={msg.id} msg={msg} />)
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="flex-shrink-0 px-8 py-4 border-t border-border bg-surface-0">
                <div className={`flex items-end gap-3 bg-surface-1 border rounded-xl px-4 py-3 transition-all ${
                  sending
                    ? 'border-border opacity-80'
                    : 'border-border focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15'
                }`}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                    onPaste={handlePaste}
                    placeholder={sending ? 'Waiting for response…' : 'Message (↵ to send, Shift+↵ for line breaks)'}
                    rows={1}
                    disabled={sending}
                    autoFocus
                    className="flex-1 resize-none bg-transparent text-[13px] text-text-primary placeholder-text-muted focus:outline-none leading-relaxed disabled:opacity-60"
                    style={{ maxHeight: '160px' }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={(!input.trim() && pastedImages.length === 0) || sending}
                    className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-accent text-white hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-accent/20"
                  >
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {pastedImages.length > 0 && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {pastedImages.map((img, idx) => (
                      <div key={idx} className="relative">
                        <img src={img} alt={`paste-preview-${idx}`} className="w-14 h-14 rounded-md object-cover border border-border" />
                        <button
                          onClick={() => setPastedImages(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black/70 text-white text-[10px]"
                          title="Remove image"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <span className="text-[11px] text-text-muted">Pasted image{pastedImages.length > 1 ? 's' : ''} will be sent with the message.</span>
                  </div>
                )}
                {sending && (
                  <p className="text-[11px] text-text-muted mt-2 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Waiting for agent response…
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
