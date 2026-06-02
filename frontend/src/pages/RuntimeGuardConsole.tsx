import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  Bot,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileText,
  FolderOpen,
  Globe2,
  HeartPulse,
  Hexagon,
  Lock,
  PenLine,
  Play,
  Plus,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  Square,
  Terminal,
  User,
  X,
  Zap,
} from 'lucide-react';
import { statsAPI, systemAPI } from '../services/api';
import {
  getBudgetStatus,
  loadBudgetSettings,
  saveBudgetSettings,
  type BudgetPeriodUnit,
  type BudgetSettings,
} from '../utils/budgetControl';
import './RuntimeGuardConsole.css';

type AgentName = 'OpenClaw' | 'Hermes' | 'Nanobot';
type ApprovalState = 'pending' | 'allowed' | 'denied';
type GuardMode = 'Off' | 'On';
type ChatSession = {
  id: string;
  agent: AgentName;
  title: string;
};
type InstallMap = Record<AgentName, boolean | null>;
type AgentDisplay = {
  name: AgentName;
  status: 'Running' | 'Idle' | 'Not installed';
  className: string;
  installed: boolean;
};

const agentDefinitions: Array<{ name: AgentName; defaultStatus: 'Running' | 'Idle'; className: string }> = [
  { name: 'OpenClaw', defaultStatus: 'Running', className: 'agent-openclaw' },
  { name: 'Hermes', defaultStatus: 'Idle', className: 'agent-hermes' },
  { name: 'Nanobot', defaultStatus: 'Idle', className: 'agent-nanobot' },
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

const logRows = [
  { y: 10, time: '14:32:10', icon: Search, text: 'Thinking...', iconTone: 'rose' },
  { y: 32, time: '14:32:12', icon: FileText, text: 'Read', path: 'src/controllers/auth.ts', delta: '+128 lines' },
  { y: 54, time: '14:32:15', icon: PenLine, text: 'Edit', path: 'src/utils/jwt.ts', delta: '+23 -6', deltaTone: 'mixed' },
  { y: 76, time: '14:32:18', icon: FolderOpen, text: 'Read', path: 'src/middleware/ratelimit.ts', delta: '+85 lines' },
  { y: 215, time: '14:33:21', icon: Zap, text: 'Waiting for approval...', textTone: 'warning' },
  { y: 237, time: '14:33:45', icon: CheckCircle2, text: 'Approved by you', badge: 'Allow Once', textTone: 'success' },
  { y: 259, time: '14:33:45', icon: Play, text: 'Execute', code: 'rm -rf ./tmp/cache/*' },
  { y: 281, time: '14:33:45', icon: CheckCircle2, text: 'Command executed', code: '(0.21s)', textTone: 'success' },
  { y: 303, time: '14:33:47', icon: Hexagon, text: 'MCP', badge: 'github.com', code: 'list_issues (7 results)', iconTone: 'mcp' },
  { y: 325, time: '14:33:49', icon: Hexagon, text: 'MCP', badge: 'context7.com', code: 'get_docs (6k)', iconTone: 'mcp' },
  { y: 347, time: '14:33:53', icon: Bot, text: 'Analyzing results...' },
  { y: 369, time: '14:33:58', icon: PenLine, text: 'Edit', path: 'src/middleware/ratelimit.ts', delta: '+34 -2', deltaTone: 'mixed' },
];

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

export default function RuntimeGuardConsole() {
  const navigate = useNavigate();
  const [installedAgents, setInstalledAgents] = useState<InstallMap>({
    OpenClaw: null,
    Hermes: null,
    Nanobot: null,
  });
  const [installProbeFailed, setInstallProbeFailed] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: 'session-openclaw-1', agent: 'OpenClaw', title: 'OpenClaw' },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('session-openclaw-1');
  const [selectedAgent, setSelectedAgent] = useState<AgentName>('OpenClaw');
  const [shellApproval, setShellApproval] = useState<ApprovalState>('pending');
  const [fileApproval, setFileApproval] = useState<ApprovalState>('pending');
  const [commandApproved, setCommandApproved] = useState(false);
  const [emptyTask, setEmptyTask] = useState(false);
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
        // RuntimeGuard is still a frontend mock; keep the visual fallback.
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
  const activeSession = sessions.find(session => session.id === activeSessionId) ?? sessions[0] ?? null;
  const activeAgent = activeSession?.agent ?? selectedAgent;
  const preApprovalLogRows = logRows.filter(row => row.y < 100);
  const postApprovalLogRows = logRows.filter(row => row.y >= 100);
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

  const showPlaceholder = () => {
    setPlaceholder('This is a frontend-only placeholder.');
    window.setTimeout(() => setPlaceholder(''), 2200);
  };

  const showInstallHint = (agent: AgentName) => {
    setPlaceholder(`${agent} is not installed. Open Setup to install it.`);
    window.setTimeout(() => setPlaceholder(''), 2600);
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

  const openSession = (agent: AgentName, installed = true) => {
    if (!installed) {
      showInstallHint(agent);
      return;
    }

    setSelectedAgent(agent);
    const sameAgentCount = sessions.filter(session => session.agent === agent).length + 1;
    const id = `${agent.toLowerCase()}-${Date.now()}-${sameAgentCount}`;
    const session: ChatSession = {
      id,
      agent,
      title: sameAgentCount === 1 ? agent : `${agent} ${sameAgentCount}`,
    };

    setSessions(current => [...current, session]);
    setActiveSessionId(id);
    setEmptyTask(false);
  };

  const openSelectedAgentSession = () => {
    openSession(selectedAgent, agents.find(agent => agent.name === selectedAgent)?.installed ?? true);
  };

  const closeSession = (id: string) => {
    setSessions(current => {
      const closingIndex = current.findIndex(session => session.id === id);
      const next = current.filter(session => session.id !== id);
      if (id === activeSessionId) {
        const nextActive = next[Math.max(0, closingIndex - 1)] ?? next[0] ?? null;
        setActiveSessionId(nextActive?.id ?? '');
        if (nextActive) setSelectedAgent(nextActive.agent);
      }
      return next;
    });
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

        <button className="rg-new-task" onClick={openSelectedAgentSession} type="button">
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
              <span className={`rg-agent-mark ${agent.className}`}>{agent.name === 'OpenClaw' ? <Zap /> : agent.name === 'Hermes' ? <Bot /> : <Hexagon />}</span>
              <span className="rg-agent-copy">
                <span className="rg-agent-name">{agent.name}</span>
                <span className="rg-agent-state">
                  <StatusDot tone={agent.status === 'Running' ? 'success' : agent.installed ? 'muted' : 'warning'} />
                  {agent.status}
                </span>
              </span>
              <button
                className="rg-open-agent"
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
                {agent.installed ? 'Open' : 'Setup'} <ChevronRight />
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
                className={`rg-chat-tab ${session.id === activeSessionId ? 'is-active' : ''}`}
                key={session.id}
                onClick={() => {
                  setActiveSessionId(session.id);
                  setSelectedAgent(session.agent);
                  setEmptyTask(false);
                }}
                type="button"
              >
                <span className="rg-chat-tab-agent">
                  {session.agent === 'OpenClaw' ? <Zap /> : session.agent === 'Hermes' ? <Bot /> : <Hexagon />}
                </span>
                <span className="rg-chat-tab-title">{session.title}</span>
                <span
                  className="rg-chat-tab-close"
                  role="button"
                  tabIndex={0}
                  title="Close session"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeSession(session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      closeSession(session.id);
                    }
                  }}
                >
                  <X />
                </span>
              </button>
            ))}
            <button className="rg-tab-add" type="button" onClick={openSelectedAgentSession}>+</button>
          </div>
        </div>

        <section className="rg-task-title">
          <h1>{!activeSession || emptyTask ? 'Untitled frontend mock task' : 'Fix login bug and add rate limit'}</h1>
          <p>{!activeSession ? 'Open an Agent session from the left panel' : emptyTask ? 'Frontend-only placeholder task' : `Started 2 mins ago  -  ${activeSession.title}  -  Workspace: /Users/xclaw/project`}</p>
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
              <Plus />
              <strong>No open chat page</strong>
              <span>Click Open on an Agent to create a frontend-only session.</span>
            </div>
          ) : emptyTask ? (
            <div className="rg-empty-task">
              <Plus />
              <strong>Frontend-only task placeholder</strong>
              <span>No real task was created.</span>
              <button type="button" onClick={() => setEmptyTask(false)}>Restore Mock Task</button>
            </div>
          ) : (
            <>
              <div className="rg-task-scroll">
              <div className="rg-log-list">
                {preApprovalLogRows.map(row => {
                  const RowIcon = row.icon;
                  return (
                    <div className="rg-log-row" key={`${row.time}-${row.y}`}>
                      <span className="rg-log-time">{row.time}</span>
                      <RowIcon className={`rg-log-icon rg-icon-${row.iconTone || 'default'}`} />
                      <span className={`rg-log-content rg-text-${row.textTone || 'default'}`}>
                        {row.text}
                        {row.badge && <span className="rg-inline-badge">{row.badge}</span>}
                        {row.path && <code>{row.path}</code>}
                        {row.code && <code className="rg-code-inline">{row.code}</code>}
                      </span>
                      {row.delta && <span className={`rg-delta rg-delta-${row.deltaTone || 'plain'}`}>{row.delta}</span>}
                    </div>
                  );
                })}
              </div>

              <div className={`rg-command-card ${commandApproved ? 'is-approved' : ''}`}>
                <AlertTriangle />
                <div className="rg-command-title">{commandApproved ? 'Shell Command Approved' : 'Shell Command Request'}</div>
                <div className="rg-command-risk">{commandApproved ? 'Allowed' : 'High Risk'}</div>
                <div className="rg-command-code">rm -rf ./tmp/cache/*</div>
                <div className="rg-command-reason">
                  <span>Reason: Delete files recursively</span>
                  <span>Impact: May delete important project data</span>
                </div>
                <div className="rg-command-actions">
                  <button type="button" className="rg-deny" onClick={() => setCommandApproved(false)}>Deny</button>
                  <button type="button" className="rg-once" onClick={() => setCommandApproved(true)}>Allow Once</button>
                  <button type="button" className="rg-always" onClick={() => setCommandApproved(true)}>Allow Always</button>
                </div>
              </div>

              <div className="rg-log-list">
                {postApprovalLogRows.map(row => {
                  const RowIcon = row.icon;
                  return (
                    <div className="rg-log-row" key={`${row.time}-${row.y}`}>
                      <span className="rg-log-time">{row.time}</span>
                      <RowIcon className={`rg-log-icon rg-icon-${row.iconTone || 'default'}`} />
                      <span className={`rg-log-content rg-text-${row.textTone || 'default'}`}>
                        {row.text}
                        {row.badge && <span className="rg-inline-badge">{row.badge}</span>}
                        {row.path && <code>{row.path}</code>}
                        {row.code && <code className="rg-code-inline">{row.code}</code>}
                      </span>
                      {row.delta && <span className={`rg-delta rg-delta-${row.deltaTone || 'plain'}`}>{row.delta}</span>}
                    </div>
                  );
                })}
              </div>

              </div>

              <div className={`rg-command-input ${budgetOverLimit ? 'is-budget-blocked' : ''}`}>
                <span>{budgetOverLimit ? '已达到最大用量' : `Ask ${activeAgent} ...`}</span>
                <span className="rg-command-shortcuts">
                  {budgetOverLimit
                    ? `额度将在${formatBudgetRefreshTime(budgetRemainingMs)}后刷新`
                    : 'Cmd K  Commands    Cmd /  Quick Actions'}
                </span>
                <button
                  disabled={budgetOverLimit}
                  onClick={() => {
                    if (budgetOverLimit) {
                      setPlaceholder(`已达到最大用量，额度将在${formatBudgetRefreshTime(budgetRemainingMs)}后刷新`);
                    }
                  }}
                  type="button"
                  title={budgetOverLimit ? '已达到最大用量' : 'Send placeholder'}
                >
                  <Send />
                </button>
              </div>
            </>
          )}
        </section>

        <footer className="rg-statusbar">
          <StatusDot tone="success" />
          <span className="rg-status-active">Runtime Guard Active</span>
          <span>Events: 128</span>
          <span>Blocked: 2</span>
          <span>Warnings: 1</span>
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
