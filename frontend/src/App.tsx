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
  description: string;
  badges: Array<{ label: string; variant: BadgeVariant }>;
  tags: string[];
  capabilities: Array<{ label: string; Icon: typeof Monitor; positive?: boolean }>;
  downloads: string;
  rating: string;
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
    description: '\u901a\u7528\u578b Agent\uff0c\u9002\u7528\u4e8e\u591a\u79cd\u4efb\u52a1\u573a\u666f\uff0c\u7075\u6d3b\u6269\u5c55\uff0c\u6613\u4e8e\u96c6\u6210\u3002',
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
    downloads: '128.6K',
    rating: '4.7',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    Icon: Feather,
    tone: 'purple',
    description: '\u8f7b\u91cf\u534f\u540c\u578b Agent\uff0c\u4e13\u6ce8\u4e8e\u9ad8\u6548\u901a\u4fe1\u4e0e\u534f\u540c\u3002',
    badges: [
      { label: text.official, variant: 'official' },
      { label: text.verified, variant: 'verified' },
    ],
    tags: ['\u534f\u540c', '\u901a\u4fe1', '\u6548\u7387'],
    capabilities: [
      { label: '\u684c\u9762\u5e94\u7528', Icon: Monitor },
      { label: text.compatible, Icon: CheckCircle2, positive: true },
    ],
    downloads: '85.3K',
    rating: '4.5',
  },
  {
    id: 'nanobot',
    name: 'Nanobot',
    Icon: Bot,
    tone: 'yellow',
    description: '\u81ea\u6211\u8fdb\u5316\u5b9e\u9a8c\u6027 Agent\uff0c\u64c5\u957f\u63a2\u7d22\u3001\u5b66\u4e60\u4e0e\u81ea\u52a8\u5316\u6267\u884c\u3002',
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
    downloads: '32.1K',
    rating: '4.2',
  },
  {
    id: 'codex',
    name: 'Codex',
    Icon: Code2,
    tone: 'blue',
    description: '\u9762\u5411\u5f00\u53d1\u8005\u7684\u7f16\u7a0b Agent\uff0c\u7406\u89e3\u4ee3\u7801\u3001\u751f\u6210\u4ee3\u7801\u3001\u8f85\u52a9\u8c03\u8bd5\u3002',
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
    downloads: '210.7K',
    rating: '4.8',
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

function AgentCard({ agent }: { agent: StoreAgent }) {
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
          <p className="agent-description">{agent.description}</p>
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
        <button type="button" className="primary-action">
          {text.install}
        </button>
      </div>
    </article>
  );
}

function StorePage() {
  const [catalogById, setCatalogById] = useState<Record<string, AgentStoreCatalogAgent>>({});

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
          <AgentCard key={agent.name} agent={agent} />
        ))}
      </div>
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
