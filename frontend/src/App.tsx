import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import {
  Bot,
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
  X,
} from 'lucide-react';
import './App.css';
import Configure from './pages/Configure';
import CodexConfigure from './pages/CodexConfigure';
import ConfigureSelector from './pages/ConfigureSelector';
import NanobotConfigure from './pages/NanobotConfigure';
import RuntimeGuardConsole from './pages/RuntimeGuardConsole';
import Setup from './pages/Setup';
import { systemAPI, type AgentStoreCatalogAgent, type InstallStatusResponse } from './services/api';
import StoreConfigPage from './StoreConfigPage';
import { isConfigurableStoreAgentId, type ConfigurableAgentId, type StoreAgentId } from './storeConfigTypes';

type SectionId = 'monitor' | 'store' | 'setting';
type StoreFilter = 'all' | 'installed' | 'not-installed';
type AgentTone = 'teal' | 'purple' | 'yellow' | 'blue';
type AgentConfigStatus = 'configured' | 'needs-configure';
type StoreAgent = {
  id: StoreAgentId;
  name: string;
  Icon: typeof Monitor;
  tone: AgentTone;
  tags: string[];
  capabilities: Array<{ label: string; Icon: typeof Monitor; positive?: boolean }>;
  downloads: string;
  rating: string;
  installPermissions: string[];
  installed?: boolean;
  configStatus?: AgentConfigStatus | null;
  size?: string | null;
  version?: string | null;
};

const text = {
  user: '\u8861',
  storeSubtitle: '\u53d1\u73b0\u3001\u5b89\u88c5\u5e76\u7ba1\u7406\u53ef\u7531 XSafeClaw \u76d1\u63a7\u7684 Agent',
  browse: '\u6d4f\u89c8',
  installed: '\u5df2\u5b89\u88c5',
  notInstalled: '\u672a\u5b89\u88c5',
  configured: '\u5df2\u914d\u7f6e',
  needsConfigure: '\u5f85\u914d\u7f6e',
  configure: '\u914d\u7f6e',
  goConfigure: '\u53bb\u914d\u7f6e',
  searchAgent: '\u641c\u7d22 Agent',
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
  installing: '\u6b63\u5728\u5b89\u88c5',
  installComplete: '\u5b89\u88c5\u5b8c\u6210',
  installFailed: '\u5b89\u88c5\u5931\u8d25',
  installReady: '\u5df2\u51c6\u5907\u5f00\u59cb\u5b89\u88c5',
  installUnavailable: '\u6682\u65e0\u81ea\u52a8\u5b89\u88c5\u63a5\u53e3',
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
    tags: ['\u81ea\u6258\u7ba1', '\u591a\u6e20\u9053', '\u7f51\u5173'],
    capabilities: [
      { label: 'Windows \u5b89\u88c5\u5668', Icon: Package },
      { label: 'CLI', Icon: SquareTerminal },
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
    tags: ['\u81ea\u8fdb\u5316', '\u957f\u671f\u8bb0\u5fc6', '\u591a\u5e73\u53f0'],
    capabilities: [
      { label: 'Windows \u5b89\u88c5\u5668', Icon: Package },
      { label: 'CLI \u670d\u52a1', Icon: SquareTerminal },
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
    tags: ['\u8f7b\u91cf\u5185\u6838', '\u53ef\u8bfb\u6e90\u7801', '\u4e2a\u4eba Agent'],
    capabilities: [
      { label: 'uv tool', Icon: SquareTerminal },
      { label: 'Python \u5305', Icon: Package },
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
    tags: ['\u4ee3\u7801\u4ee3\u7406', '\u672c\u5730\u7ec8\u7aef', '\u4ed3\u5e93\u7f16\u8f91'],
    capabilities: [
      { label: 'Windows \u5b89\u88c5\u5668', Icon: Package },
      { label: 'CLI', Icon: SquareTerminal },
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

function getAgentInstallUrl(agentId: string) {
  if (isAgentAutoInstallable(agentId)) return systemAPI.agentStoreInstallUrl(agentId);
  return null;
}

function isAgentAutoInstallable(agentId: string) {
  return agentId === 'openclaw' || agentId === 'nanobot' || agentId === 'hermes' || agentId === 'codex';
}

function isStoreAgentInstalled(agentId: StoreAgentId, status: InstallStatusResponse | null) {
  if (!status) return false;
  if (agentId === 'openclaw') return Boolean(status.openclaw_installed);
  if (agentId === 'hermes') return Boolean(status.hermes_installed);
  if (agentId === 'nanobot') return Boolean(status.nanobot_installed);
  if (agentId === 'codex') return Boolean(status.codex_installed);
  return false;
}

function getStoreAgentConfigStatus(agentId: StoreAgentId, status: InstallStatusResponse | null): AgentConfigStatus | null {
  if (!status) return null;

  if (agentId === 'openclaw') {
    return status.config_exists ? 'configured' : 'needs-configure';
  }

  if (agentId === 'hermes') {
    if (typeof status.requires_hermes_configure === 'boolean') {
      return status.requires_hermes_configure ? 'needs-configure' : 'configured';
    }
    if (typeof status.hermes_config_exists === 'boolean' || typeof status.hermes_model_configured === 'boolean') {
      return status.hermes_config_exists && status.hermes_model_configured ? 'configured' : 'needs-configure';
    }
    return null;
  }

  if (agentId === 'nanobot') {
    if (typeof status.requires_nanobot_configure === 'boolean') {
      return status.requires_nanobot_configure ? 'needs-configure' : 'configured';
    }
    if (typeof status.nanobot_config_exists === 'boolean' || typeof status.nanobot_model_configured === 'boolean') {
      return status.nanobot_config_exists && status.nanobot_model_configured ? 'configured' : 'needs-configure';
    }
  }

  return null;
}

type InstallStreamEvent = {
  type?: string;
  text?: string;
  message?: string;
  success?: boolean;
  exit_code?: number;
};

async function runAgentInstallStream(
  url: string,
  onEvent: (event: InstallStreamEvent) => void,
) {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let succeeded = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;

      try {
        const event = JSON.parse(line.slice(5).trim()) as InstallStreamEvent;
        onEvent(event);
        if (event.type === 'done') {
          succeeded = Boolean(event.success);
        }
      } catch {
        // Ignore malformed stream chunks and continue reading later events.
      }
    }
  }

  return succeeded;
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

function AgentCard({
  agent,
  onInstall,
  onConfigure,
}: {
  agent: StoreAgent;
  onInstall: (agent: StoreAgent) => void;
  onConfigure: (agent: StoreAgent) => void;
}) {
  const AgentIcon = agent.Icon;
  const hasKnownSize = Boolean(agent.size?.trim());
  const hasKnownVersion = Boolean(agent.version?.trim());
  const installStateLabel = agent.installed ? text.installed : text.notInstalled;
  const installStateClass = agent.installed ? 'installed' : 'not-installed';
  const configStateLabel = agent.configStatus === 'configured'
    ? text.configured
    : agent.configStatus === 'needs-configure'
      ? text.needsConfigure
      : null;
  const showConfigureAction = Boolean(agent.installed && isConfigurableStoreAgentId(agent.id));
  const configureActionLabel = agent.configStatus === 'needs-configure' ? text.goConfigure : text.configure;

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
              <span className={`agent-badge ${installStateClass}`}>{installStateLabel}</span>
              {configStateLabel ? (
                <span className={`agent-badge ${agent.configStatus}`}>{configStateLabel}</span>
              ) : null}
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
        <button
          type="button"
          className="primary-action"
          onClick={() => {
            if (showConfigureAction) {
              onConfigure(agent);
            } else {
              onInstall(agent);
            }
          }}
        >
          {showConfigureAction ? configureActionLabel : text.install}
        </button>
      </div>
    </article>
  );
}

function InstallConfirmDialog({
  agent,
  onClose,
  onInstallComplete,
}: {
  agent: StoreAgent;
  onClose: () => void;
  onInstallComplete: () => void;
}) {
  const AgentIcon = agent.Icon;
  const title = `${text.install} ${agent.name}`;
  const hasKnownSize = Boolean(agent.size?.trim());
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'success' | 'error'>('idle');
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const canAutoInstall = isAgentAutoInstallable(agent.id);

  const handleStartInstall = async () => {
    const installUrl = getAgentInstallUrl(agent.id);
    if (!installUrl) {
      setInstallState('error');
      setInstallLogs([text.installUnavailable]);
      return;
    }

    setInstallState('installing');
    setInstallLogs([]);

    try {
      const success = await runAgentInstallStream(installUrl, (event) => {
        if (event.type === 'output' && event.text) {
          setInstallLogs((logs) => [...logs, event.text as string]);
        } else if (event.type === 'error' && event.message) {
          setInstallLogs((logs) => [...logs, event.message as string]);
        } else if (event.type === 'done' && event.success === false) {
          const exitDetail = event.exit_code === undefined ? '' : ` (${event.exit_code})`;
          setInstallLogs((logs) => [...logs, `${text.installFailed}${exitDetail}`]);
        }
      });

      if (success) {
        setInstallState('success');
        onInstallComplete();
      } else {
        setInstallState('error');
      }
    } catch (error) {
      setInstallState('error');
      setInstallLogs((logs) => [...logs, error instanceof Error ? error.message : String(error)]);
    }
  };

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

          <div className={`install-status-box ${installState}`}>
            <div className="install-status-line">
              <span>
                {installState === 'installing'
                  ? text.installing
                  : installState === 'success'
                    ? text.installComplete
                    : installState === 'error'
                      ? text.installFailed
                      : canAutoInstall
                        ? text.installReady
                        : text.installUnavailable}
              </span>
            </div>
            {installLogs.length > 0 ? (
              <div className="install-log" aria-label="Install log">
                {installLogs.map((log, index) => (
                  <p key={`${agent.id}-install-log-${index}`}>{log}</p>
                ))}
              </div>
            ) : null}
          </div>

          <footer className="install-dialog-actions">
            <button type="button" className="install-cancel-button" onClick={onClose} disabled={installState === 'installing'}>
              {text.cancel}
            </button>
            <button
              type="button"
              className="install-start-button"
              onClick={() => void handleStartInstall()}
              disabled={installState === 'installing' || !canAutoInstall}
            >
              {installState === 'installing' ? text.installing : text.startInstall}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

function StorePage() {
  const [catalogById, setCatalogById] = useState<Record<string, AgentStoreCatalogAgent>>({});
  const [installStatus, setInstallStatus] = useState<InstallStatusResponse | null>(null);
  const [activeStoreFilter, setActiveStoreFilter] = useState<StoreFilter>('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [configAgentId, setConfigAgentId] = useState<ConfigurableAgentId | null>(null);

  const refreshInstallStatus = () => {
    systemAPI.installStatus()
      .then((response) => {
        setInstallStatus(response.data);
      })
      .catch(() => {
        setInstallStatus(null);
      });
  };

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

  useEffect(() => {
    let isMounted = true;

    systemAPI.installStatus()
      .then((response) => {
        if (!isMounted) return;
        setInstallStatus(response.data);
      })
      .catch(() => {
        if (isMounted) {
          setInstallStatus(null);
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
    const installed = isStoreAgentInstalled(agent.id, installStatus);
    const configStatus = installed ? getStoreAgentConfigStatus(agent.id, installStatus) : null;

    return {
      ...agent,
      installed,
      configStatus,
      version: catalogVersion || agent.version,
      size: catalogSize || agent.size,
    };
  });
  const filteredAgents = displayAgents.filter((agent) => {
    if (activeStoreFilter === 'installed') return agent.installed;
    if (activeStoreFilter === 'not-installed') return !agent.installed;
    return true;
  });
  const selectedAgent = displayAgents.find((agent) => agent.id === selectedAgentId) ?? null;
  const configAgent = configAgentId
    ? displayAgents.find((agent) => agent.id === configAgentId && isConfigurableStoreAgentId(agent.id)) ?? null
    : null;
  const storeTabs: Array<{ id: StoreFilter; label: string }> = [
    { id: 'all', label: text.browse },
    { id: 'installed', label: text.installed },
    { id: 'not-installed', label: text.notInstalled },
  ];

  if (configAgentId && configAgent) {
    return (
      <section className="store-page">
        <StoreConfigPage
          agentId={configAgentId}
          installed={Boolean(configAgent.installed)}
          configured={configAgent.configStatus === 'configured'}
          onBack={() => setConfigAgentId(null)}
          onSaved={refreshInstallStatus}
        />
      </section>
    );
  }

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
        {storeTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeStoreFilter === tab.id ? 'active' : undefined}
            aria-pressed={activeStoreFilter === tab.id}
            onClick={() => setActiveStoreFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="agent-grid">
        {filteredAgents.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            onInstall={() => setSelectedAgentId(agent.id)}
            onConfigure={(targetAgent) => {
              if (isConfigurableStoreAgentId(targetAgent.id)) {
                setConfigAgentId(targetAgent.id);
              }
            }}
          />
        ))}
      </div>

      {selectedAgent ? (
        <InstallConfirmDialog
          agent={selectedAgent}
          onClose={() => setSelectedAgentId(null)}
          onInstallComplete={refreshInstallStatus}
        />
      ) : null}
    </section>
  );
}

function DesktopHome() {
  const [activeSection, setActiveSection] = useState<SectionId>('monitor');
  const currentSection = sections.find((section) => section.id === activeSection) ?? sections[0];

  return (
    <div className="desktop-app">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <img className="titlebar-logo" src="/favicon-32.png" alt="" />
          <span className="titlebar-brand">XSafeClaw</span>
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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DesktopHome />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/configure_select" element={<ConfigureSelector />} />
        <Route path="/configure" element={<Configure />} />
        <Route path="/openclaw_configure" element={<Configure />} />
        <Route path="/hermes_configure" element={<Configure />} />
        <Route path="/nanobot_configure" element={<NanobotConfigure />} />
        <Route path="/codex_configure" element={<CodexConfigure />} />
        <Route path="/backend" element={<RuntimeGuardConsole />} />
        <Route path="*" element={<DesktopHome />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
