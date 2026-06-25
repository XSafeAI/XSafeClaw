import { useEffect, useState } from 'react';
import {
  Bot,
  ChevronDown,
  CheckCircle2,
  Code2,
  Download,
  Feather,
  HelpCircle,
  Link2,
  Maximize2,
  Minimize,
  Monitor,
  Package,
  PanelLeft,
  PawPrint,
  Search,
  Settings,
  SquareTerminal,
  Star,
  Store,
  Target,
  Workflow,
  X,
} from 'lucide-react';
import './App.css';
import { systemAPI, type AgentStoreCatalogAgent } from './services/api';

type SectionId = 'monitor' | 'store' | 'setting';
type BadgeVariant = 'official' | 'verified' | 'experimental';
type AgentTone = 'teal' | 'purple' | 'yellow' | 'blue';
type StoreAgent = {
  id: string;
  name: string;
  Icon: typeof Monitor;
  tone: AgentTone;
  badges: Array<{ label: string; variant: BadgeVariant }>;
  tags: string[];
  capabilities: Array<{ label: string; Icon: typeof Monitor; positive?: boolean }>;
  downloads: string;
  rating: string;
  installPermissions: string[];
  size?: string | null;
  version?: string | null;
};

const text = {
  edit: '\u7f16\u8f91(E)',
  window: '\u7a97\u53e3(W)',
  help: '\u5e2e\u52a9(H)',
  space: '\u7a7a\u95f4 (1)',
  guide: '\u9879\u76ee\u65b0\u624b\u6307\u5f15',
  task: '\u751f\u6210\u9879\u76ee\u529f\u80fd\u4ecb\u7ecd',
  twoHoursAgo: '2\u5c0f\u65f6\u524d',
  user: '\u8861',
  storeSubtitle: '\u53d1\u73b0\u3001\u5b89\u88c5\u5e76\u7ba1\u7406\u53ef\u7531 XSafeClaw \u76d1\u63a7\u7684 Agent',
  browse: '\u6d4f\u89c8',
  installed: '\u5df2\u5b89\u88c5',
  updates: '\u66f4\u65b0',
  searchAgent: '\u641c\u7d22 Agent',
  official: '\u5b98\u65b9',
  verified: '\u5df2\u9a8c\u8bc1',
  experimental: '\u5b9e\u9a8c\u6027',
  compatible: '\u5f53\u524d\u8bbe\u5907\u517c\u5bb9',
  details: '\u67e5\u770b\u8be6\u60c5',
  install: '\u5b89\u88c5',
  cancel: '\u53d6\u6d88',
  startInstall: '\u5f00\u59cb\u5b89\u88c5',
  downloadSize: '\u4e0b\u8f7d\u5927\u5c0f',
  currentDevice: '\u5f53\u524d\u8bbe\u5907',
  canInstall: '\u53ef\u4ee5\u5b89\u88c5',
  possibleUse: '\u53ef\u80fd\u4f7f\u7528\uff1a',
  closeInstallDialog: '\u5173\u95ed\u5b89\u88c5\u5f39\u7a97',
  closeInstallBackdrop: '\u5173\u95ed\u5b89\u88c5\u786e\u8ba4\u906e\u7f69',
  sizeUnknown: '\u5927\u5c0f\u672a\u77e5',
  versionUnknown: '\u7248\u672c\u672a\u77e5',
};

const sections: Array<{
  id: SectionId;
  label: string;
  Icon: typeof Monitor;
  summary: string;
}> = [
  {
    id: 'monitor',
    label: 'Monitor',
    Icon: Monitor,
    summary: 'Monitor placeholder',
  },
  {
    id: 'store',
    label: 'Store',
    Icon: Store,
    summary: 'Store placeholder',
  },
  {
    id: 'setting',
    label: 'Setting',
    Icon: Settings,
    summary: 'Setting placeholder',
  },
];

const storeAgents: StoreAgent[] = [
  {
    id: 'openclaw',
    name: 'OpenClaw',
    Icon: PawPrint,
    tone: 'teal',
    badges: [
      { label: text.official, variant: 'official' },
      { label: text.verified, variant: 'verified' },
    ],
    tags: ['\u901a\u7528', '\u81ea\u52a8\u5316', '\u5f00\u53d1'],
    capabilities: [
      { label: 'CLI', Icon: SquareTerminal },
      { label: '\u9700 API Key', Icon: Package },
      { label: text.compatible, Icon: CheckCircle2, positive: true },
    ],
    downloads: '0',
    rating: '0.0',
    installPermissions: ['\u7f51\u7edc\u8bbf\u95ee', '\u5de5\u4f5c\u76ee\u5f55', '\u672c\u5730\u547d\u4ee4\u6267\u884c'],
  },
  {
    id: 'hermes',
    name: 'Hermes',
    Icon: Feather,
    tone: 'purple',
    badges: [
      { label: text.official, variant: 'official' },
      { label: text.verified, variant: 'verified' },
    ],
    tags: ['\u534f\u540c', '\u901a\u4fe1', '\u6548\u7387'],
    capabilities: [
      { label: '\u684c\u9762\u5e94\u7528', Icon: Monitor },
      { label: text.compatible, Icon: CheckCircle2, positive: true },
    ],
    downloads: '0',
    rating: '0.0',
    installPermissions: ['\u7f51\u7edc\u8bbf\u95ee', '\u7ec8\u7aef\u6267\u884c', '\u6d88\u606f\u7f51\u5173'],
  },
  {
    id: 'nanobot',
    name: 'Nanobot',
    Icon: Bot,
    tone: 'yellow',
    badges: [
      { label: text.official, variant: 'official' },
      { label: text.experimental, variant: 'experimental' },
    ],
    tags: ['\u5b9e\u9a8c', '\u5b66\u4e60', '\u81ea\u52a8\u5316'],
    capabilities: [
      { label: 'Docker', Icon: SquareTerminal },
      { label: '\u9700 Docker', Icon: Package },
      { label: text.compatible, Icon: CheckCircle2, positive: true },
    ],
    downloads: '0',
    rating: '0.0',
    installPermissions: ['\u7f51\u7edc\u8bbf\u95ee', '\u5de5\u4f5c\u76ee\u5f55', '\u540e\u53f0\u7f51\u5173'],
  },
  {
    id: 'codex',
    name: 'Codex',
    Icon: Code2,
    tone: 'blue',
    badges: [
      { label: text.official, variant: 'official' },
      { label: text.verified, variant: 'verified' },
    ],
    tags: ['\u7f16\u7a0b', '\u5f00\u53d1\u8005\u5de5\u5177', 'AI \u52a9\u624b'],
    capabilities: [
      { label: 'CLI', Icon: SquareTerminal },
      { label: '\u9700 API Key', Icon: Package },
      { label: text.compatible, Icon: CheckCircle2, positive: true },
    ],
    downloads: '0',
    rating: '0.0',
    installPermissions: ['\u4ee3\u7801\u76ee\u5f55', '\u672c\u5730\u547d\u4ee4\u6267\u884c', '\u8054\u7f51\u9700\u786e\u8ba4'],
  },
];

async function handleWindowAction(action: 'minimize' | 'maximize' | 'close') {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();

    if (action === 'minimize') await appWindow.minimize();
    if (action === 'maximize') await appWindow.toggleMaximize();
    if (action === 'close') await appWindow.close();
  } catch {
    // Tauri window APIs are unavailable in browser previews and Vitest.
  }
}

function PlaceholderPanel({ section }: { section: (typeof sections)[number] }) {
  const CurrentIcon = section.Icon;

  return (
    <section className="placeholder-card" aria-live="polite">
      <div className="placeholder-icon">
        <CurrentIcon size={24} strokeWidth={1.8} />
      </div>
      <p className="placeholder-kicker">XSafeClaw</p>
      <h1>{section.label}</h1>
      <p className="placeholder-text">{section.summary}</p>
    </section>
  );
}

function AgentCard({ agent, onInstall }: { agent: StoreAgent; onInstall: (agent: StoreAgent) => void }) {
  const AgentIcon = agent.Icon;
  const hasKnownSize = Boolean(agent.size?.trim());
  const hasKnownVersion = Boolean(agent.version?.trim());

  return (
    <article className="agent-card">
      <div className="agent-card-main">
        <div className={`agent-logo agent-logo-${agent.tone}`}>
          <AgentIcon size={44} strokeWidth={2.3} />
        </div>
        <div className="agent-card-body">
          <div className="agent-title-row">
            <h2>{agent.name}</h2>
            <div className="agent-badges">
              {agent.badges.map((badge) => (
                <span key={`${agent.name}-${badge.label}`} className={`agent-badge ${badge.variant}`}>
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
          <div className="agent-tags">
            {agent.tags.map((tag) => (
              <span key={`${agent.name}-${tag}`}>{tag}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="agent-capabilities">
        {agent.capabilities.map(({ label, Icon, positive }) => (
          <span key={`${agent.name}-${label}`} className={positive ? 'positive' : undefined}>
            <Icon size={16} strokeWidth={1.85} />
            {label}
          </span>
        ))}
      </div>

      <div className="agent-stats">
        <span>
          <Download size={16} strokeWidth={1.8} />
          {agent.downloads}
        </span>
        <span>
          <Star size={16} fill="currentColor" strokeWidth={1.8} />
          {agent.rating}
        </span>
        <span className={hasKnownSize ? undefined : 'unknown-stat'}>
          {hasKnownSize ? agent.size : text.sizeUnknown}
        </span>
        <span className={hasKnownVersion ? undefined : 'unknown-stat'}>
          {hasKnownVersion ? agent.version : text.versionUnknown}
        </span>
      </div>

      <div className="agent-actions">
        <button type="button" className="secondary-action">
          {text.details}
        </button>
        <button type="button" className="primary-action" onClick={() => onInstall(agent)}>
          {text.install}
        </button>
      </div>
    </article>
  );
}

function InstallConfirmDialog({ agent, onClose }: { agent: StoreAgent; onClose: () => void }) {
  const AgentIcon = agent.Icon;
  const title = `${text.install} ${agent.name}`;
  const hasKnownSize = Boolean(agent.size?.trim());

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="install-dialog-layer">
      <button
        type="button"
        className="install-dialog-backdrop"
        aria-label={text.closeInstallBackdrop}
        onClick={onClose}
      />
      <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title">
        <header className="install-dialog-header">
          <h2 id="install-dialog-title">{title}</h2>
          <button type="button" className="install-dialog-close" aria-label={text.closeInstallDialog} onClick={onClose}>
            <X size={30} strokeWidth={1.7} />
          </button>
        </header>

        <div className="install-dialog-body">
          <div className="install-agent-summary">
            <div className={`agent-logo install-agent-logo agent-logo-${agent.tone}`}>
              <AgentIcon size={44} strokeWidth={2.3} />
            </div>
            <div>
              <h3>{agent.name}</h3>
              <p>{`\u5373\u5c06\u4e0b\u8f7d\u5e76\u5b89\u88c5 ${agent.name}\u3002`}</p>
            </div>
          </div>

          <div className="install-dialog-divider" />

          <div className="install-info-row">
            <span>{text.downloadSize}</span>
            <strong className={hasKnownSize ? undefined : 'unknown-stat'}>
              {hasKnownSize ? agent.size : text.sizeUnknown}
            </strong>
          </div>

          <div className="install-dialog-divider" />

          <div className="install-info-row">
            <span>{text.currentDevice}</span>
            <strong className="install-compatible">
              <CheckCircle2 size={28} strokeWidth={1.8} />
              {text.canInstall}
            </strong>
          </div>

          <div className="install-dialog-divider" />

          <div className="install-permissions-row">
            <span>{text.possibleUse}</span>
            <div className="install-permission-chips">
              {agent.installPermissions.map((permission) => (
                <span key={`${agent.id}-${permission}`}>{permission}</span>
              ))}
            </div>
          </div>

          <footer className="install-dialog-actions">
            <button type="button" className="install-cancel-button" onClick={onClose}>
              {text.cancel}
            </button>
            <button type="button" className="install-start-button">
              {text.startInstall}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

function StorePage() {
  const [catalogById, setCatalogById] = useState<Record<string, AgentStoreCatalogAgent>>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    systemAPI.agentStoreCatalog()
      .then((response) => {
        if (!isMounted) return;
        const nextCatalog: Record<string, AgentStoreCatalogAgent> = {};
        for (const agent of response.data.agents ?? []) {
          if (agent?.id) {
            nextCatalog[agent.id] = agent;
          }
        }
        setCatalogById(nextCatalog);
      })
      .catch(() => {
        if (isMounted) {
          setCatalogById({});
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const displayAgents = storeAgents.map((agent) => {
    const catalogAgent = catalogById[agent.id];
    const catalogVersion = catalogAgent?.status === 'ready' ? catalogAgent.version?.trim() : '';
    const catalogSize = catalogAgent?.status === 'ready' ? catalogAgent.sizeLabel?.trim() : '';

    return {
      ...agent,
      version: catalogVersion || agent.version,
      size: catalogSize || agent.size,
    };
  });
  const selectedAgent = displayAgents.find((agent) => agent.id === selectedAgentId) ?? null;

  return (
    <section className="store-page">
      <header className="store-header">
        <div>
          <h1>Agent Store</h1>
          <p>{text.storeSubtitle}</p>
        </div>
        <label className="store-search">
          <Search size={18} strokeWidth={1.9} />
          <input type="search" aria-label={text.searchAgent} placeholder={text.searchAgent} />
        </label>
      </header>

      <div className="store-tabs" role="group" aria-label="Agent Store tabs">
        <button type="button" className="active">
          {text.browse}
        </button>
        <button type="button">{text.installed}</button>
        <button type="button">{text.updates}</button>
      </div>

      <div className="agent-grid">
        {displayAgents.map((agent) => (
          <AgentCard key={agent.name} agent={agent} onInstall={() => setSelectedAgentId(agent.id)} />
        ))}
      </div>

      {selectedAgent ? <InstallConfirmDialog agent={selectedAgent} onClose={() => setSelectedAgentId(null)} /> : null}
    </section>
  );
}

function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('monitor');
  const currentSection = sections.find((section) => section.id === activeSection) ?? sections[0];

  return (
    <div className="desktop-app">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <img className="titlebar-logo" src="/favicon-32.png" alt="" />
          <span className="titlebar-brand">XSafeClaw</span>
          <nav className="titlebar-menu" aria-label="Application menu">
            <button type="button">{text.edit}</button>
            <button type="button">{text.window}</button>
            <button type="button">{text.help}</button>
          </nav>
        </div>
        <div className="titlebar-controls">
          <button type="button" aria-label="Minimize window" onClick={() => void handleWindowAction('minimize')}>
            <Minimize size={13} strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="Maximize window" onClick={() => void handleWindowAction('maximize')}>
            <Maximize2 size={12} strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="Close window" onClick={() => void handleWindowAction('close')}>
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div>
              <p className="sidebar-brand">XSafeClaw</p>
              <p className="sidebar-version">v5.1.5</p>
            </div>
            <div className="sidebar-actions" aria-label="Sidebar tools">
              <button type="button" aria-label="Toggle sidebar">
                <PanelLeft size={16} />
              </button>
              <button type="button" aria-label="Search">
                <Search size={17} />
              </button>
              <button type="button" aria-label="Filter">
                <Target size={15} />
              </button>
            </div>
          </div>

          <nav className="primary-nav" aria-label="Primary navigation">
            {sections.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={activeSection === id ? 'nav-item active' : 'nav-item'}
                aria-pressed={activeSection === id}
                onClick={() => setActiveSection(id)}
              >
                <span className="nav-main">
                  <Icon size={16} strokeWidth={1.8} />
                  <span>{label}</span>
                </span>
              </button>
            ))}
          </nav>

          <section className="space-list" aria-label="Spaces">
            <button type="button" className="space-heading">
              <span>{text.space}</span>
              <ChevronDown size={13} />
            </button>
            <button type="button" className="project-row">
              <span className="project-title">
                <Workflow size={15} strokeWidth={1.8} />
                {text.guide}
              </span>
              <ChevronDown size={13} />
            </button>
            <button type="button" className="task-row">
              <span>{text.task}</span>
              <span>{text.twoHoursAgo}</span>
            </button>
          </section>

          <div className="sidebar-footer">
            <button type="button" className="user-chip" aria-label="User profile">
              <img src="/favicon-48.png" alt="" />
              <span>{text.user}</span>
            </button>
            <div className="footer-actions">
              <button type="button" aria-label="Notifications">
                <HelpCircle size={16} />
              </button>
              <button type="button" aria-label="Links">
                <Link2 size={16} />
              </button>
            </div>
          </div>
        </aside>

        <main
          className={activeSection === 'store' ? 'main-panel store-content' : 'main-panel workspace-content'}
          aria-label="XSafeClaw workspace"
        >
          {activeSection === 'store' ? <StorePage /> : <PlaceholderPanel section={currentSection} />}
        </main>
      </div>
    </div>
  );
}

export default App;
