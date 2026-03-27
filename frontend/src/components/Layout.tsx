import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Shield, Monitor, ChevronRight, MessageSquare, Sun, Moon, Languages, Activity } from 'lucide-react';
import { useI18n } from '../i18n';

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('xsafeclaw:theme') as 'dark' | 'light') ?? 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('xsafeclaw:theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return { theme, toggle };
}

export default function Layout() {
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const { locale, setLocale, t } = useI18n();

  const navigation = [
    { name: t.layout.agentTown,       href: '/agent-valley',     icon: Activity,       desc: t.layout.agentTownDesc },
    { name: t.layout.clawMonitor,     href: '/monitor',          icon: Monitor,        desc: t.layout.descMonitor },
    { name: t.layout.safeChat,        href: '/chat',             icon: MessageSquare,  desc: t.layout.descChat },
    { name: t.layout.assetShield,     href: '/assets',           icon: Shield,         desc: t.layout.descAsset },
  ];

  return (
    <div className="flex min-h-screen">
      {/* ===== Sidebar ===== */}
      <aside className="w-56 flex-shrink-0 bg-sidebar border-r border-border flex flex-col h-screen sticky top-0">
        {/* Logo */}
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-border">
          <img src="/logo.png" alt="XSafeClaw" className="w-10 h-10 rounded-lg shadow-lg shadow-accent/20" />
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-text-primary tracking-tight">{t.layout.brand}</span>
            <span className="text-[10px] font-semibold bg-accent/20 text-accent px-1.5 py-0.5 rounded">V0.1.1</span>
          </div>
        </div>

        {/* Nav Label */}
        <div className="px-5 pt-6 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{t.layout.nav}</p>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto px-3 space-y-0.5">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href || (item.href === '/monitor' && location.pathname === '/');
            return (
              <NavLink
                key={item.href}
                to={item.href}
                className={`
                  group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                  ${isActive
                    ? 'bg-accent/15 text-accent shadow-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
                  }
                `}
              >
                <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'}`} />
                <span>{item.name}</span>
                {isActive && (
                  <ChevronRight className="w-3.5 h-3.5 ml-auto text-accent/50" />
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom: theme toggle + lang toggle + status */}
        <div className="p-4 border-t border-border space-y-2">
          {/* Language toggle */}
          <button
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all"
          >
            <Languages className="w-4 h-4 text-accent flex-shrink-0" />
            <span className="text-[12px] font-medium">{t.layout.langToggle}</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all"
            title={theme === 'dark' ? t.layout.switchToLight : t.layout.switchToDark}
          >
            {theme === 'dark'
              ? <Sun className="w-4 h-4 text-warning flex-shrink-0" />
              : <Moon className="w-4 h-4 text-accent flex-shrink-0" />
            }
            <span className="text-[12px] font-medium">
              {theme === 'dark' ? t.layout.lightMode : t.layout.darkMode}
            </span>
          </button>

          {/* Status */}
          <div className="flex items-center gap-2.5 px-2 py-2 bg-surface-2 rounded-lg">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
            </span>
            <div>
              <p className="text-[11px] font-medium text-text-primary">{t.layout.systemOnline}</p>
              <p className="text-[10px] text-text-muted">{t.layout.allServicesRunning}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      <main className="flex-1 bg-surface-0 overflow-auto relative">
        <Outlet />
      </main>
    </div>
  );
}
