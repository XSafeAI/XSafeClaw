import type { CodexModelCatalogItem, CodexSpeedTierOption } from '../services/api';

export type CodexModelOption = string;
export type CodexReasoningLevel = string;
export type CodexSpeedOption = string;

export const CODEX_STANDARD_SPEED_ID = 'standard';

export const FALLBACK_CODEX_MODEL_CATALOG: CodexModelCatalogItem[] = [
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    display_name: 'GPT-5.5',
    is_default: true,
    default_reasoning_effort: 'medium',
    supported_reasoning_efforts: ['low', 'medium', 'high', 'xhigh'],
    service_tiers: [
      { id: CODEX_STANDARD_SPEED_ID, name: 'Standard', description: 'Default speed', service_tier: null },
      { id: 'priority', name: 'Fast', description: '1.5x speed, increased usage', service_tier: 'priority' },
    ],
  },
  {
    id: 'gpt-5.4',
    model: 'gpt-5.4',
    display_name: 'GPT-5.4',
    is_default: false,
    default_reasoning_effort: 'medium',
    supported_reasoning_efforts: ['low', 'medium', 'high', 'xhigh'],
    service_tiers: [
      { id: CODEX_STANDARD_SPEED_ID, name: 'Standard', description: 'Default speed', service_tier: null },
      { id: 'priority', name: 'Fast', description: '1.5x speed, increased usage', service_tier: 'priority' },
    ],
  },
  {
    id: 'gpt-5.4-mini',
    model: 'gpt-5.4-mini',
    display_name: 'GPT-5.4-Mini',
    is_default: false,
    default_reasoning_effort: 'medium',
    supported_reasoning_efforts: ['low', 'medium', 'high'],
    service_tiers: [
      { id: CODEX_STANDARD_SPEED_ID, name: 'Standard', description: 'Default speed', service_tier: null },
    ],
  },
  {
    id: 'gpt-5.3-codex-spark',
    model: 'gpt-5.3-codex-spark',
    display_name: 'GPT-5.3-Codex-Spark',
    is_default: false,
    default_reasoning_effort: 'high',
    supported_reasoning_efforts: ['low', 'medium', 'high'],
    service_tiers: [
      { id: CODEX_STANDARD_SPEED_ID, name: 'Standard', description: 'Default speed', service_tier: null },
    ],
  },
];

const LEGACY_MODEL_TO_ID: Record<string, string> = {
  'GPT-5.5': 'gpt-5.5',
  'GPT-5.4': 'gpt-5.4',
  'GPT-5.4-Mini': 'gpt-5.4-mini',
  'GPT-5.3-Codex-Spark': 'gpt-5.3-codex-spark',
};

const LEGACY_SPEED_TO_ID: Record<string, string> = {
  fast: 'priority',
};

export function catalogModelsOrFallback(models?: CodexModelCatalogItem[] | null): CodexModelCatalogItem[] {
  return models?.length ? models : FALLBACK_CODEX_MODEL_CATALOG;
}

export function codexModelId(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (!text) return FALLBACK_CODEX_MODEL_CATALOG[0].id;
  return LEGACY_MODEL_TO_ID[text] ?? text;
}

export function findCodexModel(
  models: CodexModelCatalogItem[],
  value: string | null | undefined,
): CodexModelCatalogItem {
  const modelId = codexModelId(value);
  return models.find(model => model.id === modelId || model.model === modelId)
    ?? models.find(model => model.is_default)
    ?? models[0]
    ?? FALLBACK_CODEX_MODEL_CATALOG[0];
}

export function codexModelDisplayName(
  models: CodexModelCatalogItem[],
  value: string | null | undefined,
): string {
  const model = findCodexModel(models, value);
  return model.display_name || model.model || model.id;
}

export function shortCodexModelDisplay(
  models: CodexModelCatalogItem[],
  value: string | null | undefined,
): string {
  const display = codexModelDisplayName(models, value);
  return display
    .replace(/^GPT-/i, '')
    .replace(/Codex-Spark/i, 'Spark')
    .trim();
}

export function codexReasoningOptionsForModel(model: CodexModelCatalogItem): string[] {
  return model.supported_reasoning_efforts.length
    ? model.supported_reasoning_efforts
    : ['low', 'medium', 'high', 'xhigh'];
}

export function codexSpeedOptionsForModel(model: CodexModelCatalogItem): CodexSpeedTierOption[] {
  return model.service_tiers.length
    ? model.service_tiers
    : [{ id: CODEX_STANDARD_SPEED_ID, name: 'Standard', description: 'Default speed', service_tier: null }];
}

export function normalizeCodexSpeedId(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (!text) return CODEX_STANDARD_SPEED_ID;
  return LEGACY_SPEED_TO_ID[text] ?? text;
}

export function normalizeCodexSelection<T extends {
  defaultModel: string;
  defaultReasoning: string;
  defaultSpeed: string;
}>(
  config: T,
  models: CodexModelCatalogItem[],
): T {
  const model = findCodexModel(models, config.defaultModel);
  const reasoningOptions = codexReasoningOptionsForModel(model);
  const speedOptions = codexSpeedOptionsForModel(model);
  const nextReasoning = reasoningOptions.includes(config.defaultReasoning)
    ? config.defaultReasoning
    : (model.default_reasoning_effort && reasoningOptions.includes(model.default_reasoning_effort))
      ? model.default_reasoning_effort
      : reasoningOptions[0];
  const normalizedSpeed = normalizeCodexSpeedId(config.defaultSpeed);
  const nextSpeed = speedOptions.some(option => option.id === normalizedSpeed)
    ? normalizedSpeed
    : CODEX_STANDARD_SPEED_ID;
  return {
    ...config,
    defaultModel: model.id,
    defaultReasoning: nextReasoning,
    defaultSpeed: nextSpeed,
  };
}

export function codexSpeedServiceTier(
  models: CodexModelCatalogItem[],
  modelValue: string,
  speedValue: string,
): string {
  const model = findCodexModel(models, modelValue);
  const speedId = normalizeCodexSpeedId(speedValue);
  const speed = codexSpeedOptionsForModel(model).find(option => option.id === speedId);
  if (!speed || speed.id === CODEX_STANDARD_SPEED_ID) return CODEX_STANDARD_SPEED_ID;
  return speed.service_tier || speed.id;
}
