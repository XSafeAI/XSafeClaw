import { useMemo, useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Shield, Monitor, ChevronRight, MessageSquare, Sun, Moon, Languages, Activity, FlaskConical, Wallet, X, type LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import { statsAPI, systemAPI } from '../services/api';
import {
  loadBudgetSettings,
  saveBudgetSettings,
  getBudgetStatus,
  formatResetCountdown,
  type BudgetSettings,
} from '../utils/budgetControl';

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

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
  const [packageVersion, setPackageVersion] = useState<string | null>(null);
  const [budgetSettings, setBudgetSettings] = useState<BudgetSettings>(() => loadBudgetSettings());
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [dashboardCost, setDashboardCost] = useState(0);
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await systemAPI.installStatus();
        if (!cancelled && data.xsafeclaw_version) {
          setPackageVersion(data.xsafeclaw_version);
        }
      } catch {
        // ignore — keep badge empty or fallback below
      }
    })();
    return () => { cancelled = true; };
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
        // ignore stats polling errors and keep last known value
      }
    };
    pullDashboardCost();
    const timer = setInterval(pullDashboardCost, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const budgetStatus = useMemo(
    () => getBudgetStatus(budgetSettings, dashboardCost, nowTs),
    [budgetSettings, dashboardCost, nowTs],
  );
  const {
    budgetUsed,
    budgetLimit,
    budgetPercent,
    budgetOverLimit,
    budgetRemainingMs,
  } = budgetStatus;

  useEffect(() => {
    if (!budgetStatus.settingsRolled) return;
    setBudgetSettings(budgetStatus.settings);
    saveBudgetSettings(budgetStatus.settings);
  }, [budgetStatus]);

  const navigation: Array<{
    name: string;
    href: string;
    icon: LucideIcon;
    desc: string;
  }> = [
    { name: t.layout.agentTown,       href: '/agent-valley',     icon: Activity,      desc: t.layout.agentTownDesc },
    { name: t.layout.clawMonitor,     href: '/monitor',          icon: Monitor,        desc: t.layout.descMonitor },
    { name: t.layout.safeChat,        href: '/chat',             icon: MessageSquare,  desc: t.layout.descChat },
    { name: t.layout.assetShield,     href: '/assets',           icon: Shield,         desc: t.layout.descAsset },
    { name: t.layout.riskTest,        href: '/risk-test',        icon: FlaskConical,   desc: t.layout.descRiskTest },
  ];

  return (
    <div className="flex min-h-screen">
      {/* ===== Sidebar ===== */}
      <aside className="w-56 flex-shrink-0 bg-sidebar border-r border-border flex flex-col h-screen sticky top-0">
        {/* Logo */}
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-border">
          <img src="/logo.png" alt="XSafeClaw" className="w-10 h-10 object-contain" />
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-text-primary tracking-tight">{t.layout.brand}</span>
            <span className="text-[10px] font-semibold bg-accent/20 text-accent px-1.5 py-0.5 rounded" title="XSafeClaw package version">
              {packageVersion ? `v${packageVersion}` : 'v?'}
            </span>
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
        <div className="p-4 border-t border-border space-y-2 flex-shrink-0">
          {/* Budget card */}
          <button
            type="button"
            onClick={() => {
              setBudgetInput(budgetLimit ? String(budgetLimit) : '');
              setBudgetModalOpen(true);
            }}
            className="w-full text-left p-3 rounded-lg bg-surface-2 border border-border hover:border-accent/50 transition-all"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-[0.08em] text-text-muted">{t.layout.budgetTitle}</span>
              <Wallet className={`w-4 h-4 ${budgetOverLimit ? 'text-warning' : 'text-accent'}`} />
            </div>
            <div className="text-[18px] leading-none font-bold text-text-primary">
              {formatMoney(budgetUsed)}
              <span className="text-[12px] font-medium text-text-muted">
                {' '}
                / {budgetLimit ? formatMoney(budgetLimit) : t.layout.budgetNotSet}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-surface-0 overflow-hidden">
              <div
                className={`h-full transition-all ${budgetOverLimit ? 'bg-warning' : 'bg-emerald-400'}`}
                style={{ width: `${Math.max(4, budgetPercent)}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className={budgetOverLimit ? 'text-warning' : 'text-text-muted'}>
                {budgetLimit
                  ? t.layout.budgetUsagePercent.replace('{percent}', String(Math.round(budgetPercent)))
                  : t.layout.budgetNoLimitHint}
              </span>
              <span className="text-text-muted">
                {t.layout.budgetResetsIn.replace('{time}', formatResetCountdown(budgetRemainingMs))}
              </span>
            </div>
          </button>

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

      {budgetModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1 border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-text-primary">{t.layout.budgetModalTitle}</h3>
                <p className="text-[12px] text-text-muted mt-1">{t.layout.budgetModalDesc}</p>
              </div>
              <button
                type="button"
                onClick={() => setBudgetModalOpen(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="block text-[12px] text-text-secondary mb-1.5">
              {t.layout.budgetMaxLabel}
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-0 px-3 py-2.5 mb-2">
              <span className="text-text-muted text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="10.00"
                className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-text-muted mb-5">{t.layout.budgetCycleHint}</p>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setBudgetModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-border text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  const parsed = Number(budgetInput);
                  if (!Number.isFinite(parsed) || parsed <= 0) return;
                  const now = Date.now();
                  const next: BudgetSettings = {
                    maxCost: parsed,
                    periodStartAt: now,
                    baselineCost: dashboardCost,
                    updatedAt: now,
                  };
                  setBudgetSettings(next);
                  saveBudgetSettings(next);
                  setBudgetModalOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl text-white bg-accent hover:bg-accent-dim text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!Number.isFinite(Number(budgetInput)) || Number(budgetInput) <= 0}
              >
                {t.common.save}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const now = Date.now();
                const next: BudgetSettings = {
                  maxCost: null,
                  periodStartAt: now,
                  baselineCost: dashboardCost,
                  updatedAt: now,
                };
                setBudgetSettings(next);
                saveBudgetSettings(next);
                setBudgetInput('');
                setBudgetModalOpen(false);
              }}
              className="w-full mt-3 py-2 text-[12px] text-text-muted hover:text-text-primary transition-colors"
            >
              {t.layout.budgetClear}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
