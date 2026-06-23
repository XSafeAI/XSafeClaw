import {
  Bot,
  Boxes,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  CircleDotDashed,
  CirclePlus,
  FlaskConical,
  Grid2X2,
  Headphones,
  HelpCircle,
  Link2,
  Maximize2,
  Mic,
  Minimize,
  PanelLeft,
  Rocket,
  Search,
  Send,
  Sparkles,
  Target,
  WandSparkles,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import mascot from './assets/assistant-mascot.png';
import './App.css';

const primaryNav = [
  { label: '新建任务', Icon: CirclePlus, active: true },
  { label: '助理', Icon: Bot },
  { label: '项目', Icon: Workflow },
  { label: '专家', Icon: Headphones, aside: '技能·连接器' },
  { label: '自动化', Icon: Target },
  { label: '更多', Icon: Boxes, aside: '资料库·灵感' },
];

const modeTabs = [
  { label: '日常办公', Icon: BriefcaseBusiness, active: true },
  { label: '代码开发', Icon: FlaskConical },
  { label: '设计创意', Icon: HelpCircle },
];

const quickChips = [
  { label: '文档处理', Icon: BriefcaseBusiness },
  { label: '金融服务', Icon: BriefcaseBusiness },
  { label: '高手帮帮你', Icon: Grid2X2 },
  { label: '更多' },
];

const composerTools = [
  { label: 'Craft', Icon: WandSparkles },
  { label: '自动', Icon: CircleDotDashed },
  { label: '技能', Icon: Zap },
  { label: '连应用', Icon: Link2 },
  { label: '默认权限', Icon: Target },
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
  return (
    <div className="desktop-app">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <img className="titlebar-logo" src="/favicon-32.png" alt="" />
          <span className="titlebar-brand">XSafeClaw</span>
          <nav className="titlebar-menu" aria-label="Application menu">
            <button type="button">编辑(E)</button>
            <button type="button">窗口(W)</button>
            <button type="button">帮助(H)</button>
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
            {primaryNav.map(({ label, Icon, active, aside }) => (
              <button key={label} type="button" className={active ? 'nav-item active' : 'nav-item'}>
                <span className="nav-main">
                  <Icon size={16} strokeWidth={1.8} />
                  <span>{label}</span>
                </span>
                {aside && <span className="nav-aside">{aside}</span>}
              </button>
            ))}
          </nav>

          <section className="space-list" aria-label="Spaces">
            <button type="button" className="space-heading">
              <span>空间 (1)</span>
              <ChevronDown size={13} />
            </button>
            <button type="button" className="project-row">
              <span className="project-title">
                <Workflow size={15} strokeWidth={1.8} />
                项目新手指引
              </span>
              <ChevronDown size={13} />
            </button>
            <button type="button" className="task-row">
              <span>生成项目功能介绍</span>
              <span>2小时前</span>
            </button>
          </section>

          <div className="sidebar-footer">
            <button type="button" className="user-chip" aria-label="User profile">
              <img src="/favicon-48.png" alt="" />
              <span>衡</span>
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

        <main className="main-panel" aria-label="XSafeClaw home">
          <div className="growth-pill">
            <span className="growth-icon">
              <Rocket size={17} fill="currentColor" />
            </span>
            <span>来成长计划赚积分</span>
            <ChevronRight size={15} />
          </div>

          <section className="hero">
            <div className="hero-copy">
              <h1>
                XSafeClaw
                <span>你的职场超能力</span>
              </h1>

              <div className="mode-tabs" role="group" aria-label="Assistant modes">
                {modeTabs.map(({ label, Icon, active }) => (
                  <button key={label} type="button" className={active ? 'mode-tab active' : 'mode-tab'}>
                    <Icon size={15} strokeWidth={1.8} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="composer-zone">
              <div className="quick-chip-row" role="group" aria-label="Quick tasks">
                {quickChips.map(({ label, Icon }) => (
                  <button key={label} type="button" className="quick-chip">
                    {Icon && <Icon size={15} strokeWidth={1.8} />}
                    {label}
                  </button>
                ))}
              </div>

              <div className="mascot-peek">
                <img src={mascot} alt="XSafeClaw assistant mascot" />
              </div>

              <div className="composer-card">
                <textarea
                  aria-label="Prompt input"
                  placeholder="今天帮你做些什么？ @ 引用对话文件，/ 调用技能与指令"
                />
                <div className="composer-toolbar">
                  <div className="composer-left-tools">
                    {composerTools.map(({ label, Icon }) => (
                      <button key={label} type="button" className="tool-button">
                        <Icon size={15} strokeWidth={1.75} />
                        <span>{label}</span>
                        <ChevronDown size={12} />
                      </button>
                    ))}
                  </div>
                  <div className="composer-right-tools">
                    <button type="button" aria-label="Add">
                      <CirclePlus size={19} strokeWidth={1.6} />
                    </button>
                    <button type="button" aria-label="Magic">
                      <Sparkles size={17} strokeWidth={1.7} />
                    </button>
                    <button type="button" aria-label="Voice">
                      <Mic size={18} strokeWidth={1.7} />
                    </button>
                    <button type="button" className="send-button" aria-label="Send">
                      <Send size={18} fill="currentColor" />
                    </button>
                  </div>
                </div>
              </div>

              <button type="button" className="workspace-picker">
                <BriefcaseBusiness size={15} />
                <span>选择工作空间</span>
                <ChevronRight size={13} />
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
