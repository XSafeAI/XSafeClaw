import { useEffect, useMemo, useState } from 'react';
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
import './RuntimeGuardConsole.css';

type AgentName = 'OpenClaw' | 'Hermes' | 'Nanobot';
type ApprovalState = 'pending' | 'allowed' | 'denied';
type GuardMode = 'Off' | 'On';
type ChatSession = {
  id: string;
  agent: AgentName;
  title: string;
};

const agents: Array<{ name: AgentName; status: 'Running' | 'Idle'; className: string }> = [
  { name: 'OpenClaw', status: 'Running', className: 'agent-openclaw' },
  { name: 'Hermes', status: 'Idle', className: 'agent-hermes' },
  { name: 'Nanobot', status: 'Idle', className: 'agent-nanobot' },
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
  const [viewportFit, setViewportFit] = useState({ scale: 1, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    const updateViewportFit = () => {
      const scale = Math.min(window.innerWidth / 854, window.innerHeight / 570);
      setViewportFit({
        scale,
        offsetX: (window.innerWidth - 854 * scale) / 2,
        offsetY: (window.innerHeight - 570 * scale) / 2,
      });
    };

    updateViewportFit();
    window.addEventListener('resize', updateViewportFit);
    return () => window.removeEventListener('resize', updateViewportFit);
  }, []);

  const approvalCount = useMemo(
    () => [shellApproval, fileApproval].filter(state => state === 'pending').length,
    [shellApproval, fileApproval],
  );
  const activeSession = sessions.find(session => session.id === activeSessionId) ?? sessions[0] ?? null;
  const activeAgent = activeSession?.agent ?? selectedAgent;

  const showPlaceholder = () => {
    setPlaceholder('This is a frontend-only placeholder.');
    window.setTimeout(() => setPlaceholder(''), 2200);
  };

  const openSession = (agent: AgentName) => {
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

  return (
    <div className="runtime-guard-page">
      {placeholder && <div className="rg-toast">{placeholder}</div>}
      <div
        className="rg-scale-surface"
        style={{
          left: viewportFit.offsetX,
          top: viewportFit.offsetY,
          transform: `scale(${viewportFit.scale})`,
        }}
      >
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

        <button className="rg-new-task" onClick={() => setEmptyTask(true)} type="button">
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
              className={`rg-agent-row ${selectedAgent === agent.name ? 'is-selected' : ''}`}
              key={agent.name}
              onClick={() => setSelectedAgent(agent.name)}
              style={{ top: 18 + index * 36 }}
            >
              <span className={`rg-agent-mark ${agent.className}`}>{agent.name === 'OpenClaw' ? <Zap /> : agent.name === 'Hermes' ? <Bot /> : <Hexagon />}</span>
              <span className="rg-agent-copy">
                <span className="rg-agent-name">{agent.name}</span>
                <span className="rg-agent-state">
                  <StatusDot tone={agent.status === 'Running' ? 'success' : 'muted'} />
                  {agent.status}
                </span>
              </span>
              <button
                className="rg-open-agent"
                onClick={(event) => {
                  event.stopPropagation();
                  openSession(agent.name);
                }}
                type="button"
              >
                Open <ChevronRight />
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

        <section className="rg-budget">
          <div className="rg-budget-title">BUDGET</div>
          <div className="rg-budget-amount">$3.21</div>
          <div className="rg-budget-total">/ $10.00</div>
          <div className="rg-budget-bar"><span /></div>
          <div className="rg-budget-percent">32%</div>
          <div className="rg-budget-reset">Resets in 2h 35m</div>
        </section>

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
            <button className="rg-tab-add" type="button" onClick={() => openSession(selectedAgent)}>+</button>
          </div>
          <IconButton className="rg-top-icon-one" title="Single layout"><Square /></IconButton>
          <IconButton className="rg-top-icon-two" title="Split layout"><Columns2 /></IconButton>
          <IconButton className="rg-heartbeat" title="Heartbeat monitor"><HeartPulse /></IconButton>
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
              <div className="rg-log-list">
                {logRows.map(row => {
                  const RowIcon = row.icon;
                  return (
                    <div className="rg-log-row" key={`${row.time}-${row.y}`} style={{ top: row.y }}>
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

              <div className="rg-command-input">
                <span>Ask {activeAgent} ...</span>
                <span className="rg-command-shortcuts">Cmd K&nbsp;&nbsp; Commands&nbsp;&nbsp;&nbsp;&nbsp; Cmd /&nbsp;&nbsp; Quick Actions</span>
                <button type="button" title="Send placeholder"><Send /></button>
              </div>
            </>
          )}
        </section>

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
    </div>
  );
}
