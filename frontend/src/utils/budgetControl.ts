export const DAY_MS = 24 * 60 * 60 * 1000;
export const BUDGET_STORAGE_KEY = 'xsafeclaw:budget:settings';

export type BudgetSettings = {
  maxCost: number | null;
  periodStartAt: number;
  baselineCost: number;
  updatedAt: number;
};

export type BudgetStatus = {
  budgetLimit: number | null;
  budgetUsed: number;
  budgetPercent: number;
  budgetOverLimit: boolean;
  budgetRemainingMs: number;
  settings: BudgetSettings;
  settingsRolled: boolean;
};

function defaultBudgetSettings(now: number): BudgetSettings {
  return {
    maxCost: null,
    periodStartAt: now,
    baselineCost: 0,
    updatedAt: now,
  };
}

export function loadBudgetSettings(now = Date.now()): BudgetSettings {
  try {
    const raw = localStorage.getItem(BUDGET_STORAGE_KEY);
    if (!raw) return defaultBudgetSettings(now);
    const parsed = JSON.parse(raw) as Partial<BudgetSettings>;
    const maxCost = Number(parsed.maxCost);
    const periodStartAt = Number(parsed.periodStartAt);
    const baselineCost = Number(parsed.baselineCost);
    const updatedAt = Number(parsed.updatedAt);
    return {
      maxCost: Number.isFinite(maxCost) && maxCost > 0 ? maxCost : null,
      periodStartAt: Number.isFinite(periodStartAt) && periodStartAt > 0 ? periodStartAt : now,
      baselineCost: Number.isFinite(baselineCost) && baselineCost >= 0 ? baselineCost : 0,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now,
    };
  } catch {
    return defaultBudgetSettings(now);
  }
}

export function saveBudgetSettings(next: BudgetSettings) {
  try {
    localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota/storage errors
  }
}

export function formatResetCountdown(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalMinutes = Math.floor(clamped / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export function getBudgetStatus(
  settings: BudgetSettings,
  currentCost: number,
  now = Date.now(),
): BudgetStatus {
  const safeCost = Number.isFinite(currentCost) && currentCost >= 0 ? currentCost : 0;
  const periodEnd = settings.periodStartAt + DAY_MS;
  const settingsRolled = now >= periodEnd;
  const normalizedSettings: BudgetSettings = settingsRolled
    ? {
        ...settings,
        periodStartAt: now,
        baselineCost: safeCost,
        updatedAt: now,
      }
    : settings;

  const budgetLimit = normalizedSettings.maxCost;
  const budgetUsed = Math.max(0, safeCost - normalizedSettings.baselineCost);
  const budgetPercent = budgetLimit && budgetLimit > 0
    ? Math.min(100, (budgetUsed / budgetLimit) * 100)
    : 0;
  const budgetOverLimit = Boolean(budgetLimit && budgetUsed >= budgetLimit);
  const budgetRemainingMs = Math.max(0, normalizedSettings.periodStartAt + DAY_MS - now);

  return {
    budgetLimit,
    budgetUsed,
    budgetPercent,
    budgetOverLimit,
    budgetRemainingMs,
    settings: normalizedSettings,
    settingsRolled,
  };
}
