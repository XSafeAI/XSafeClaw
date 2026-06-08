export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const BUDGET_STORAGE_KEY = 'xsafeclaw:budget:settings';
export const RUNTIME_BUDGET_STORAGE_KEY = 'xsafeclaw:budget:runtime-settings:v1';

export type BudgetPeriodUnit = 'hour' | 'day';
export type RuntimeBudgetPlatform = 'openclaw' | 'hermes' | 'nanobot';

export type BudgetSettings = {
  maxCost: number | null;
  periodStartAt: number;
  baselineCost: number;
  updatedAt: number;
  periodValue?: number;
  periodUnit?: BudgetPeriodUnit;
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
    periodValue: 24,
    periodUnit: 'hour',
  };
}

export function defaultRuntimeBudgetSettings(now = Date.now()): BudgetSettings {
  return defaultBudgetSettings(now);
}

function normalizeBudgetSettings(value: Partial<BudgetSettings> | null | undefined, now: number): BudgetSettings {
  const parsed = value ?? {};
  const maxCost = Number(parsed.maxCost);
  const periodStartAt = Number(parsed.periodStartAt);
  const baselineCost = Number(parsed.baselineCost);
  const updatedAt = Number(parsed.updatedAt);
  const periodValue = Number(parsed.periodValue);
  const periodUnit = parsed.periodUnit === 'day' ? 'day' : 'hour';
  return {
    maxCost: Number.isFinite(maxCost) && maxCost > 0 ? maxCost : null,
    periodStartAt: Number.isFinite(periodStartAt) && periodStartAt > 0 ? periodStartAt : now,
    baselineCost: Number.isFinite(baselineCost) && baselineCost >= 0 ? baselineCost : 0,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now,
    periodValue: Number.isFinite(periodValue) && periodValue > 0 ? periodValue : 24,
    periodUnit,
  };
}

export function getBudgetPeriodMs(settings: BudgetSettings): number {
  const value = Number(settings.periodValue);
  const unit = settings.periodUnit === 'day' ? 'day' : 'hour';
  if (!Number.isFinite(value) || value <= 0) return DAY_MS;
  return value * (unit === 'day' ? DAY_MS : HOUR_MS);
}

export function loadBudgetSettings(now = Date.now()): BudgetSettings {
  try {
    const raw = localStorage.getItem(BUDGET_STORAGE_KEY);
    if (!raw) return defaultBudgetSettings(now);
    const parsed = JSON.parse(raw) as Partial<BudgetSettings>;
    return normalizeBudgetSettings(parsed, now);
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

export function loadRuntimeBudgetSettings(now = Date.now()): Record<RuntimeBudgetPlatform, BudgetSettings> {
  const defaults: Record<RuntimeBudgetPlatform, BudgetSettings> = {
    openclaw: defaultBudgetSettings(now),
    hermes: defaultBudgetSettings(now),
    nanobot: defaultBudgetSettings(now),
  };

  try {
    const raw = localStorage.getItem(RUNTIME_BUDGET_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<RuntimeBudgetPlatform, Partial<BudgetSettings>>>;
      return {
        openclaw: normalizeBudgetSettings(parsed.openclaw, now),
        hermes: normalizeBudgetSettings(parsed.hermes, now),
        nanobot: normalizeBudgetSettings(parsed.nanobot, now),
      };
    }

    const legacyRaw = localStorage.getItem(BUDGET_STORAGE_KEY);
    if (!legacyRaw) return defaults;
    const legacy = normalizeBudgetSettings(JSON.parse(legacyRaw) as Partial<BudgetSettings>, now);
    return {
      ...defaults,
      openclaw: legacy,
    };
  } catch {
    return defaults;
  }
}

export function saveRuntimeBudgetSettings(next: Record<RuntimeBudgetPlatform, BudgetSettings>) {
  try {
    localStorage.setItem(RUNTIME_BUDGET_STORAGE_KEY, JSON.stringify(next));
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
  const periodMs = getBudgetPeriodMs(settings);
  const periodEnd = settings.periodStartAt + periodMs;
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
  const budgetRemainingMs = Math.max(0, normalizedSettings.periodStartAt + getBudgetPeriodMs(normalizedSettings) - now);

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
