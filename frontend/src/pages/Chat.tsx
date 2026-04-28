import { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  Send, Loader2, Bot, Plus, RotateCcw, Trash2, MessageSquare, Clock,
  Wrench, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, ImagePlus, X,
  Settings2, Brain, Cpu, Shield, Check, AlertTriangle, Mic, MicOff, Zap, Pencil,
} from 'lucide-react';
import { chatAPI, guardAPI, systemAPI, voiceAPI } from '../services/api';
import type { RuntimeInstance } from '../services/api';
import { useRuntimeInstances } from '../hooks/useAPI';
import { useI18n } from '../i18n';

declare global {
  interface Window {
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

/* ==================== Types ==================== */
interface PendingImage {
  id: string;
  file: File;
  dataUrl: string;   // for preview
  base64: string;    // raw base64 (no prefix)
  mimeType: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error' | 'tool_call';
  content: string;
  timestamp: Date;
  pending?: boolean;
  images?: { dataUrl: string }[];
  // tool call fields
  tool_id?: string;
  tool_name?: string;
  args?: any;
  result?: any;
  is_error?: boolean;
  result_pending?: boolean;
}

interface StoredSession {
  key: string;
  label: string;
  createdAt: string; // ISO string for JSON serialization
  instanceId?: string;
  platform?: string;
  displayName?: string;
  // §45: model bound at session creation time. For Hermes this is the
  // exact full_id pinned to ~/.hermes/config.yaml on first request (or
  // eagerly at start_session, see chat.py::_ensure_hermes_yaml_pinned_to).
  // Used by the sidebar chip + cross-session switch banner so users can see
  // which model each session is locked to and understand why switching
  // between different-model sessions takes ~10ms longer.
  model?: string;
  autoTitlePending?: boolean;
  titleEdited?: boolean;
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
async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const data = JSON.parse(text);
      const detail = data?.detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
      if (detail) return JSON.stringify(detail);
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDate(iso: string, todayLabel = 'Today', yesterdayLabel = 'Yesterday') {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return todayLabel;
  if (diffDays === 1) return yesterdayLabel;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function titleFromUserMessage(input: string): string {
  const cleaned = input
    .replace(/\s+/g, ' ')
    .replace(/^\/model\s+\S+\s*/i, '')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > 56 ? `${cleaned.slice(0, 56).trimEnd()}...` : cleaned;
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
  const { t } = useI18n();
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
          <div className="w-5 h-5 rounded-md bg-blue-500/15 flex items-center justify-center flex-shrink-0">
            <Wrench className="w-3 h-3 text-blue-400" />
          </div>
          <span className="text-[12px] font-semibold text-blue-400 flex-shrink-0">{msg.tool_name || 'tool'}</span>
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
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">{t.chat.arguments}</p>
                <pre className="text-[11px] font-mono text-text-secondary bg-surface-0/60 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                  {formatValue(msg.args)}
                </pre>
              </div>
            )}

            {/* Result */}
            {msg.result_pending ? (
              <div className="px-4 py-3 flex items-center gap-2 text-text-muted">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-[12px]">{t.chat.running}</span>
              </div>
            ) : msg.result !== undefined ? (
              <div className="px-4 py-3">
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${msg.is_error ? 'text-red-400' : 'text-text-muted'}`}>
                  {msg.is_error ? t.chat.error : t.chat.result}
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
  const { t } = useI18n();
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
          <span className="text-[12px] font-medium text-text-secondary">{isUser ? t.chat.you : t.chat.assistant}</span>
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
            <>
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {msg.images.map((img, i) => (
                    <img
                      key={i}
                      src={img.dataUrl}
                      alt={`attachment ${i + 1}`}
                      className="max-w-[200px] max-h-[160px] rounded-lg object-cover border border-border/40 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => window.open(img.dataUrl, '_blank')}
                    />
                  ))}
                </div>
              )}
              {msg.content && (
                <p className="text-[13px] text-text-primary whitespace-pre-wrap leading-relaxed break-words">
                  {msg.content}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== Main ==================== */
export default function Chat() {
  const [sessions, setSessions] = useState<StoredSession[]>(loadStoredSessions);
  const [activeKey, setActiveKey] = useState<string | null>(() => loadStoredSessions()[0]?.key ?? null);
  const [messageMap, setMessageMap] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null); // key being loaded
  const [isComposing, setIsComposing] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);

  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; provider: string; reasoning: boolean }[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [activeRuntime, setActiveRuntime] = useState<RuntimeInstance | null>(null);
  const [supportsSessionPatch, setSupportsSessionPatch] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string>(''); // '' = default
  const [thinkingLevel, setThinkingLevel] = useState<string>(''); // '' = default/off
  const [patchingSession, setPatchingSession] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingSessionLabel, setEditingSessionLabel] = useState('');

  const [guardOn, setGuardOn] = useState(true);

  // §45: cross-session Hermes-switch hint.  When the user picks a session
  // whose bound Hermes model differs from the previously-active session's
  // model, the next chat round will trigger a ~10ms config.yaml rewrite
  // (see chat.py::_ensure_hermes_yaml_pinned_to).  We surface that
  // explicitly so users connect "delay" to "different model" rather than
  // suspecting a network issue.  Auto-dismisses after 8s; manual close
  // works too.  Tracking the *previous* Hermes model in a ref (instead of
  // diffing against current selectedModel) avoids spurious banners caused
  // by the picker reset that handleSelectSession performs.
  const [hermesSwitchHint, setHermesSwitchHint] = useState<string | null>(null);
  const prevHermesModelRef = useRef<string | null>(null);
  const hermesHintTimerRef = useRef<number | null>(null);

  const [guardPending, setGuardPending] = useState<{
    id: string; tool_name: string; params: Record<string, any>;
    guard_verdict: string; session_context: string;
    risk_source: string | null; failure_mode: string | null; real_world_harm: string | null;
    created_at: number;
  }[]>([]);
  const [gpResolving, setGpResolving] = useState<string | null>(null);
  const [gpExpandedId, setGpExpandedId] = useState<string | null>(null);

  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [installModalPlatform, setInstallModalPlatform] = useState<'openclaw' | 'hermes' | 'nanobot'>('openclaw');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRecRef = useRef<any>(null);
  const voiceListeningRef = useRef(false);
  const rawTranscriptRef = useRef('');
  const shouldFinalizeRef = useRef(false);
  const voiceModelRef = useRef<string | null>(null);
  const voiceThinkingLevelRef = useRef<string | null>(null);
  const voiceLangTriedRef = useRef<'zh-CN' | 'zh' | 'en-US' | null>(null);
  const inFlightRef = useRef(false);
  const composingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  const { t, locale } = useI18n();
  const runtimeInstancesQuery = useRuntimeInstances();

  const MAX_IMAGES = 8;
  const MAX_SINGLE_SIZE = 5 * 1024 * 1024; // 5 MB per image

  const THINKING_LEVELS = [
    { value: '',        label: t.chat.thinkingLevels.default },
    { value: 'off',     label: t.chat.thinkingLevels.off },
    { value: 'minimal', label: t.chat.thinkingLevels.minimal },
    { value: 'low',     label: t.chat.thinkingLevels.low },
    { value: 'medium',  label: t.chat.thinkingLevels.medium },
    { value: 'high',    label: t.chat.thinkingLevels.high },
    { value: 'xhigh',  label: t.chat.thinkingLevels.max },
  ];

  const activeSession = activeKey ? (sessions.find(item => item.key === activeKey) ?? null) : null;
  const activeMessages: ChatMessage[] = activeKey ? (messageMap[activeKey] ?? []) : [];
  const availableInstances = (runtimeInstancesQuery.data?.instances ?? []).filter(instance => instance.enabled);
  const selectedInstance = availableInstances.find(instance => instance.instance_id === selectedInstanceId) ?? null;
  const activeInstance = activeSession?.instanceId
    ? availableInstances.find(instance => instance.instance_id === activeSession.instanceId) ?? null
    : null;
  const selectedRuntimeUnavailable =
    selectedInstance?.platform === 'nanobot' && selectedInstance.health_status !== 'healthy';
  const activeRuntimeUnavailable =
    activeInstance?.platform === 'nanobot' && activeInstance.health_status !== 'healthy';
  const selectedRuntimeUnavailableMessage = selectedRuntimeUnavailable
    ? t.chat.nanobotGatewayOffline
    : '';
  const activeRuntimeUnavailableMessage = activeRuntimeUnavailable
    ? t.chat.nanobotGatewayOffline
    : '';

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

  useEffect(() => {
    if (availableInstances.length === 0) {
      setSelectedInstanceId(prev => (prev && prev === activeSession?.instanceId ? prev : ''));
      return;
    }
    const defaultInstance = availableInstances.find(i => i.platform === 'openclaw' && i.is_default)
      ?? availableInstances.find(i => i.platform === 'openclaw')
      ?? availableInstances[0];
    if (defaultInstance) {
      setSelectedInstanceId(prev => (
        prev && availableInstances.some(instance => instance.instance_id === prev)
          ? prev
          : defaultInstance.instance_id
      ));
    }
  }, [activeSession?.instanceId, availableInstances]);

  useEffect(() => {
    if (activeSession?.instanceId) {
      setSelectedInstanceId(activeSession.instanceId);
    }
  }, [activeSession?.instanceId]);

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

  // §45: detect Hermes-to-Hermes session switches whose bound models
  // differ, and show the inline switch banner.  Skipped silently when:
  //  - either side isn't Hermes (OpenClaw/nanobot have no shared-config
  //    cost),
  //  - either session has no recorded model (legacy sessions stored before
  //    §45 won't carry s.model — falling back to "no banner" is safer
  //    than guessing),
  //  - the two models are identical (RWLock read path, no rewrite).
  // The first activation after page load also doesn't fire since
  // prevHermesModelRef starts null.
  useEffect(() => {
    if (!activeKey) {
      prevHermesModelRef.current = null;
      return;
    }
    const cur = sessions.find(s => s.key === activeKey);
    if (!cur || cur.platform !== 'hermes' || !cur.model) {
      prevHermesModelRef.current = cur?.platform === 'hermes' ? (cur.model || null) : null;
      return;
    }
    const prevModel = prevHermesModelRef.current;
    if (prevModel && prevModel !== cur.model) {
      if (hermesHintTimerRef.current != null) {
        window.clearTimeout(hermesHintTimerRef.current);
      }
      setHermesSwitchHint(cur.model);
      hermesHintTimerRef.current = window.setTimeout(() => {
        setHermesSwitchHint(null);
        hermesHintTimerRef.current = null;
      }, 8000);
    }
    prevHermesModelRef.current = cur.model;
    return () => {
      // Component-level cleanup is handled in the unmount effect below;
      // here we only need to avoid stale timers between rapid switches,
      // which the next clearTimeout above already covers.
    };
  }, [activeKey, sessions]);

  useEffect(() => () => {
    if (hermesHintTimerRef.current != null) {
      window.clearTimeout(hermesHintTimerRef.current);
    }
  }, []);

  // Load initial guard state
  useEffect(() => {
    guardAPI.getEnabled().then(r => setGuardOn(r.data.enabled)).catch(() => {});
  }, []);

  const handleGpResolve = async (id: string, resolution: string) => {
    setGpResolving(id);
    try {
      await guardAPI.resolve(id, resolution);
      setGuardPending(prev => prev.filter(p => p.id !== id));
    } catch (e) { console.error('resolve failed', e); }
    finally { setGpResolving(null); }
  };

  const toggleGuard = async () => {
    const next = !guardOn;
    setGuardOn(next);
    try { await guardAPI.setEnabled(next); } catch { setGuardOn(!next); }
  };

  const applyAutoSessionTitle = useCallback((key: string, text: string) => {
    const title = titleFromUserMessage(text);
    if (!title) return;
    setSessions(prev => prev.map(session => (
      session.key === key && session.autoTitlePending && !session.titleEdited
        ? { ...session, label: title, autoTitlePending: false }
        : session
    )));
  }, []);

  const startRenameSession = (session: StoredSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionKey(session.key);
    setEditingSessionLabel(session.label);
  };

  const cancelRenameSession = () => {
    setEditingSessionKey(null);
    setEditingSessionLabel('');
  };

  const commitRenameSession = (key: string) => {
    const label = editingSessionLabel.replace(/\s+/g, ' ').trim();
    if (label) {
      setSessions(prev => prev.map(session => (
        session.key === key
          ? { ...session, label, autoTitlePending: false, titleEdited: true }
          : session
      )));
    }
    cancelRenameSession();
  };

  // Load available models once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setModelsLoading(true);
      try {
        const res = await chatAPI.availableModels(selectedInstanceId || undefined);
        if (!cancelled) {
          setAvailableModels(res.data.models);
          setDefaultModel(res.data.default_model);
          setActiveRuntime((res.data.instance as RuntimeInstance) || null);
          setSupportsSessionPatch(res.data.supports_session_patch !== false);
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setModelsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedInstanceId]);

  // Poll guard pending items for the active session
  useEffect(() => {
    if (!activeKey) { setGuardPending([]); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await guardAPI.pending(false);
        if (cancelled) return;
        const forSession = data.filter((p: any) => p.session_key === activeKey || p.session_key?.endsWith(activeKey));
        setGuardPending(forSession.map((p: any) => ({
          id: p.id,
          tool_name: p.tool_name,
          params: p.params ?? {},
          guard_verdict: p.guard_verdict ?? 'unsafe',
          session_context: p.session_context ?? '',
          risk_source: p.risk_source ?? null,
          failure_mode: p.failure_mode ?? null,
          real_world_harm: p.real_world_harm ?? null,
          created_at: p.created_at ?? 0,
        })));
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeKey]);

  // Close model dropdown on outside click
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  // Apply model / thinking change to the active session
  const applySessionSettings = async (model: string, thinking: string) => {
    if (!activeKey || !supportsSessionPatch) return;
    setPatchingSession(true);
    try {
      await chatAPI.patchSession(activeKey, {
        model: model || null,
        thinking_level: thinking || null,
      });
    } catch (err: any) {
      console.error('Failed to patch session:', err);
    } finally {
      setPatchingSession(false);
    }
  };

  /* --- Image handling --- */
  const fileToBase64 = (file: File): Promise<{ dataUrl: string; base64: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1] ?? '';
        resolve({ dataUrl, base64 });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const addImages = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    const remaining = MAX_IMAGES - pendingImages.length;
    const toAdd = arr.slice(0, remaining);
    const results: PendingImage[] = [];
    for (const file of toAdd) {
      if (file.size > MAX_SINGLE_SIZE) continue;
      const { dataUrl, base64 } = await fileToBase64(file);
      results.push({ id: uuidv4(), file, dataUrl, base64, mimeType: file.type });
    }
    setPendingImages(prev => [...prev, ...results]);
  };

  const removeImage = (id: string) => {
    setPendingImages(prev => prev.filter(img => img.id !== id));
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
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
  }, [pendingImages.length]); // eslint-disable-line

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  /* --- New Session --- */
  const handleNewSession = async () => {
    if (connecting) return;

    // Detect which platform the selected instance belongs to
    const selectedInstance = availableInstances.find(i => i.instance_id === selectedInstanceId) ?? null;
    const selectedPlatform = selectedInstance?.platform ?? 'openclaw';

    // Check installation status from system status
    try {
      const statusRes = await systemAPI.installStatus();
      const d = statusRes.data as any;
      const installedByPlatform = {
        openclaw: Boolean(d.openclaw_installed),
        hermes: Boolean(d.hermes_installed),
        nanobot: Boolean(d.nanobot_installed),
      } as const;
      if (!installedByPlatform[selectedPlatform]) {
        setInstallModalPlatform(selectedPlatform);
        setInstallModalOpen(true);
        return;
      }
    } catch { /* proceed without check */ }

    if (selectedRuntimeUnavailable) {
      alert(selectedRuntimeUnavailableMessage);
      return;
    }
    setConnecting(true);
    try {
      // §43e: forward the picker's currently-selected model as model_override.
      // Without this, ``start_session`` (chat.py L1599-1614) skips the
      // ``patch_session`` call when ``model_override`` / ``provider_override``
      // / ``label`` are all blank, so the new session inherits whatever
      // ``~/.hermes/config.yaml::model.default`` happens to be.  That default
      // gets overwritten to the custom-endpoint model the moment the user
      // saves a Custom Endpoint config (§43c writes
      // ``model.{provider:custom, default:<custom_model>, ...}`` because
      // Hermes requires the inline ``base_url``/``api_key`` for routing) —
      // so creating the *next* agent silently picks up the custom model
      // instead of whatever the picker shows, even though the picker UI
      // looks fine.  Passing ``selectedModel`` here aligns the new session
      // with the visible picker state on first creation; subsequent picker
      // changes still flow through ``applySessionSettings`` → ``patchSession``.
      const trimmedModel = (selectedModel || '').trim();
      const startBody: { instance_id?: string; model_override?: string | null } = {};
      if (selectedInstanceId) startBody.instance_id = selectedInstanceId;
      if (trimmedModel) startBody.model_override = trimmedModel;
      const res = await chatAPI.startSession(Object.keys(startBody).length ? startBody : undefined);
      const key = res.data.session_key;
      // §45: capture the model the session is bound to at create time so
      // the sidebar chip + Hermes-switch banner have a stable source of
      // truth.  trimmedModel reflects the picker; defaultModel is the
      // platform fallback when the picker is empty.  Backend may also
      // return res.data.model (preferred when present).
      const boundModel = (res.data as any)?.model
        || trimmedModel
        || defaultModel
        || undefined;
      const newSession: StoredSession = {
        key,
        label: t.chat.newChatLabel,
        createdAt: new Date().toISOString(),
        instanceId: res.data.instance_id,
        platform: res.data.platform,
        displayName: res.data.instance?.display_name,
        model: boundModel,
        autoTitlePending: true,
      };
      setSessions(prev => [newSession, ...prev]);
      setMessageMap(prev => ({ ...prev, [key]: [] }));
      setActiveKey(key);
    } catch (err: any) {
      alert(err.response?.data?.detail || t.chat.connectFailed);
    } finally {
      setConnecting(false);
    }
  };

  /* --- Switch session --- */
  const handleSelectSession = (key: string) => {
    const session = sessions.find(item => item.key === key);
    cancelRenameSession();
    setActiveKey(key);
    if (session?.instanceId) setSelectedInstanceId(session.instanceId);
    setSelectedModel('');
    setThinkingLevel('');
    setShowSettings(false);
    setModelDropdownOpen(false);
    setModelSearch('');
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
    if (editingSessionKey === key) cancelRenameSession();
    setSessions(prev => prev.filter(s => s.key !== key));
    setMessageMap(prev => { const next = { ...prev }; delete next[key]; return next; });
    if (activeKey === key) {
      const remaining = sessions.filter(s => s.key !== key);
      setActiveKey(remaining[0]?.key ?? null);
    }
  };

  /* --- Send (streaming via SSE) --- */
  const handleSend = async () => {
    const text = input.trim();
    const hasImages = pendingImages.length > 0;
    if ((!text && !hasImages) || !activeKey || inFlightRef.current) return;
    if (activeRuntimeUnavailable) {
      setMessageMap(prev => ({
        ...prev,
        [activeKey]: [
          ...(prev[activeKey] ?? []),
          {
            id: uuidv4(),
            role: 'error' as const,
            content: activeRuntimeUnavailableMessage,
            timestamp: new Date(),
          },
        ],
      }));
      return;
    }

    const modelCommand = parsePromptModelSwitch(text);
    const textToSend = modelCommand ?? text;

    let key = activeKey;
    inFlightRef.current = true;

    const imagesToSend = [...pendingImages];
    setInput('');
    setPendingImages([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setSending(true);

    const userMsg: ChatMessage = {
      id: uuidv4(), role: 'user', content: text, timestamp: new Date(),
      images: imagesToSend.map(img => ({ dataUrl: img.dataUrl })),
    };
    const pendingId = uuidv4();
    const pendingMsg: ChatMessage = { id: pendingId, role: 'assistant', content: '', timestamp: new Date(), pending: true };

    setMessageMap(prev => ({ ...prev, [key]: [...(prev[key] ?? []), userMsg, pendingMsg] }));
    applyAutoSessionTitle(key, text);

    const body: any = { session_key: key, message: textToSend || '(see attached image)' };
    if (imagesToSend.length > 0) {
      body.images = imagesToSend.map(img => ({
        mime_type: img.mimeType,
        data: img.base64,
        file_name: img.file.name,
      }));
    }

    try {
      const response = await fetch('/api/chat/send-message-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error(await responseErrorMessage(response));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Remove "pending" dots once stream starts
      let streamStarted = false;

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
              session_key?: string;
              tool_id?: string; tool_name?: string; args?: any; result?: any; is_error?: boolean;
              reason?: string;
            };

            if (chunk.type === 'session_relinked' && chunk.session_key) {
              const previousKey = key;
              const nextKey = chunk.session_key;
              if (nextKey && nextKey !== previousKey) {
                key = nextKey;
                setSessions(prev => prev.map(session => (
                  session.key === previousKey ? { ...session, key: nextKey } : session
                )));
                setMessageMap(prev => {
                  const next = { ...prev };
                  next[nextKey] = next[previousKey] ?? next[nextKey] ?? [];
                  delete next[previousKey];
                  return next;
                });
                setActiveKey(current => (current === previousKey ? nextKey : current));
              }
            } else if (chunk.type === 'delta' && chunk.text) {
              if (!streamStarted) streamStarted = true;
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(m =>
                  m.id === pendingId
                    ? { ...m, content: chunk.text!, pending: false }
                    : m
                ),
              }));

            } else if (chunk.type === 'tool_start') {
              // Insert a new tool_call bubble BEFORE the assistant bubble
              // (tool events arrive after final, so insert before the last assistant msg)
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
                // Find the assistant bubble (the one that was pendingId, now finalized)
                const assistantIdx = msgs.findIndex(m => m.id === pendingId);
                const insertAt = assistantIdx >= 0 ? assistantIdx : msgs.length - 1;
                const next = [...msgs];
                next.splice(insertAt, 0, toolMsg);
                return { ...prev, [key]: next };
              });

            } else if (chunk.type === 'tool_result') {
              // Update the corresponding tool_call bubble with result
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(m =>
                  m.role === 'tool_call' && m.tool_id === chunk.tool_id
                    ? { ...m, result: chunk.result, is_error: chunk.is_error, result_pending: false }
                    : m
                ),
              }));
            } else if (chunk.type === 'tool_blocked') {
              const blockedText =
                chunk.text ||
                (chunk.reason
                  ? `工具调用已被安全审核拒绝。\n原因：${chunk.reason}`
                  : '工具调用已被安全审核拒绝。');
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(m => {
                  if (m.id === pendingId) {
                    return {
                      ...m,
                      role: 'assistant' as const,
                      content: blockedText,
                      pending: false,
                    };
                  }
                  if (
                    m.role === 'tool_call' &&
                    m.result_pending &&
                    chunk.tool_name &&
                    m.tool_name === chunk.tool_name
                  ) {
                    return {
                      ...m,
                      result: chunk.reason || blockedText,
                      is_error: true,
                      result_pending: false,
                    };
                  }
                  return m;
                }),
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

      // Safety: if stream ended without finalizing, remove pending state
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

  const stopVoice = useCallback(() => {
    try {
      const rec = speechRecRef.current;
      if (rec) rec.stop();
    } catch {
      // ignore
    } finally {
      voiceListeningRef.current = false;
      setVoiceListening(false);
    }
  }, []);

  const startVoice = useCallback(() => {
    const Rec = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Rec) return;

    // Capture session style for transcript cleaning at start time.
    voiceModelRef.current = selectedModel ? selectedModel : null;
    voiceThinkingLevelRef.current = thinkingLevel ? thinkingLevel : null;
    rawTranscriptRef.current = '';
    shouldFinalizeRef.current = true;

    if (!speechRecRef.current) {
      const rec = new Rec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = locale === 'zh' ? 'zh-CN' : 'en-US';
      voiceLangTriedRef.current = rec.lang;

      rec.onresult = (event: any) => {
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const r = event.results[i];
          const text = r?.[0]?.transcript ?? '';
          if (r?.isFinal) finalText += text;
        }
        finalText = finalText.trim();
        if (!finalText) return;
        rawTranscriptRef.current = rawTranscriptRef.current
          ? `${rawTranscriptRef.current} ${finalText}`
          : finalText;
      };

      rec.onerror = () => {
        // Some browsers accept 'zh' but not 'zh-CN'.
        if (locale === 'zh' && voiceLangTriedRef.current === 'zh-CN') {
          try {
            voiceLangTriedRef.current = 'zh';
            rec.lang = 'zh';
            speechRecRef.current = rec;
            rec.start();
            voiceListeningRef.current = true;
            setVoiceListening(true);
            return;
          } catch {
            // fall through to stopVoice()
          }
        }
        shouldFinalizeRef.current = false;
        stopVoice();
      };

      rec.onend = () => {
        voiceListeningRef.current = false;
        setVoiceListening(false);

        if (!shouldFinalizeRef.current) return;
        shouldFinalizeRef.current = false;

        const raw = rawTranscriptRef.current.trim();
        rawTranscriptRef.current = '';
        if (!raw) return;

        (async () => {
          try {
            setVoiceProcessing(true);
            const res = await voiceAPI.transcribeClean({
              text: raw,
              model: voiceModelRef.current,
              thinking_level: voiceThinkingLevelRef.current,
            });
            const cleaned = res.data.cleaned_text?.trim();
            if (cleaned) setInput(cleaned);
            setTimeout(() => textareaRef.current?.focus(), 0);
          } catch {
            // Fallback to raw transcript if cleaning fails.
            setInput(raw);
            setTimeout(() => textareaRef.current?.focus(), 0);
          } finally {
            setVoiceProcessing(false);
          }
        })();
      };

      speechRecRef.current = rec;
    }

    try {
      speechRecRef.current.start();
      voiceListeningRef.current = true;
      setVoiceListening(true);
    } catch {
      // start() may throw if already started
    }
  }, [stopVoice, selectedModel, thinkingLevel, voiceAPI, locale]);

  const toggleVoice = useCallback(() => {
    if (!voiceSupported) return;
    if (voiceProcessing) return;
    if (voiceListeningRef.current) stopVoice();
    else startVoice();
  }, [startVoice, stopVoice, voiceSupported, voiceProcessing]);

  useEffect(() => {
    const Rec = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setVoiceSupported(Boolean(Rec));
  }, []);

  useEffect(() => {
    if (sending && voiceListeningRef.current) stopVoice();
  }, [sending, stopVoice]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  const handleQuickModelSwitch = async () => {
    if (!activeKey || patchingSession) return;
    const modelRef = (selectedModel || '').trim();
    if (!modelRef) return;
    setShowSettings(false);
    setModelDropdownOpen(false);
    setModelSearch('');
    await applySessionSettings(modelRef, thinkingLevel);
  };


  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;

    const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
    const isImeComposing =
      isComposing ||
      composingRef.current ||
      !!native.isComposing ||
      native.keyCode === 229 ||
      Date.now() - lastCompositionEndAtRef.current < 30;

    if (isImeComposing) return;

    if (!e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const [dragOver, setDragOver] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addImages(e.dataTransfer.files);
  }, [pendingImages.length]); // eslint-disable-line

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-8 py-5 flex items-center justify-between bg-surface-0">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-text-primary">{t.chat.title}</h1>
            <span className="text-[11px] font-semibold border border-success/40 text-success px-3 py-1 rounded-full uppercase tracking-wider">{t.common.active}</span>
          </div>
          <p className="text-[13px] text-text-muted mt-1">{t.chat.subtitle}</p>
          {activeRuntime && (
            <p className="text-[11px] text-text-muted mt-1">
              {activeRuntime.display_name} · {activeRuntime.platform}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
              value={selectedInstanceId}
              onChange={e => setSelectedInstanceId(e.target.value)}
              disabled={availableInstances.length === 0}
              className="px-3 py-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-primary focus:outline-none focus:border-accent/50 disabled:opacity-60"
            >
              {availableInstances.length === 0 ? (
                <option value="">{runtimeInstancesQuery.isError ? 'Runtime unavailable' : t.chat.connecting}</option>
              ) : (
                availableInstances.map(instance => (
                  <option key={instance.instance_id} value={instance.instance_id}>
                    {instance.display_name}
                    {instance.platform === 'nanobot' && instance.health_status !== 'healthy'
                      ? ' · gateway offline'
                      : ''}
                  </option>
                ))
              )}
            </select>
          <button onClick={toggleGuard}
            className="flex items-center gap-2 group"
            title={guardOn ? t.chat.guardOn : t.chat.guardOff}
          >
            <span className={`text-[12px] font-semibold transition-colors ${guardOn ? 'text-emerald-400' : 'text-text-muted'}`}>
              <Shield className="w-4 h-4 inline -mt-0.5 mr-1" />{t.chat.guard}
            </span>
            <div className={`relative w-9 h-5 rounded-full transition-colors ${guardOn ? 'bg-emerald-500' : 'bg-surface-2'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${guardOn ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
            </div>
          </button>
          <button
            onClick={handleNewSession}
            disabled={connecting || selectedRuntimeUnavailable}
            title={selectedRuntimeUnavailable ? selectedRuntimeUnavailableMessage : undefined}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-accent-dim disabled:opacity-40 transition-all shadow-lg shadow-accent/20"
          >
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {connecting ? t.chat.connecting : t.chat.newSession}
          </button>
        </div>
      </div>
      {selectedRuntimeUnavailable && (
        <div className="flex-shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-8 py-2.5 text-[12px] text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{selectedRuntimeUnavailableMessage}</span>
        </div>
      )}
      {activeRuntimeUnavailable && activeSession?.instanceId !== selectedInstanceId && (
        <div className="flex-shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-8 py-2.5 text-[12px] text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{activeRuntimeUnavailableMessage}</span>
        </div>
      )}
      {/* §45: Hermes per-session model switch hint. Soft info banner,
          NOT amber/red — this is expected behaviour, not an error. */}
      {hermesSwitchHint && (
        <div className="flex-shrink-0 border-b border-sky-500/20 bg-sky-500/10 px-8 py-2.5 text-[12px] text-sky-200 flex items-center gap-2">
          <Cpu className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{t.chat.hermesSwitchBanner.replace('{model}', hermesSwitchHint)}</span>
          <button
            type="button"
            onClick={() => {
              if (hermesHintTimerRef.current != null) {
                window.clearTimeout(hermesHintTimerRef.current);
                hermesHintTimerRef.current = null;
              }
              setHermesSwitchHint(null);
            }}
            className="flex-shrink-0 text-sky-300 hover:text-sky-100 transition-colors p-0.5"
            title={t.chat.hermesSwitchBannerDismiss}
            aria-label={t.chat.hermesSwitchBannerDismiss}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Sidebar — session list */}
        <div className="w-56 flex-shrink-0 border-r border-border bg-surface-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 flex-shrink-0 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {t.chat.sessions.replace('{n}', String(sessions.length))}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
            {sessions.length === 0 ? (
              <div className="text-center py-10">
                <MessageSquare className="w-6 h-6 text-text-muted mx-auto mb-2" />
                <p className="text-[11px] text-text-muted">{t.chat.noSessions}</p>
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
                      {editingSessionKey === s.key ? (
                        <input
                          value={editingSessionLabel}
                          onChange={e => setEditingSessionLabel(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          onBlur={() => commitRenameSession(s.key)}
                          onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Enter') commitRenameSession(s.key);
                            if (e.key === 'Escape') cancelRenameSession();
                          }}
                          autoFocus
                          className="w-full rounded-md border border-border bg-surface-0 px-2 py-1 text-[12px] font-medium text-text-primary outline-none focus:border-accent"
                          placeholder={t.chat.renameSessionPlaceholder}
                        />
                      ) : (
                        <p className="text-[12px] font-medium truncate">{s.label}</p>
                      )}
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5 text-text-muted flex-shrink-0" />
                        <p className="text-[10px] text-text-muted truncate">
                          {fmtDate(s.createdAt, t.chat.today, t.chat.yesterday)}
                          {messageMap[s.key] !== undefined && ` · ${msgCount} msg${msgCount !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                      {s.displayName && (
                        <p className="text-[10px] text-text-muted truncate mt-0.5">
                          {s.displayName}
                        </p>
                      )}
                      {/* §45: per-session bound-model chip.  Renders for
                          any session that recorded a model at create time
                          (Hermes is the primary use case since chat-time
                          model switches are blocked there; OpenClaw still
                          benefits as a passive overview).  Hermes sessions
                          additionally tint the chip violet so the user can
                          spot at a glance which sessions share a model and
                          will skip the config rewrite. */}
                      {s.model && (
                        <p
                          className={`text-[10px] font-mono truncate mt-0.5 ${
                            s.platform === 'hermes' ? 'text-violet-300/80' : 'text-text-muted'
                          }`}
                          title={`${t.chat.sessionModelLabel}: ${s.model}`}
                        >
                          <Cpu className="w-2.5 h-2.5 inline -mt-px mr-1" />
                          {s.model.includes('/') ? s.model.split('/').pop() : s.model}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={e => startRenameSession(s, e)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-text-primary transition-all flex-shrink-0"
                      title={t.chat.renameSession}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={e => handleDeleteSession(s.key, e)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-red-400 transition-all flex-shrink-0"
                      title={t.chat.deleteSession}
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
        <div
          className={`flex-1 flex flex-col overflow-hidden bg-surface-0 relative ${dragOver ? 'ring-2 ring-accent/40 ring-inset' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {dragOver && activeKey && (
            <div className="absolute inset-0 z-50 bg-accent/5 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
              <div className="bg-surface-1 border-2 border-dashed border-accent/50 rounded-2xl px-10 py-8 text-center shadow-2xl">
                <ImagePlus className="w-10 h-10 text-accent mx-auto mb-3" />
                <p className="text-sm font-medium text-text-primary">{t.chat.dropImages}</p>
                <p className="text-[12px] text-text-muted mt-1">{t.chat.imageFormats.replace('{n}', String(MAX_IMAGES))}</p>
              </div>
            </div>
          )}

          {!activeKey ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-20 h-20 rounded-3xl bg-surface-1 border border-border flex items-center justify-center mb-6">
                <MessageSquare className="w-10 h-10 text-text-muted" />
              </div>
              <h2 className="text-lg font-semibold text-text-secondary mb-2">{t.chat.noSession}</h2>
              <p className="text-[13px] text-text-muted max-w-sm mb-6">
                {t.chat.noSessionDesc}
              </p>
              <button
                onClick={handleNewSession}
                disabled={connecting || selectedRuntimeUnavailable}
                title={selectedRuntimeUnavailable ? selectedRuntimeUnavailableMessage : undefined}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-accent-dim disabled:opacity-40 transition-all shadow-lg shadow-accent/20"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {connecting ? t.chat.connecting : t.chat.newSession}
              </button>
            </div>
          ) : (
            <>
              {/* Session info bar */}
              <div className="flex-shrink-0 border-b border-border bg-surface-1/40">
                <div className="px-6 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-[12px] font-semibold text-text-primary truncate">
                      {sessions.find(s => s.key === activeKey)?.label ?? activeKey}
                    </p>
                    {/* Current model badge */}
                    {selectedModel && (
                      <span className="text-[10px] font-mono text-accent border border-accent/30 bg-accent/5 rounded px-1.5 py-0.5 flex-shrink-0 truncate max-w-[180px]">
                        <Cpu className="w-2.5 h-2.5 inline mr-1 -mt-px" />{selectedModel}
                      </span>
                    )}
                    {/* Thinking badge */}
                    {thinkingLevel && thinkingLevel !== 'off' && (
                      <span className="text-[10px] font-mono text-amber-400 border border-amber-400/30 bg-amber-400/5 rounded px-1.5 py-0.5 flex-shrink-0">
                        <Brain className="w-2.5 h-2.5 inline mr-1 -mt-px" />{thinkingLevel}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={handleQuickModelSwitch}
                      disabled={sending || !activeKey || !selectedModel}
                      className="px-2 py-1 text-[11px] rounded border border-border text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:opacity-50"
                      title={selectedModel ? `Send /model ${selectedModel}` : t.chat.pickModel}
                    >
                      {t.chat.switchModel}
                    </button>
                    <button
                      onClick={() => setShowSettings(v => !v)}
                      title={t.chat.sessionSettings}
                      className={`p-1.5 rounded-md transition-all ${
                        showSettings
                          ? 'text-accent bg-accent/10'
                          : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
                      }`}
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleRefreshHistory}
                      disabled={loadingHistory === activeKey}
                      title={t.chat.reloadHistory}
                      className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-md transition-all"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${loadingHistory === activeKey ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Settings panel */}
                {showSettings && (
                  <div className="px-6 py-3 border-t border-border/60 bg-surface-0/60 space-y-3">
                    {!supportsSessionPatch && (
                      <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-[11px] text-text-muted">
                        This runtime exposes a fixed per-instance model. Session-level model/thinking changes are unavailable.
                      </div>
                    )}
                    {/* Model selector */}
                    <div className="relative" ref={modelDropdownRef}>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 flex items-center gap-1.5">
                        <Cpu className="w-3 h-3" /> {t.chat.model}
                        {patchingSession && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
                      </label>

                      {/* Trigger button */}
                      <button
                        onClick={() => { setModelDropdownOpen(v => !v); setModelSearch(''); }}
                        disabled={!supportsSessionPatch}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-surface-1 border border-border rounded-lg text-[12px] hover:border-accent/40 transition-all"
                      >
                        <span className={selectedModel ? 'text-text-primary font-medium' : 'text-text-muted'}>
                          {selectedModel || defaultModel || t.chat.selectModel}
                        </span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {selectedModel && (
                            <span
                              onClick={e => { e.stopPropagation(); setSelectedModel(''); /* §43h: model is locked at session-create time; only update local state so the next New-Chat picks this up */ }}
                              className="text-text-muted hover:text-red-400 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </span>
                          )}
                          <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {/* Dropdown */}
                      {modelDropdownOpen && (
                        <div className="absolute z-50 left-0 right-0 mt-1 bg-surface-1 border border-border rounded-lg shadow-xl overflow-hidden">
                          {/* Search filter */}
                          <div className="px-3 py-2 border-b border-border/60">
                            <input
                              type="text"
                              value={modelSearch}
                              onChange={e => setModelSearch(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && modelSearch.trim()) {
                                  setSelectedModel(modelSearch.trim());
                                  setModelDropdownOpen(false);
                                  setModelSearch('');
                                  applySessionSettings(modelSearch.trim(), thinkingLevel);
                                } else if (e.key === 'Escape') {
                                  setModelDropdownOpen(false);
                                }
                              }}
                              placeholder={t.chat.filterModels}
                              autoFocus
                              className="w-full text-[11px] px-2 py-1.5 bg-surface-0 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50"
                            />
                          </div>

                          {/* Model list */}
                          <div className="max-h-56 overflow-y-auto">
                            {modelsLoading ? (
                              <div className="px-3 py-6 flex items-center justify-center gap-2 text-text-muted">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t.common.loading}
                              </div>
                            ) : (() => {
                              const filtered = modelSearch
                                ? availableModels.filter(m =>
                                    m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
                                    m.name.toLowerCase().includes(modelSearch.toLowerCase())
                                  )
                                : availableModels;
                              const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, m) => {
                                (acc[m.provider] ??= []).push(m);
                                return acc;
                              }, {});
                              const providers = Object.keys(grouped).sort();
                              if (providers.length === 0) {
                                return (
                                  <div className="px-3 py-4 text-[11px] text-text-muted text-center">
                                    {t.chat.noModels}
                                    {modelSearch && <span className="block mt-1">{t.chat.pressEnterUse.replace('{v}', modelSearch)}</span>}
                                  </div>
                                );
                              }
                              return providers.map(prov => (
                                <div key={prov}>
                                  <p className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-text-muted sticky top-0 bg-surface-1 border-b border-border/30">{prov}</p>
                                  {grouped[prov].map(m => {
                                    const isSelected = m.id === selectedModel;
                                    const isDefault = m.id === defaultModel;
                                    return (
                                      <button
                                        key={m.id}
                                        onClick={() => {
                                          setSelectedModel(m.id);
                                          setModelDropdownOpen(false);
                                          setModelSearch('');
                                          // §43h: model is locked at session-create time.  The picker
                                          // selection only seeds the next New-Chat (handleNewSession
                                          // forwards it as model_override).  We deliberately drop the
                                          // applySessionSettings/patch_session call that used to live
                                          // here so an existing session never silently switches models
                                          // mid-conversation — aligning Chat.tsx with the Agent Town
                                          // policy (TownConsole.jsx never patches a live session).
                                        }}
                                        className={`w-full text-left px-3 py-2 text-[11px] hover:bg-accent/10 transition-colors flex items-center justify-between gap-2 ${
                                          isSelected ? 'text-accent bg-accent/5 font-medium' : 'text-text-secondary'
                                        }`}
                                      >
                                        <span className="truncate">{m.name || m.id.split('/')[1]}</span>
                                        <span className="flex items-center gap-1.5 flex-shrink-0">
                                          {m.reasoning && <span title="Reasoning"><Brain className="w-3 h-3 text-amber-400" /></span>}
                                          {isDefault && <span className="text-[9px] text-accent bg-accent/10 rounded px-1 py-0.5">{t.chat.default}</span>}
                                          {isSelected && <CheckCircle2 className="w-3 h-3 text-accent" />}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Thinking level */}
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 flex items-center gap-1.5">
                        <Brain className="w-3 h-3" /> {t.chat.thinkingLevel}
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {THINKING_LEVELS.map(lvl => (
                          <button
                            key={lvl.value}
                            onClick={() => {
                              setThinkingLevel(lvl.value);
                              // §43h: only thinking_level may be patched on a live session;
                              // model is locked at create time (see picker onClick above).
                              // Passing model='' makes applySessionSettings forward
                              // model:null to the backend, which patch_session treats
                              // as "leave model untouched" (Hermes rejects non-null
                              // model post-§43h, OpenClaw/nanobot are unaffected).
                              applySessionSettings('', lvl.value);
                            }}
                            disabled={!supportsSessionPatch}
                            className={`px-2.5 py-1 text-[11px] rounded-md border transition-all ${
                              thinkingLevel === lvl.value
                                ? 'border-accent/50 bg-accent/10 text-accent font-medium'
                                : 'border-border bg-surface-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                            }`}
                          >
                            {lvl.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Guard inline approval panel */}
              {guardPending.length > 0 && (
                <div className="flex-shrink-0 mx-6 mt-3 space-y-2">
                  {guardPending.map(gp => (
                    <div key={gp.id} className="bg-surface-1 border-l-4 border-l-red-500 border border-border rounded-xl overflow-hidden">
                      <div className="px-5 py-4 flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                            <span className="font-mono text-sm font-semibold text-text-primary">{gp.tool_name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold uppercase">{gp.guard_verdict}</span>
                          </div>
                          <p className="text-[12px] text-text-muted">{t.chat.guardPaused}</p>
                          {(gp.risk_source || gp.failure_mode || gp.real_world_harm) && (
                            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                              {gp.risk_source && <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">{gp.risk_source}</span>}
                              {gp.failure_mode && <span className="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-medium">{gp.failure_mode}</span>}
                              {gp.real_world_harm && <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">{gp.real_world_harm}</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => handleGpResolve(gp.id, 'approved')} disabled={gpResolving === gp.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-50">
                            {gpResolving === gp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {t.common.approve}
                          </button>
                          <button onClick={() => handleGpResolve(gp.id, 'rejected')} disabled={gpResolving === gp.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-50">
                            <X className="w-3.5 h-3.5" /> {t.common.reject}
                          </button>
                        </div>
                      </div>
                      <div className="px-5 pb-4">
                        <button onClick={() => setGpExpandedId(gpExpandedId === gp.id ? null : gp.id)}
                          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary mb-2 transition-colors">
                          {gpExpandedId === gp.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {t.common.parameters}
                        </button>
                        {gpExpandedId === gp.id && (
                          <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-text-dim overflow-x-auto max-h-48">
                            {JSON.stringify(gp.params, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-8 py-5 space-y-5">
                {loadingHistory === activeKey ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <Loader2 className="w-8 h-8 text-text-muted animate-spin mb-3" />
                    <p className="text-[13px] text-text-muted">{t.chat.loadingHistory}</p>
                  </div>
                ) : activeMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Bot className="w-10 h-10 text-text-muted mb-3" />
                    <p className="text-sm text-text-secondary">{t.chat.sessionReady}</p>
                    <p className="text-[12px] text-text-muted mt-1">{t.chat.sendHint}</p>
                  </div>
                ) : (
                  activeMessages.map(msg => <Bubble key={msg.id} msg={msg} />)
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="flex-shrink-0 px-8 py-4 border-t border-border bg-surface-0">
                {/* Image preview strip */}
                {pendingImages.length > 0 && (
                  <div className="flex gap-2 mb-3 flex-wrap">
                    {pendingImages.map(img => (
                      <div key={img.id} className="relative group">
                        <img
                          src={img.dataUrl}
                          alt={img.file.name}
                          className="w-16 h-16 rounded-lg object-cover border border-border"
                        />
                        <button
                          onClick={() => removeImage(img.id)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <p className="text-[9px] text-text-muted text-center mt-0.5 truncate max-w-[64px]">
                          {img.file.name}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => { if (e.target.files) addImages(e.target.files); e.target.value = ''; }}
                />

                <div className={`flex items-center gap-3 bg-surface-1 border rounded-xl px-4 py-3 transition-all ${
                  sending
                    ? 'border-border opacity-80'
                    : 'border-border focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15'
                }`}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending || pendingImages.length >= MAX_IMAGES}
                    title={pendingImages.length >= MAX_IMAGES ? t.chat.maxImages.replace('{n}', String(MAX_IMAGES)) : t.chat.attachImage}
                    className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ImagePlus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={toggleVoice}
                    disabled={sending || !voiceSupported || voiceProcessing}
                    title={
                      !voiceSupported
                        ? t.chat.voiceUnsupported
                        : voiceListening
                          ? t.chat.stopVoiceInput
                          : t.chat.startVoiceInput
                    }
                    className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg transition-all ${
                      !voiceSupported
                        ? 'text-text-muted/40 cursor-not-allowed'
                        : voiceListening
                          ? 'text-accent bg-accent/15 hover:bg-accent/20'
                          : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
                    } ${(sending || voiceProcessing) ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    {voiceListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={() => {
                      composingRef.current = true;
                      setIsComposing(true);
                    }}
                    onCompositionEnd={() => {
                      composingRef.current = false;
                      lastCompositionEndAtRef.current = Date.now();
                      setIsComposing(false);
                    }}
                    placeholder={sending ? t.chat.waitingResponse : t.chat.placeholder}
                    rows={1}
                    disabled={sending || voiceProcessing}
                    autoFocus
                    className="flex-1 resize-none bg-transparent text-[13px] text-text-primary placeholder-text-muted focus:outline-none leading-relaxed disabled:opacity-60"
                    style={{ maxHeight: '160px' }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={(!input.trim() && pendingImages.length === 0) || sending || voiceProcessing || activeRuntimeUnavailable}
                    title={activeRuntimeUnavailable ? activeRuntimeUnavailableMessage : undefined}
                    className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-accent text-white hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-accent/20"
                  >
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {sending && (
                  <p className="text-[11px] text-text-muted mt-2 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {t.chat.waitingResponse}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Install prompt modal */}
      {installModalOpen && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-start gap-4 mb-5">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                installModalPlatform === 'nanobot'
                  ? 'bg-cyan-500/15'
                  : installModalPlatform === 'hermes'
                    ? 'bg-violet-500/15'
                    : 'bg-blue-500/15'
              }`}>
                {installModalPlatform === 'nanobot'
                  ? <Bot className="w-6 h-6 text-cyan-400" />
                  : installModalPlatform === 'hermes'
                    ? <Cpu className="w-6 h-6 text-violet-400" />
                    : <Zap className="w-6 h-6 text-blue-400" />}
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-text-primary mb-1">
                  {installModalPlatform === 'nanobot'
                    ? t.chat.installModalNanobotTitle
                    : installModalPlatform === 'hermes'
                      ? t.chat.installModalHermesTitle
                      : t.chat.installModalOpenclawTitle}
                </h3>
                <p className="text-[12px] text-text-muted leading-relaxed">
                  {installModalPlatform === 'nanobot'
                    ? t.chat.installModalNanobotDesc
                    : installModalPlatform === 'hermes'
                      ? t.chat.installModalHermesDesc
                      : t.chat.installModalOpenclawDesc}
                </p>
              </div>
              <button onClick={() => setInstallModalOpen(false)} className="text-text-muted hover:text-text-primary flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setInstallModalOpen(false)}
                className="flex-1 py-2.5 border border-border text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 rounded-xl transition-all">
                {t.chat.installModalCancel}
              </button>
              <button onClick={() => { setInstallModalOpen(false); window.location.href = '/setup'; }}
                className={`flex-1 py-2.5 text-white text-[13px] font-semibold rounded-xl transition-all shadow ${
                  installModalPlatform === 'nanobot'
                    ? 'bg-cyan-500 hover:bg-cyan-600 shadow-cyan-500/25'
                    : installModalPlatform === 'hermes'
                      ? 'bg-violet-500 hover:bg-violet-600 shadow-violet-500/25'
                    : 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/25'
                }`}>
                {t.chat.installModalGo}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
