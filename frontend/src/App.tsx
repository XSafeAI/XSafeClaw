import { useState } from 'react';
import {
  ChevronDown,
  HelpCircle,
  Link2,
  Maximize2,
  Minimize,
  Monitor,
  PanelLeft,
  Search,
  Settings,
  Store,
  Target,
  Workflow,
  X,
} from 'lucide-react';
import './App.css';

type SectionId = 'monitor' | 'store' | 'setting';

const text = {
  edit: '\u7f16\u8f91(E)',
  window: '\u7a97\u53e3(W)',
  help: '\u5e2e\u52a9(H)',
  space: '\u7a7a\u95f4 (1)',
  guide: '\u9879\u76ee\u65b0\u624b\u6307\u5f15',
  task: '\u751f\u6210\u9879\u76ee\u529f\u80fd\u4ecb\u7ecd',
  twoHoursAgo: '2\u5c0f\u65f6\u524d',
  user: '\u8861',
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

function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('monitor');
  const currentSection = sections.find((section) => section.id === activeSection) ?? sections[0];
  const CurrentIcon = currentSection.Icon;

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

        <main className="main-panel workspace-content" aria-label="XSafeClaw workspace">
          <section className="placeholder-card" aria-live="polite">
            <div className="placeholder-icon">
              <CurrentIcon size={24} strokeWidth={1.8} />
            </div>
            <p className="placeholder-kicker">XSafeClaw</p>
            <h1>{currentSection.label}</h1>
            <p className="placeholder-text">{currentSection.summary}</p>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
