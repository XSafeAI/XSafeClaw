import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Bot,
  Box,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns2,
  FolderOpen,
  Globe2,
  HeartPulse,
  Hexagon,
  Loader2,
  Lock,
  Send,
  Server,
  Settings,
  Shield,
  Square,
  Terminal,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { chatAPI, statsAPI, systemAPI, type RuntimeInstance } from '../services/api';
import { useRuntimeInstances } from '../hooks/useAPI';
import { chatStreamStore, type ChatMessage } from '../stores/chatStreamStore';
import {
  getBudgetStatus,
  loadBudgetSettings,
  saveBudgetSettings,
  type BudgetPeriodUnit,
  type BudgetSettings,
} from '../utils/budgetControl';
import './RuntimeGuardConsole.css';

type AgentName = 'OpenClaw' | 'Hermes' | 'Nanobot';
type RuntimePlatform = RuntimeInstance['platform'];
type ApprovalState = 'pending' | 'allowed' | 'denied';
type GuardMode = 'Off' | 'On';
type RuntimeGuardSession = {
  sessionKey: string;
  agent: AgentName;
  platform: RuntimePlatform;
  instanceId: string;
  displayName?: string;
  title: string;
  createdAt: string;
  status: 'ready' | 'error';
  autoTitlePending?: boolean;
};
type InstallMap = Record<AgentName, boolean | null>;
type AgentDisplay = {
  name: AgentName;
  status: 'Running' | 'Idle' | 'Not installed';
  className: string;
  installed: boolean;
};

const RUNTIME_GUARD_SESSIONS_KEY = 'xsafeclaw:runtime-guard:sessions';
const RUNTIME_GUARD_DRAFTS_KEY = 'xsafeclaw:runtime-guard:drafts';

const agentDefinitions: Array<{
  name: AgentName;
  platform: RuntimePlatform;
  defaultStatus: 'Running' | 'Idle';
  className: string;
}> = [
  { name: 'OpenClaw', platform: 'openclaw', defaultStatus: 'Running', className: 'agent-openclaw' },
  { name: 'Hermes', platform: 'hermes', defaultStatus: 'Idle', className: 'agent-hermes' },
  { name: 'Nanobot', platform: 'nanobot', defaultStatus: 'Idle', className: 'agent-nanobot' },
];

const tools = [
  { icon: Terminal, name: 'Shell', status: 'Allowed', tone: 'success' },
  { icon: FolderOpen, name: 'File System', status: 'Guarded', tone: 'warning' },
  { icon: Globe2, name: 'Browser', status: 'Allowed', tone: 'success' },
  { icon: Server, name: 'MCP Servers', status: '3 Active', tone: 'mcp' },
];

const guardRows = [
  ['Prompt Injection', 'Protected', 'success'],
  ['Data Leakage', 'Protected', 'success'],
  ['Command Exec', 'Protected', 'success'],
  ['File System', 'Guarded', 'warning'],
  ['Network Access', 'Guarded', 'warning'],
] as const;

const blockedRows = [
  ['14:31', 'Read ~/.ssh/id_rsa'],
  ['14:18', 'Upload .env file'],
] as const;

const traceTypes = new Set([
  'trace_start',
  'trace_step',
  'trace_status',
  'reasoning_summary',
  'approval_pending',
  'approval_resolved',
  'trace_end',
]);

function loadRuntimeGuardSessions(): RuntimeGuardSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RUNTIME_GUARD_SESSIONS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item: any): RuntimeGuardSession | null => {
        const sessionKey = typeof item?.sessionKey === 'string' ? item.sessionKey : '';
        const platform = item?.platform;
        const agent = item?.agent;
        if (!sessionKey || !['openclaw', 'hermes', 'nanobot'].includes(platform)) return null;
        if (!['OpenClaw', 'Hermes', 'Nanobot'].includes(agent)) return null;
        return {
          sessionKey,
          agent,
          platform,
          instanceId: typeof item?.instanceId === 'string' ? item.instanceId : '',
          displayName: typeof item?.displayName === 'string' ? item.displayName : undefined,
          title: typeof item?.title === 'string' && item.title.trim() ? item.title : agent,
          createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          status: item?.status === 'error' ? 'error' : 'ready',
          autoTitlePending: Boolean(item?.autoTitlePending),
        };
      })
      .filter((item): item is RuntimeGuardSession => item !== null);
  } catch {
    return [];
  }
}

function saveRuntimeGuardSessions(sessions: RuntimeGuardSession[]) {
  localStorage.setItem(RUNTIME_GUARD_SESSIONS_KEY, JSON.stringify(sessions));
}

function loadRuntimeGuardDrafts(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(RUNTIME_GUARD_DRAFTS_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string] => (
        typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )),
    );
  } catch {
    return {};
  }
}

function saveRuntimeGuardDrafts(drafts: Record<string, string>) {
  localStorage.setItem(RUNTIME_GUARD_DRAFTS_KEY, JSON.stringify(drafts));
}

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

function formatTime(value: Date) {
  return value.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatSessionStart(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Started just now';
  return `Started ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function titleFromUserMessage(input: string): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trimEnd()}...` : cleaned;
}

function extractMessageText(msg: any): string {
  if (!msg) return '';
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('');
  }
  if (typeof msg.text === 'string') return msg.text;
  return '';
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function agentToPlatform(agent: AgentName): RuntimePlatform {
  return agentDefinitions.find(item => item.name === agent)?.platform ?? 'openclaw';
}

function agentIcon(agent: AgentName) {
  if (agent === 'OpenClaw') return <Zap />;
  if (agent === 'Hermes') return <Bot />;
  return <Hexagon />;
}

function runtimeUnavailableMessage(instance: RuntimeInstance) {
  if (instance.platform === 'nanobot' && instance.health_status !== 'healthy') {
    return `${instance.display_name || 'Nanobot'} gateway offline.`;
  }
  if ((instance.platform === 'openclaw' || instance.platform === 'hermes') && instance.health_status === 'unreachable') {
    return `${instance.display_name || instance.platform} is unreachable.`;
  }
  return '';
}

function mapHistoryMessage(raw: any): ChatMessage | null {
  if (raw?.role === 'tool_call') {
    return {
      id: raw.id || uuidv4(),
      role: 'tool_call',
      content: '',
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
      tool_id: raw.tool_id,
      tool_name: raw.tool_name,
      args: raw.args,
      result: raw.result,
      is_error: raw.is_error,
      result_pending: raw.result_pending ?? false,
    };
  }

  if (raw?.role === 'user' || raw?.role === 'assistant' || raw?.role === 'error') {
    const text = typeof raw.content === 'string' ? raw.content : extractMessageText(raw);
    if (!text.trim()) return null;
    return {
      id: raw.id || uuidv4(),
      role: raw.role,
      content: text,
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
    };
  }

  if (raw?.role === 'trace') {
    const evt = raw.trace_event && typeof raw.trace_event === 'object' ? raw.trace_event : {};
    return {
      id: raw.id || uuidv4(),
      role: 'trace',
      content: typeof raw.content === 'string' ? raw.content : '',
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
      trace_type: typeof evt.type === 'string' ? evt.type : 'trace_step',
      trace_phase: typeof evt.phase === 'string' ? evt.phase : '',
      trace_step: typeof evt.step === 'number' ? evt.step : undefined,
      trace_summary: typeof evt.summary === 'string' ? evt.summary : '',
    };
  }

  return null;
}

function StatusDot({ tone }: { tone: 'success' | 'muted' | 'warning' | 'mcp' }) {
  return <span className={`rg-dot rg-dot-${tone}`} />;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatBudgetRefreshTime(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalMinutes = Math.ceil(clamped / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
}

function IconButton({
  className = '',
  title,
  children,
  onClick,
}: {
  className?: string;
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className={`rg-icon-button ${className}`} title={title} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function ApprovalCard({
  kind,
  risk,
  riskTone,
  content,
  time,
  state,
  onDecision,
}: {
  kind: string;
  risk: string;
  riskTone: 'high' | 'medium';
  content: string;
  time: string;
  state: ApprovalState;
  onDecision: (state: ApprovalState) => void;
}) {
  return (
    <div className={`rg-approval-item ${kind === 'File Upload' ? 'rg-approval-file' : 'rg-approval-shell'}`}>
      <div className="rg-approval-title">{kind}</div>
      <div className={`rg-risk-text rg-risk-${riskTone}`}>{state === 'pending' ? risk : state === 'allowed' ? 'Allowed' : 'Denied'}</div>
      <div className="rg-code-strip">
        <span>{content}</span>
      </div>
      <div className="rg-meta rg-meta-by">By: OpenClaw</div>
      <div className="rg-meta rg-meta-time">Time: {time}</div>
      <button className="rg-small-action rg-small-deny" onClick={() => onDecision('denied')} type="button">
        Deny
      </button>
      <button className="rg-small-action rg-small-allow" onClick={() => onDecision('allowed')} type="button">
        Allow
      </button>
    </div>
  );
}

function TimelineMessage({
  msg,
  expanded,
  onToggle,
}: {
  msg: ChatMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = formatTime(msg.timestamp);

  if (msg.role === 'tool_call') {
    const resultText = formatValue(msg.result);
    const argsText = formatValue(msg.args);
    const summary = argsText.replace(/\s+/g, ' ').slice(0, 100);
    return (
      <div className={`rg-stream-row rg-stream-tool ${msg.is_error ? 'is-error' : ''}`}>
        <span className="rg-stream-time">{time}</span>
        <Wrench className="rg-stream-icon" />
        <div className="rg-stream-body">
          <button className="rg-tool-toggle" type="button" onClick={onToggle}>
            <span className="rg-stream-title">{msg.tool_name || 'tool'}</span>
            {summary && <code>{summary}</code>}
            {msg.result_pending ? <Loader2 className="rg-stream-state is-spinning" /> : msg.is_error ? <AlertCircle className="rg-stream-state" /> : <CheckCircle2 className="rg-stream-state" />}
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
          {expanded && (
            <div className="rg-tool-detail">
              {argsText && (
                <>
                  <span>Arguments</span>
                  <pre>{argsText}</pre>
                </>
              )}
              {msg.result_pending ? (
                <div className="rg-tool-running"><Loader2 className="is-spinning" /> Running...</div>
              ) : resultText ? (
                <>
                  <span>{msg.is_error ? 'Error' : 'Result'}</span>
                  <pre>{resultText}</pre>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (msg.role === 'trace') {
    const label = [
      msg.trace_type || 'trace',
      typeof msg.trace_step === 'number' ? `#${msg.trace_step}` : '',
      msg.trace_phase || '',
    ].filter(Boolean).join(' · ');
    return (
      <div className="rg-stream-row rg-stream-trace">
        <span className="rg-stream-time">{time}</span>
        <Brain className="rg-stream-icon" />
        <div className="rg-stream-body">
          <span className="rg-stream-title">{label}</span>
          {msg.trace_summary && <p>{msg.trace_summary}</p>}
          {msg.content && <p>{msg.content}</p>}
        </div>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';
  return (
    <div className={`rg-stream-row ${isUser ? 'rg-stream-user' : isError ? 'rg-stream-error' : 'rg-stream-assistant'}`}>
      <span className="rg-stream-time">{time}</span>
      {isUser ? <User className="rg-stream-icon" /> : isError ? <AlertTriangle className="rg-stream-icon" /> : <Bot className="rg-stream-icon" />}
      <div className="rg-stream-body">
        <span className="rg-stream-title">{isUser ? 'You' : isError ? 'Runtime error' : 'Assistant'}</span>
        {msg.pending && !msg.content ? (
          <span className="rg-stream-pending"><i /><i /><i /></span>
        ) : (
          <p>{msg.content}</p>
        )}
      </div>
    </div>
  );
}

export default function RuntimeGuardConsole() {
  const navigate = useNavigate();
  const runtimeInstancesQuery = useRuntimeInstances();
  const subscribeToChatStore = useCallback((listener: () => void) => chatStreamStore.subscribe(listener), []);
  const messageMap = useSyncExternalStore(subscribeToChatStore, () => chatStreamStore.getSnapshot());
  const sendingMap = useSyncExternalStore(subscribeToChatStore, () => chatStreamStore.getSendingSnapshot());

  const [installedAgents, setInstalledAgents] = useState<InstallMap>({
    OpenClaw: null,
    Hermes: null,
    Nanobot: null,
  });
  const [installProbeFailed, setInstallProbeFailed] = useState(false);
  const [sessions, setSessions] = useState<RuntimeGuardSession[]>(() => loadRuntimeGuardSessions());
  const [activeSessionId, setActiveSessionId] = useState(() => loadRuntimeGuardSessions()[0]?.sessionKey ?? '');
  const [selectedAgent, setSelectedAgent] = useState<AgentName>('OpenClaw');
  const [draftBySessionKey, setDraftBySessionKey] = useState<Record<string, string>>(() => loadRuntimeGuardDrafts());
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [creatingAgent, setCreatingAgent] = useState<AgentName | null>(null);
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});
  const [isComposing, setIsComposing] = useState(false);
  const [shellApproval, setShellApproval] = useState<ApprovalState>('pending');
  const [fileApproval, setFileApproval] = useState<ApprovalState>('pending');
  const [placeholder, setPlaceholder] = useState('');
  const [guardMode, setGuardMode] = useState<GuardMode>('Off');
  const [autoApprovalOpen, setAutoApprovalOpen] = useState(false);
  const [budgetSettings, setBudgetSettings] = useState<BudgetSettings>(() => loadBudgetSettings());
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetAmountInput, setBudgetAmountInput] = useState('');
  const [budgetPeriodInput, setBudgetPeriodInput] = useState('');
  const [budgetPeriodUnit, setBudgetPeriodUnit] = useState<BudgetPeriodUnit>('hour');
  const [dashboardCost, setDashboardCost] = useState(3.21);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [layoutFit, setLayoutFit] = useState({
    scale: 1,
    height: 570,
    leftWidth: 156,
    rightWidth: 207,
    mainWidth: 491,
    mainDesignWidth: 491,
  });
  const taskScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inFlightKeysRef = useRef<Set<string>>(new Set());

  const setMessageMap = useCallback((
    updaterOrValue: Record<string, ChatMessage[]> | ((prev: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>),
  ) => {
    if (typeof updaterOrValue === 'function') {
      chatStreamStore.replaceAll(updaterOrValue(chatStreamStore.getSnapshot()));
    } else {
      chatStreamStore.replaceAll(updaterOrValue);
    }
  }, []);

  const activeSession = sessions.find(session => session.sessionKey === activeSessionId) ?? null;
  const activeAgent = activeSession?.agent ?? selectedAgent;
  const activeMessages = activeSession ? (messageMap[activeSession.sessionKey] ?? []) : [];
  const activeDraft = activeSession ? (draftBySessionKey[activeSession.sessionKey] ?? '') : '';
  const activeSending = activeSession ? (sendingMap[activeSession.sessionKey] ?? false) : false;
  const availableInstances = useMemo(
    () => (runtimeInstancesQuery.data?.instances ?? []).filter(instance => instance.enabled),
    [runtimeInstancesQuery.data?.instances],
  );

  useEffect(() => {
    const updateLayoutFit = () => {
      const scale = window.innerHeight / 570;
      const leftWidth = 156 * scale;
      const rightWidth = 207 * scale;
      const mainWidth = Math.max(window.innerWidth - leftWidth - rightWidth, 280 * scale);

      setLayoutFit({
        scale,
        height: window.innerHeight,
        leftWidth,
        rightWidth,
        mainWidth,
        mainDesignWidth: mainWidth / scale,
      });
    };

    updateLayoutFit();
    window.addEventListener('resize', updateLayoutFit);
    return () => window.removeEventListener('resize', updateLayoutFit);
  }, []);

  useEffect(() => {
    saveRuntimeGuardSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    saveRuntimeGuardDrafts(draftBySessionKey);
  }, [draftBySessionKey]);

  useEffect(() => {
    if (activeSessionId && sessions.some(session => session.sessionKey === activeSessionId)) return;
    const nextActive = sessions[0] ?? null;
    setActiveSessionId(nextActive?.sessionKey ?? '');
    if (nextActive) setSelectedAgent(nextActive.agent);
  }, [activeSessionId, sessions]);

  useEffect(() => {
    let cancelled = false;

    systemAPI.installStatus()
      .then((res) => {
        if (cancelled) return;
        setInstalledAgents({
          OpenClaw: Boolean(res.data.openclaw_installed),
          Hermes: Boolean(res.data.hermes_installed),
          Nanobot: Boolean(res.data.nanobot_installed),
        });
        setInstallProbeFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInstallProbeFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pullDashboardCost = async () => {
      try {
        const { data } = await statsAPI.dashboard();
        const nextCost = Number(data?.cost);
        if (!cancelled && Number.isFinite(nextCost) && nextCost >= 0) {
          setDashboardCost(nextCost);
        }
      } catch {
        // Keep the visual fallback when stats are temporarily unavailable.
      }
    };

    pullDashboardCost();
    const timer = window.setInterval(pullDashboardCost, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    taskScrollRef.current?.scrollTo({ top: taskScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeSession?.sessionKey, activeMessages.length]);

  useEffect(() => {
    if (!activeSession) return;
    window.setTimeout(() => textareaRef.current?.focus(), 80);
  }, [activeSession?.sessionKey]);

  const loadHistory = useCallback(async (sessionKey: string, force = false) => {
    if (!force && chatStreamStore.hasLoadedMessages(sessionKey)) return;
    setLoadingHistory(sessionKey);
    try {
      const res = await chatAPI.getHistory(sessionKey);
      const loaded = (res.data.messages ?? [])
        .map(mapHistoryMessage)
        .filter((message): message is ChatMessage => message !== null);
      setMessageMap(prev => ({ ...prev, [sessionKey]: loaded }));
    } catch {
      setMessageMap(prev => ({ ...prev, [sessionKey]: [] }));
    } finally {
      setLoadingHistory(current => (current === sessionKey ? null : current));
    }
  }, [setMessageMap]);

  useEffect(() => {
    if (activeSession?.sessionKey) {
      loadHistory(activeSession.sessionKey);
    }
  }, [activeSession?.sessionKey, loadHistory]);

  const approvalCount = useMemo(
    () => [shellApproval, fileApproval].filter(state => state === 'pending').length,
    [shellApproval, fileApproval],
  );
  const agents: AgentDisplay[] = useMemo(
    () => agentDefinitions.map(agent => {
      const installed = installedAgents[agent.name];
      const probeUnknown = installed === null || installProbeFailed;
      return {
        name: agent.name,
        className: agent.className,
        installed: probeUnknown ? true : installed,
        status: probeUnknown ? agent.defaultStatus : installed ? agent.defaultStatus : 'Not installed',
      };
    }),
    [installProbeFailed, installedAgents],
  );
  const budgetStatus = useMemo(
    () => getBudgetStatus(budgetSettings, dashboardCost, nowTs),
    [budgetSettings, dashboardCost, nowTs],
  );
  const {
    budgetLimit,
    budgetUsed,
    budgetPercent,
    budgetOverLimit,
    budgetRemainingMs,
  } = budgetStatus;
  const budgetConfigured = Boolean(budgetLimit);
  const budgetDisplayCost = budgetConfigured ? budgetUsed : dashboardCost;
  const budgetBarPercent = budgetConfigured ? Math.max(4, budgetPercent) : 0;
  const budgetResetText = budgetConfigured
    ? `额度将在${formatBudgetRefreshTime(budgetRemainingMs)}后刷新`
    : '24h total cost';

  useEffect(() => {
    if (!budgetStatus.settingsRolled) return;
    setBudgetSettings(budgetStatus.settings);
    saveBudgetSettings(budgetStatus.settings);
  }, [budgetStatus]);

  const showToast = useCallback((message: string, timeout = 2600) => {
    setPlaceholder(message);
    window.setTimeout(() => setPlaceholder(''), timeout);
  }, []);

  const showPlaceholder = () => {
    showToast('This panel is still presentation-only.');
  };

  const showInstallHint = (agent: AgentName) => {
    showToast(`${agent} is not installed. Open Setup to install it.`);
  };

  const openBudgetModal = () => {
    setBudgetAmountInput(budgetLimit ? String(budgetLimit) : '');
    setBudgetPeriodInput(budgetLimit && budgetSettings.periodValue ? String(budgetSettings.periodValue) : '');
    setBudgetPeriodUnit(budgetSettings.periodUnit === 'day' ? 'day' : 'hour');
    setBudgetModalOpen(true);
  };

  const saveBudgetLimit = () => {
    const maxCost = Number(budgetAmountInput);
    const periodValue = Number(budgetPeriodInput);
    if (!Number.isFinite(maxCost) || maxCost <= 0 || !Number.isFinite(periodValue) || periodValue <= 0) return;

    const now = Date.now();
    const next: BudgetSettings = {
      maxCost,
      periodValue,
      periodUnit: budgetPeriodUnit,
      periodStartAt: now,
      baselineCost: dashboardCost,
      updatedAt: now,
    };
    setBudgetSettings(next);
    setNowTs(now);
    saveBudgetSettings(next);
    setBudgetModalOpen(false);
  };

  const clearBudgetLimit = () => {
    const now = Date.now();
    const next: BudgetSettings = {
      maxCost: null,
      periodValue: budgetSettings.periodValue || 24,
      periodUnit: budgetSettings.periodUnit || 'hour',
      periodStartAt: now,
      baselineCost: dashboardCost,
      updatedAt: now,
    };
    setBudgetSettings(next);
    setNowTs(now);
    saveBudgetSettings(next);
    setBudgetAmountInput('');
    setBudgetPeriodInput('');
    setBudgetModalOpen(false);
  };

  const findRuntimeForAgent = useCallback((agent: AgentName): RuntimeInstance | null => {
    const platform = agentToPlatform(agent);
    return availableInstances.find(instance => instance.platform === platform && instance.is_default)
      ?? availableInstances.find(instance => instance.platform === platform)
      ?? null;
  }, [availableInstances]);

  const openSession = useCallback(async (agent: AgentName, installed = true) => {
    if (creatingAgent) return;
    if (!installed) {
      showInstallHint(agent);
      return;
    }
    if (runtimeInstancesQuery.isLoading) {
      showToast('Runtime instances are still loading.');
      return;
    }

    const runtime = findRuntimeForAgent(agent);
    if (!runtime) {
      showToast(`No enabled ${agent} runtime found. Open Setup to configure it.`);
      return;
    }

    const unavailable = runtimeUnavailableMessage(runtime);
    if (unavailable) {
      showToast(unavailable);
      return;
    }

    setCreatingAgent(agent);
    setSelectedAgent(agent);
    try {
      const sameAgentCount = sessions.filter(session => session.agent === agent).length + 1;
      const label = sameAgentCount === 1 ? agent : `${agent} ${sameAgentCount}`;
      const res = await chatAPI.startSession({ instance_id: runtime.instance_id, label });
      const session: RuntimeGuardSession = {
        sessionKey: res.data.session_key,
        agent,
        platform: res.data.platform as RuntimePlatform,
        instanceId: res.data.instance_id,
        displayName: res.data.instance?.display_name || runtime.display_name,
        title: label,
        createdAt: new Date().toISOString(),
        status: 'ready',
        autoTitlePending: true,
      };

      setSessions(current => [session, ...current]);
      setMessageMap(prev => ({ ...prev, [session.sessionKey]: [] }));
      setDraftBySessionKey(current => ({ ...current, [session.sessionKey]: current[session.sessionKey] ?? '' }));
      setActiveSessionId(session.sessionKey);
    } catch (err: any) {
      const detail = String(err?.response?.data?.detail || err?.message || 'Failed to create session.');
      showToast(detail);
    } finally {
      setCreatingAgent(null);
    }
  }, [
    creatingAgent,
    findRuntimeForAgent,
    runtimeInstancesQuery.isLoading,
    sessions,
    setMessageMap,
    showToast,
  ]);

  const openSelectedAgentSession = () => {
    openSession(selectedAgent, agents.find(agent => agent.name === selectedAgent)?.installed ?? true);
  };

  const closeSession = (sessionKey: string) => {
    setSessions(current => {
      const closingIndex = current.findIndex(session => session.sessionKey === sessionKey);
      const next = current.filter(session => session.sessionKey !== sessionKey);
      if (sessionKey === activeSessionId) {
        const nextActive = next[Math.max(0, closingIndex - 1)] ?? next[0] ?? null;
        setActiveSessionId(nextActive?.sessionKey ?? '');
        if (nextActive) setSelectedAgent(nextActive.agent);
      }
      return next;
    });
    setDraftBySessionKey(current => {
      const next = { ...current };
      delete next[sessionKey];
      return next;
    });
    chatStreamStore.deleteMessages(sessionKey);
  };

  const updateActiveDraft = (value: string) => {
    if (!activeSession) return;
    setDraftBySessionKey(current => ({ ...current, [activeSession.sessionKey]: value }));
  };

  const renameSessionKey = useCallback((previousKey: string, nextKey: string) => {
    if (previousKey === nextKey) return;
    chatStreamStore.renameSession(previousKey, nextKey);
    setSessions(current => current.map(session => (
      session.sessionKey === previousKey ? { ...session, sessionKey: nextKey } : session
    )));
    setDraftBySessionKey(current => {
      const next = { ...current, [nextKey]: current[previousKey] ?? '' };
      delete next[previousKey];
      return next;
    });
    setActiveSessionId(current => (current === previousKey ? nextKey : current));
  }, []);

  const applyAutoSessionTitle = useCallback((sessionKey: string, text: string) => {
    const title = titleFromUserMessage(text);
    if (!title) return;
    setSessions(current => current.map(session => (
      session.sessionKey === sessionKey && session.autoTitlePending
        ? { ...session, title, autoTitlePending: false }
        : session
    )));
  }, []);

  const handleSend = async () => {
    if (!activeSession) return;
    const originalKey = activeSession.sessionKey;
    const text = activeDraft.trim();
    if (!text || activeSending || inFlightKeysRef.current.has(originalKey)) return;

    if (budgetOverLimit) {
      showToast(`已达到最大用量，额度将在${formatBudgetRefreshTime(budgetRemainingMs)}后刷新`);
      return;
    }

    let key = originalKey;
    inFlightKeysRef.current.add(key);
    chatStreamStore.setSending(key, true);
    setDraftBySessionKey(current => ({ ...current, [key]: '' }));
    applyAutoSessionTitle(key, text);

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    const pendingId = uuidv4();
    const pendingMsg: ChatMessage = {
      id: pendingId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      pending: true,
    };
    setMessageMap(prev => ({ ...prev, [key]: [...(prev[key] ?? []), userMsg, pendingMsg] }));

    try {
      const response = await fetch('/api/chat/send-message-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_key: key, message: text }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await responseErrorMessage(response));
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
              type: string;
              text?: string;
              session_key?: string;
              tool_id?: string;
              tool_name?: string;
              args?: any;
              result?: any;
              is_error?: boolean;
              reason?: string;
              phase?: string;
              step?: number;
              summary?: string;
            };

            const appendBeforeAssistant = (message: ChatMessage) => {
              setMessageMap(prev => {
                const messages = [...(prev[key] ?? [])];
                const assistantIndex = messages.findIndex(item => item.id === pendingId);
                messages.splice(assistantIndex >= 0 ? assistantIndex : messages.length, 0, message);
                return { ...prev, [key]: messages };
              });
            };

            if (chunk.type === 'session_relinked' && chunk.session_key && chunk.session_key !== key) {
              const previousKey = key;
              key = chunk.session_key;
              inFlightKeysRef.current.delete(previousKey);
              inFlightKeysRef.current.add(key);
              renameSessionKey(previousKey, key);
            } else if (chunk.type === 'delta' && chunk.text) {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => (
                  message.id === pendingId
                    ? { ...message, content: chunk.text!, pending: false }
                    : message
                )),
              }));
            } else if (chunk.type === 'tool_start') {
              appendBeforeAssistant({
                id: `tool-${chunk.tool_id || uuidv4()}`,
                role: 'tool_call',
                content: '',
                timestamp: new Date(),
                tool_id: chunk.tool_id,
                tool_name: chunk.tool_name,
                args: chunk.args,
                result_pending: true,
              });
            } else if (chunk.type === 'tool_result') {
              setMessageMap(prev => {
                const messages = [...(prev[key] ?? [])];
                let updated = false;
                if (chunk.tool_id) {
                  for (let i = messages.length - 1; i >= 0; i -= 1) {
                    const message = messages[i];
                    if (message.role === 'tool_call' && message.tool_id === chunk.tool_id) {
                      messages[i] = { ...message, result: chunk.result, is_error: chunk.is_error, result_pending: false };
                      updated = true;
                      break;
                    }
                  }
                }
                if (!updated && chunk.tool_name) {
                  for (let i = messages.length - 1; i >= 0; i -= 1) {
                    const message = messages[i];
                    if (message.role === 'tool_call' && message.tool_name === chunk.tool_name && message.result_pending) {
                      messages[i] = { ...message, result: chunk.result, is_error: chunk.is_error, result_pending: false };
                      break;
                    }
                  }
                }
                return { ...prev, [key]: messages };
              });
            } else if (chunk.type === 'status') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => (
                  message.id === pendingId && message.pending && !message.content
                    ? { ...message, content: chunk.text || message.content, pending: false }
                    : message
                )),
              }));
            } else if (traceTypes.has(chunk.type)) {
              appendBeforeAssistant({
                id: `trace-${uuidv4()}`,
                role: 'trace',
                content: chunk.text || '',
                timestamp: new Date(),
                trace_type: chunk.type,
                trace_phase: chunk.phase || '',
                trace_step: typeof chunk.step === 'number' ? chunk.step : undefined,
                trace_summary: chunk.summary || '',
              });
            } else if (chunk.type === 'tool_blocked') {
              const toolName = chunk.tool_name || 'tool';
              const reason = chunk.reason || '';
              const blockedText = chunk.text || `安全审核拦截\n\n工具 ${toolName} 的调用已被安全系统拒绝。${reason ? `\n原因：${reason}` : ''}`;
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => {
                  if (message.id === pendingId) {
                    return { ...message, role: 'error' as const, content: blockedText, pending: false };
                  }
                  if (message.role === 'tool_call' && message.result_pending && chunk.tool_name && message.tool_name === chunk.tool_name) {
                    return { ...message, result: reason || blockedText, is_error: true, result_pending: false };
                  }
                  return message;
                }),
              }));
            } else if (chunk.type === 'final') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => (
                  message.id === pendingId
                    ? { ...message, content: chunk.text || message.content || '[No response]', pending: false }
                    : message
                )),
              }));
            } else if (chunk.type === 'error' || chunk.type === 'timeout' || chunk.type === 'aborted') {
              setMessageMap(prev => ({
                ...prev,
                [key]: (prev[key] ?? []).map(message => (
                  message.id === pendingId
                    ? {
                        ...message,
                        role: chunk.type === 'error' ? 'error' as const : 'assistant' as const,
                        content: chunk.text || `[${chunk.type}]`,
                        pending: false,
                      }
                    : message
                )),
              }));
            }
          } catch {
            // Ignore malformed SSE data.
          }
        }
      }

      setMessageMap(prev => ({
        ...prev,
        [key]: (prev[key] ?? []).map(message => (
          message.id === pendingId && message.pending
            ? { ...message, content: message.content || '[No response]', pending: false }
            : message
        )),
      }));
    } catch (err: any) {
      setMessageMap(prev => ({
        ...prev,
        [key]: (prev[key] ?? []).map(message => (
          message.id === pendingId
            ? { ...message, role: 'error' as const, content: `[Error] ${err.message}`, pending: false }
            : message
        )),
      }));
    } finally {
      chatStreamStore.setSending(key, false);
      inFlightKeysRef.current.delete(key);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
    event.preventDefault();
    handleSend();
  };

  const toggleToolExpanded = (id: string) => {
    setExpandedToolIds(current => ({ ...current, [id]: !current[id] }));
  };

  const leftScaleStyle = {
    width: layoutFit.leftWidth,
    height: layoutFit.height,
    '--rg-scale': layoutFit.scale,
  } as CSSProperties;
  const mainFluidStyle = {
    left: layoutFit.leftWidth,
    width: layoutFit.mainWidth,
    height: layoutFit.height,
    '--rg-scale': layoutFit.scale,
    '--rg-main-design-width': `${layoutFit.mainDesignWidth}px`,
  } as CSSProperties;
  const rightScaleStyle = {
    left: layoutFit.leftWidth + layoutFit.mainWidth,
    width: layoutFit.rightWidth,
    height: layoutFit.height,
    '--rg-scale': layoutFit.scale,
  } as CSSProperties;

  return (
    <div className="runtime-guard-page">
      {placeholder && <div className="rg-toast">{placeholder}</div>}
      {budgetModalOpen && (
        <div className="rg-modal-backdrop" role="presentation">
          <div className="rg-budget-modal" role="dialog" aria-modal="true" aria-labelledby="rg-budget-modal-title">
            <button className="rg-modal-close" type="button" title="Close budget settings" onClick={() => setBudgetModalOpen(false)}>
              <X />
            </button>
            <div className="rg-budget-modal-kicker">BUDGET LIMIT</div>
            <h2 id="rg-budget-modal-title">Set runtime budget</h2>
            <p>Set a spending limit for this browser session. Leave either field blank to only show the 24h total cost.</p>
            <div className="rg-budget-sentence">
              <input
                aria-label="Maximum USD usage"
                inputMode="decimal"
                min="0"
                onChange={(event) => setBudgetAmountInput(event.target.value)}
                placeholder="__"
                step="0.01"
                type="number"
                value={budgetAmountInput}
              />
              <span>USD</span>
              <input
                aria-label="Budget refresh interval"
                inputMode="numeric"
                min="1"
                onChange={(event) => setBudgetPeriodInput(event.target.value)}
                placeholder="__"
                step="1"
                type="number"
                value={budgetPeriodInput}
              />
              <select
                aria-label="Budget interval unit"
                onChange={(event) => setBudgetPeriodUnit(event.target.value as BudgetPeriodUnit)}
                value={budgetPeriodUnit}
              >
                <option value="hour">小时</option>
                <option value="day">天</option>
              </select>
            </div>
            <div className="rg-budget-modal-preview">
              Current cost: {formatMoney(dashboardCost)}
            </div>
            <div className="rg-budget-modal-actions">
              <button type="button" className="rg-budget-clear" onClick={clearBudgetLimit}>Clear</button>
              <button
                type="button"
                className="rg-budget-save"
                disabled={
                  !Number.isFinite(Number(budgetAmountInput))
                  || Number(budgetAmountInput) <= 0
                  || !Number.isFinite(Number(budgetPeriodInput))
                  || Number(budgetPeriodInput) <= 0
                }
                onClick={saveBudgetLimit}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="rg-left-scale" style={leftScaleStyle}>
      <aside className="rg-sidebar">
        <div className="rg-window-dots">
          <span className="rg-window-dot rg-red" />
          <span className="rg-window-dot rg-yellow" />
          <span className="rg-window-dot rg-green" />
        </div>

        <div className="rg-brand">
          <span className="rg-brand-name">XSafeClaw</span>
          <span className="rg-pro">PRO</span>
          <span className="rg-subtitle">AI Runtime Guard</span>
        </div>

        <button className="rg-new-task" onClick={openSelectedAgentSession} type="button" disabled={Boolean(creatingAgent)}>
          <span>+</span>
          <span>New Task</span>
          <span className="rg-shortcut">Cmd N</span>
        </button>

        <section className="rg-agents">
          <div className="rg-section-title">
            <span>AGENTS</span>
            <button type="button" title="Go to setup" onClick={() => navigate('/setup')}>+</button>
          </div>
          {agents.map((agent, index) => (
            <div
              className={`rg-agent-row ${selectedAgent === agent.name ? 'is-selected' : ''} ${!agent.installed ? 'is-uninstalled' : ''}`}
              key={agent.name}
              aria-disabled={!agent.installed}
              title={agent.installed ? `${agent.name} runtime` : `${agent.name} is not installed`}
              onClick={() => {
                if (!agent.installed) {
                  showInstallHint(agent.name);
                  return;
                }
                setSelectedAgent(agent.name);
              }}
              style={{ top: 18 + index * 36 }}
            >
              <span className={`rg-agent-mark ${agent.className}`}>{agentIcon(agent.name)}</span>
              <span className="rg-agent-copy">
                <span className="rg-agent-name">{agent.name}</span>
                <span className="rg-agent-state">
                  <StatusDot tone={agent.status === 'Running' ? 'success' : agent.installed ? 'muted' : 'warning'} />
                  {agent.status}
                </span>
              </span>
              <button
                className="rg-open-agent"
                disabled={creatingAgent === agent.name}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!agent.installed) {
                    showInstallHint(agent.name);
                    navigate('/setup');
                    return;
                  }
                  openSession(agent.name, agent.installed);
                }}
                type="button"
              >
                {agent.installed ? creatingAgent === agent.name ? '...' : 'Open' : 'Setup'} <ChevronRight />
              </button>
            </div>
          ))}
        </section>

        <section className="rg-tools">
          <div className="rg-tools-title">TOOLS</div>
          {tools.map((tool, index) => {
            const ToolIcon = tool.icon;
            return (
              <div className="rg-tool-row" key={tool.name} style={{ top: 20 + index * 23 }}>
                <ToolIcon />
                <span>{tool.name}</span>
                <span className={`rg-tool-${tool.tone}`}>{tool.status}</span>
              </div>
            );
          })}
        </section>

        <button className={`rg-budget ${budgetOverLimit ? 'is-over-limit' : ''}`} onClick={openBudgetModal} type="button">
          <div className="rg-budget-title">BUDGET</div>
          <div className="rg-budget-amount">{formatMoney(budgetDisplayCost)}</div>
          {budgetConfigured && <div className="rg-budget-total">/ {formatMoney(budgetLimit ?? 0)}</div>}
          <div className="rg-budget-bar"><span style={{ width: `${budgetBarPercent}%` }} /></div>
          <div className="rg-budget-percent">{budgetConfigured ? `${Math.round(budgetPercent)}%` : ''}</div>
          <div className="rg-budget-reset">{budgetOverLimit ? '已达到最大用量' : budgetResetText}</div>
        </button>

        <section className="rg-user">
          <span className="rg-avatar"><User /></span>
          <span>XClaw User</span>
          <ChevronDown />
        </section>

        <div className="rg-bottom-icons">
          <button type="button" title="Settings"><Settings /></button>
          <button type="button" title="Notifications"><Bell /></button>
        </div>
      </aside>
      </div>

      <div className="rg-main-fluid" style={mainFluidStyle}>
      <main className="rg-main">
        <div className="rg-tabs">
          <div className="rg-session-tabs">
            {sessions.map(session => (
              <button
                className={`rg-chat-tab ${session.sessionKey === activeSessionId ? 'is-active' : ''}`}
                key={session.sessionKey}
                onClick={() => {
                  setActiveSessionId(session.sessionKey);
                  setSelectedAgent(session.agent);
                }}
                type="button"
              >
                <span className="rg-chat-tab-agent">
                  {agentIcon(session.agent)}
                </span>
                <span className="rg-chat-tab-title">{session.title}</span>
                <span
                  className="rg-chat-tab-close"
                  role="button"
                  tabIndex={0}
                  title="Close session"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeSession(session.sessionKey);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      closeSession(session.sessionKey);
                    }
                  }}
                >
                  <X />
                </span>
              </button>
            ))}
            <button className="rg-tab-add" type="button" onClick={openSelectedAgentSession} disabled={Boolean(creatingAgent)}>+</button>
          </div>
        </div>

        <section className="rg-task-title">
          <h1>{activeSession ? activeSession.title : '暂无会话内容'}</h1>
          <p>
            {activeSession
              ? `${formatSessionStart(activeSession.createdAt)}  -  ${activeSession.displayName || activeSession.agent}  -  ${activeSession.platform}  -  ${activeSession.instanceId || 'runtime'}`
              : '使用 New Task、+ 或 Agent Open 创建真实会话'}
          </p>
        </section>

        <section className="rg-run-buttons">
          <div className="rg-auto-approval">
            <button
              aria-expanded={autoApprovalOpen}
              aria-haspopup="listbox"
              className="rg-auto-approval-trigger"
              onClick={() => setAutoApprovalOpen(open => !open)}
              type="button"
            >
              <Lock /> Guard: {guardMode} <ChevronDown />
            </button>
            {autoApprovalOpen && (
              <div className="rg-auto-approval-menu" role="listbox" aria-label="Guard mode">
                {(['Off', 'On'] as const).map(mode => (
                  <button
                    className={mode === guardMode ? 'is-selected' : ''}
                    key={mode}
                    onClick={() => {
                      setGuardMode(mode);
                      setAutoApprovalOpen(false);
                    }}
                    role="option"
                    aria-selected={mode === guardMode}
                    type="button"
                  >
                    <span>{mode}</span>
                    {mode === guardMode && <Check />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="rg-sandbox"><Box /> Sandbox: On</button>
        </section>

        <section className="rg-task-panel">
          {!activeSession ? (
            <div className="rg-empty-task">
              <strong>暂无会话内容</strong>
              <span>点击 New Task、+ 或 Agent Open 创建真实会话。</span>
            </div>
          ) : (
            <>
              <div className="rg-task-scroll" ref={taskScrollRef}>
                {loadingHistory === activeSession.sessionKey ? (
                  <div className="rg-loading-history"><Loader2 className="is-spinning" /> Loading history...</div>
                ) : activeMessages.length === 0 ? (
                  <div className="rg-session-empty">
                    <Bot />
                    <strong>{activeSession.agent} session ready</strong>
                    <span>发送第一条消息后，assistant、tool 和 trace 事件会显示在这里。</span>
                  </div>
                ) : (
                  activeMessages.map(message => (
                    <TimelineMessage
                      key={message.id}
                      msg={message}
                      expanded={Boolean(expandedToolIds[message.id])}
                      onToggle={() => toggleToolExpanded(message.id)}
                    />
                  ))
                )}
              </div>

              <div className={`rg-command-input ${budgetOverLimit ? 'is-budget-blocked' : ''}`}>
                <textarea
                  ref={textareaRef}
                  aria-label={`Ask ${activeAgent}`}
                  disabled={budgetOverLimit || activeSending}
                  onChange={(event) => updateActiveDraft(event.target.value)}
                  onCompositionEnd={() => setIsComposing(false)}
                  onCompositionStart={() => setIsComposing(true)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={budgetOverLimit ? '已达到最大用量' : `Ask ${activeAgent} ...`}
                  rows={2}
                  value={activeDraft}
                />
                <span className="rg-command-shortcuts">
                  {budgetOverLimit
                    ? `额度将在${formatBudgetRefreshTime(budgetRemainingMs)}后刷新`
                    : 'Enter Send    Shift Enter New Line'}
                </span>
                <button
                  disabled={budgetOverLimit || activeSending || !activeDraft.trim()}
                  onClick={handleSend}
                  type="button"
                  title={budgetOverLimit ? '已达到最大用量' : 'Send message'}
                >
                  {activeSending ? <Loader2 className="is-spinning" /> : <Send />}
                </button>
              </div>
            </>
          )}
        </section>

        <footer className="rg-statusbar">
          <StatusDot tone="success" />
          <span className="rg-status-active">Runtime Guard Active</span>
          <span>Events: {activeMessages.length}</span>
          <span>Blocked: {activeMessages.filter(message => message.role === 'error').length}</span>
          <span>Warnings: {activeMessages.filter(message => message.role === 'trace' && message.trace_type?.includes('approval')).length}</span>
        </footer>

        <div className="rg-version">
          <span>v1.0.0</span>
          <Shield />
        </div>
      </main>
      </div>
      <div className="rg-right-scale" style={rightScaleStyle}>
        <div className="rg-right-top-actions">
          <IconButton className="rg-top-icon-one" title="Single layout"><Square /></IconButton>
          <IconButton className="rg-top-icon-two" title="Split layout"><Columns2 /></IconButton>
          <IconButton className="rg-heartbeat" title="Heartbeat monitor"><HeartPulse /></IconButton>
        </div>
        <aside className="rg-right-panel">
          <section className="rg-approval-center">
            <div className="rg-card-head rg-approval-head">
              <span>APPROVAL CENTER</span>
              <span className="rg-count">{approvalCount}</span>
              <button type="button" onClick={showPlaceholder}>View All</button>
            </div>
            <ApprovalCard
              kind="Shell Command"
              risk="High Risk"
              riskTone="high"
              content="rm -rf ./dist/temp/*"
              time="14:32:20"
              state={shellApproval}
              onDecision={setShellApproval}
            />
            <ApprovalCard
              kind="File Upload"
              risk="Medium Risk"
              riskTone="medium"
              content="competitors_report.pdf (2.4MB)"
              time="14:31:02"
              state={fileApproval}
              onDecision={setFileApproval}
            />
          </section>

          <section className="rg-guard-status">
            <div className="rg-card-head">
              <span>GUARD STATUS</span>
              <span className="rg-secure"><Check /> Secure</span>
            </div>
            <div className="rg-score-ring">
              <strong>98</strong>
              <span>/100</span>
            </div>
            <div className="rg-guard-list">
              {guardRows.map(([label, status, tone]) => (
                <div className="rg-guard-row" key={label}>
                  <StatusDot tone={tone} />
                  <span>{label}</span>
                  <strong className={`rg-tool-${tone}`}>{status}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rg-recent-blocked">
            <div className="rg-card-head rg-recent-head">
              <span>RECENT BLOCKED</span>
              <button type="button" onClick={showPlaceholder}>View All</button>
            </div>
            {blockedRows.map(([time, text], index) => (
              <div className="rg-block-row" key={time} style={{ top: 28 + index * 16 }}>
                <span>{time}</span>
                <strong>Blocked</strong>
                <span>{text}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
