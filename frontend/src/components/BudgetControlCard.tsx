import { useEffect, useMemo, useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { statsAPI } from '../services/api';
import {
  formatResetCountdown,
  getBudgetStatus,
  loadBudgetSettings,
  saveBudgetSettings,
  type BudgetSettings,
} from '../utils/budgetControl';

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

type BudgetControlCardProps = {
  className?: string;
};

export default function BudgetControlCard({ className = '' }: BudgetControlCardProps) {
  const { t } = useI18n();
  const [budgetSettings, setBudgetSettings] = useState<BudgetSettings>(() => loadBudgetSettings());
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [dashboardCost, setDashboardCost] = useState(0);
  const [nowTs, setNowTs] = useState(() => Date.now());

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

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setBudgetInput(budgetLimit ? String(budgetLimit) : '');
          setBudgetModalOpen(true);
        }}
        className={`w-full text-left p-3 rounded-lg bg-surface-2 border border-border hover:border-accent/50 transition-all ${className}`}
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
    </>
  );
}
