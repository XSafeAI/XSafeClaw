import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FolderOpen,
  Key,
  Loader2,
  Plug,
  Search,
  Settings2,
  Shield,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  systemAPI,
  type NanobotConfigPayload,
  type NanobotConfigResponse,
  type NanobotGuardMode,
  type NanobotProviderOption,
} from '../services/api';
import { useI18n } from '../i18n';

interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
  available?: boolean;
  input?: string;
}

interface ModelProviderInfo {
  id: string;
  name: string;
  models: ModelInfo[];
}

interface ModelChoice {
  id: string;
  label: string;
  provider: string;
  shortId: string;
  contextWindow: number;
  reasoning: boolean;
  source: 'catalog' | 'default';
}

type WizardMode = 'quickstart' | 'manual';

const copy = {
  zh: {
    eyebrow: 'Nanobot Configure',
    title: '配置 Nanobot 默认运行时',
    subtitle: '按步骤写入 ~/.nanobot/config.json。快速开始只配置模型与密钥，其余使用默认值。',
    loading: '正在读取 Nanobot 配置...',
    loadFailed: '读取 Nanobot 配置失败',
    catalogFailed: 'OpenClaw 模型目录暂不可用，已回退到当前 provider 的默认模型。',
    backSetup: '返回安装向导',
    enterValley: '进入 Agent Valley',
    editAgain: '继续编辑',
    commonBack: '返回',
    commonNext: '下一步',
    applying: '正在应用配置...',
    applyBtn: '应用配置',
    applyingBtn: '应用中...',
    saved: 'Nanobot 配置已保存',
    savedDesc: 'Nanobot 运行时已完成配置。修改 provider、model、gateway、WebSocket 或 token 后，请重启 nanobot gateway 让运行时加载最新配置。',
    savedPartial: '配置已保存但仍不完整',
    savedPartialDesc: '后端返回 provider/model 尚未完整配置，请返回向导补齐模型与密钥。',
    continueConfigure: '继续配置',
    errorFallback: '保存失败',
    steps: {
      security: '安全',
      mode: '模式',
      model: '模型与密钥',
      workspace: '工作区',
      gateway: 'Gateway',
      guard: 'Guard',
      finalize: '完成',
      review: '预览',
    },
    security: {
      title: '安全须知',
      prompt: '请在继续之前阅读',
      items: [
        'Nanobot 是在您的计算机上运行的本地智能体运行时',
        '启用后，智能体可能读取工作区文件、调用工具并发起网络请求',
        'XSafeClaw Guard 会在 Nanobot hook 中执行安全检查，但不能替代共享机器的访问控制',
        '如果多个用户共享此计算机，请只在可信环境中继续',
      ],
      recommend: '建议：默认只绑定本机地址，并保持 Guard 为阻断模式。',
      checkbox: '我理解 Nanobot 会在本机运行，且共享/多用户使用需要额外保护',
    },
    mode: {
      title: '引导模式',
      subtitle: '选择如何配置 Nanobot。',
      quickstart: '快速开始',
      quickstartDesc: '只填写模型与密钥，工作区、Gateway、WebSocket 与 Guard 使用默认值。',
      manual: '手动配置',
      manualDesc: '逐步检查工作区、Gateway、WebSocket 与 XSafeClaw Guard 设置。',
    },
    model: {
      title: '模型与密钥',
      subtitle: '先选择 provider，再从 OpenClaw 模型目录选择模型 ID；也可以手动输入。',
      provider: 'Provider',
      providerPlaceholder: '选择 provider...',
      providerHint: '首次打开不会预填 provider。选择 provider 后才能填写对应 API Key。',
      modelId: '模型 ID',
      chooseModel: '选择模型...',
      searchModels: '搜索模型...',
      catalogLoading: '正在读取 OpenClaw 模型目录...',
      defaultFallback: '默认推荐',
      reasoningTag: ' · 推理',
      enterManual: '手动输入模型 ID',
      backToList: '返回模型列表',
      manualPlaceholder: '例如 MiniMax-M2.7',
      storedAs: '将写入 Nanobot model：',
      noModels: '没有匹配模型，可手动输入模型 ID。',
      apiKey: 'API Key',
      apiKeyKeep: '留空表示复用已保存的 API Key',
      apiKeyNew: '当前 provider 没有已保存密钥，请填写 API Key 后继续',
      apiKeyNeedsProvider: '先选择 provider，才能编辑对应 API Key',
      apiBase: 'API Base',
      apiBasePlaceholder: '可选，例如 https://api.openai.com/v1',
      clearApiKey: '清除当前 provider 已保存的 API Key',
      clearApiKeyBlocked: '清除密钥后无法完成快速配置；如需替换密钥，请取消勾选并输入新 API Key。',
      secretStored: '已有密钥已保存',
      noSecret: '当前 provider 尚未保存密钥',
      validationProvider: '请选择 provider。',
      validationModel: '请选择或输入模型 ID。',
      validationKey: '当前 provider 没有已保存密钥，请填写 API Key。',
      validationClear: '当前将清除已保存密钥，请取消清除或填写新的 provider 密钥。',
    },
    workspace: {
      title: '工作区目录',
      subtitle: 'Nanobot 的会话、记忆和运行数据目录。',
      label: '工作目录',
    },
    gateway: {
      title: 'Gateway 与 WebSocket',
      subtitle: 'XSafeClaw 通过 Nanobot gateway health 与 WebSocket channel 识别、聊天和创建智能体。',
      gatewayHost: 'Gateway Host',
      gatewayPort: 'Gateway Port',
      websocketEnabled: '启用 WebSocket channel',
      websocketHost: 'WebSocket Host',
      websocketPort: 'WebSocket Port',
      websocketPath: 'WebSocket Path',
      websocketRequiresToken: 'WebSocket 需要 token',
      websocketToken: 'WebSocket Token',
    },
    guard: {
      title: 'XSafeClaw Guard',
      subtitle: '写入 Nanobot hook，让原生 nanobot agent/gateway 启动时加载 XSafeClaw 安全检查。',
      guardMode: 'Guard 模式',
      guardBaseUrl: 'Guard Base URL',
      guardTimeout: 'Guard Timeout',
      disabled: '关闭',
      observe: '观察',
      blocking: '阻断',
    },
    finalize: {
      title: '完成选项',
      desc: '向导已收集 Nanobot 默认运行时配置。下一步会预览即将写入的 ~/.nanobot/config.json。',
      quickstart: '快速开始会使用默认工作区、Gateway、WebSocket 和 Guard 设置。',
      manual: '手动配置会按你刚才填写的每一项写入。',
      restart: '保存后如已启动 nanobot gateway，请重启它以加载新配置。',
    },
    review: {
      title: '配置预览',
      mode: '模式',
      provider: 'Provider',
      model: 'Model',
      storedModel: '写入模型',
      apiKey: 'API Key',
      apiBase: 'API Base',
      workspace: '工作区',
      gateway: 'Gateway',
      websocket: 'WebSocket',
      wsToken: 'WebSocket Token',
      guard: 'Guard',
      guardUrl: 'Guard URL',
      configPath: '配置文件',
      quickstart: '快速开始',
      manual: '手动配置',
      newKey: '将写入新密钥',
      storedKey: '复用已保存密钥',
      none: '无',
      notSet: '未设置',
      enabled: '启用',
      disabled: '关闭',
      yes: '是',
      no: '否',
    },
  },
  en: {
    eyebrow: 'Nanobot Configure',
    title: 'Configure the default Nanobot runtime',
    subtitle: 'Write ~/.nanobot/config.json step by step. QuickStart only configures model and secret; everything else uses defaults.',
    loading: 'Reading Nanobot config...',
    loadFailed: 'Failed to read Nanobot config',
    catalogFailed: 'OpenClaw model catalog is unavailable, falling back to the selected provider default.',
    backSetup: 'Back to Setup',
    enterValley: 'Enter Agent Valley',
    editAgain: 'Edit Again',
    commonBack: 'Back',
    commonNext: 'Next',
    applying: 'Applying configuration...',
    applyBtn: 'Apply Configuration',
    applyingBtn: 'Applying...',
    saved: 'Nanobot config saved',
    savedDesc: 'The Nanobot runtime is configured. Restart nanobot gateway after changing provider, model, gateway, WebSocket, or token settings.',
    savedPartial: 'Config saved but still incomplete',
    savedPartialDesc: 'The backend reports provider/model is still incomplete. Return to the wizard and finish model setup.',
    continueConfigure: 'Continue Configuring',
    errorFallback: 'Save failed',
    steps: {
      security: 'Security',
      mode: 'Mode',
      model: 'Model',
      workspace: 'Workspace',
      gateway: 'Gateway',
      guard: 'Guard',
      finalize: 'Finalize',
      review: 'Review',
    },
    security: {
      title: 'Security Notice',
      prompt: 'Please read before continuing',
      items: [
        'Nanobot is a local agent runtime running on your machine',
        'Once enabled, agents may read workspace files, call tools, and make network requests',
        'XSafeClaw Guard runs through the Nanobot hook, but it is not a replacement for access control on shared machines',
        'If multiple users share this machine, continue only in a trusted environment',
      ],
      recommend: 'Recommended: bind to loopback by default and keep Guard in blocking mode.',
      checkbox: 'I understand Nanobot runs locally and shared/multi-user use requires extra protection',
    },
    mode: {
      title: 'Onboarding Mode',
      subtitle: 'Choose how you want to configure Nanobot.',
      quickstart: 'QuickStart',
      quickstartDesc: 'Only fill model and secret. Workspace, Gateway, WebSocket, and Guard use defaults.',
      manual: 'Manual',
      manualDesc: 'Review workspace, Gateway, WebSocket, and XSafeClaw Guard settings step by step.',
    },
    model: {
      title: 'Model and Secret',
      subtitle: 'Choose a provider first, then pick a model ID from the OpenClaw catalog or enter one manually.',
      provider: 'Provider',
      providerPlaceholder: 'Choose a provider...',
      providerHint: 'No provider is preselected on first load. Choose one before editing provider-specific secrets.',
      modelId: 'Model ID',
      chooseModel: 'Choose a model...',
      searchModels: 'Search models...',
      catalogLoading: 'Reading OpenClaw model catalog...',
      defaultFallback: 'Provider default',
      reasoningTag: ' · reasoning',
      enterManual: 'Enter model ID manually',
      backToList: 'Back to model list',
      manualPlaceholder: 'e.g. MiniMax-M2.7',
      storedAs: 'Will write Nanobot model:',
      noModels: 'No matching models. Enter a model ID manually.',
      apiKey: 'API Key',
      apiKeyKeep: 'Leave blank to reuse the stored API key',
      apiKeyNew: 'This provider has no stored key. Enter an API key before continuing',
      apiKeyNeedsProvider: 'Select a provider before editing its API key',
      apiBase: 'API Base',
      apiBasePlaceholder: 'Optional, for example https://api.openai.com/v1',
      clearApiKey: 'Clear the stored API key for this provider',
      clearApiKeyBlocked: 'Clearing the key prevents complete setup. To replace it, uncheck this and enter the new API key.',
      secretStored: 'Stored key exists',
      noSecret: 'No key stored for this provider',
      validationProvider: 'Choose a provider.',
      validationModel: 'Choose or enter a model ID.',
      validationKey: 'This provider has no stored key. Enter an API key.',
      validationClear: 'You are clearing the stored key. Uncheck clear or provide a usable provider key.',
    },
    workspace: {
      title: 'Workspace Directory',
      subtitle: 'Where Nanobot stores sessions, memory, and runtime data.',
      label: 'Workspace',
    },
    gateway: {
      title: 'Gateway and WebSocket',
      subtitle: 'XSafeClaw uses Nanobot gateway health and the WebSocket channel for discovery, chat, and agent creation.',
      gatewayHost: 'Gateway Host',
      gatewayPort: 'Gateway Port',
      websocketEnabled: 'Enable WebSocket channel',
      websocketHost: 'WebSocket Host',
      websocketPort: 'WebSocket Port',
      websocketPath: 'WebSocket Path',
      websocketRequiresToken: 'Require WebSocket token',
      websocketToken: 'WebSocket Token',
    },
    guard: {
      title: 'XSafeClaw Guard',
      subtitle: 'Writes a Nanobot hook so native nanobot agent/gateway loads XSafeClaw safety checks on startup.',
      guardMode: 'Guard Mode',
      guardBaseUrl: 'Guard Base URL',
      guardTimeout: 'Guard Timeout',
      disabled: 'Disabled',
      observe: 'Observe',
      blocking: 'Blocking',
    },
    finalize: {
      title: 'Finalize',
      desc: 'The wizard has collected the default Nanobot runtime config. The next step reviews what will be written to ~/.nanobot/config.json.',
      quickstart: 'QuickStart will use default workspace, Gateway, WebSocket, and Guard settings.',
      manual: 'Manual setup will write each value you just reviewed.',
      restart: 'After saving, restart nanobot gateway if it is already running.',
    },
    review: {
      title: 'Review Configuration',
      mode: 'Mode',
      provider: 'Provider',
      model: 'Model',
      storedModel: 'Stored model',
      apiKey: 'API Key',
      apiBase: 'API Base',
      workspace: 'Workspace',
      gateway: 'Gateway',
      websocket: 'WebSocket',
      wsToken: 'WebSocket Token',
      guard: 'Guard',
      guardUrl: 'Guard URL',
      configPath: 'Config file',
      quickstart: 'QuickStart',
      manual: 'Manual',
      newKey: 'Will write a new key',
      storedKey: 'Reuse stored key',
      none: 'None',
      notSet: 'Not set',
      enabled: 'Enabled',
      disabled: 'Disabled',
      yes: 'Yes',
      no: 'No',
    },
  },
};

type FormState = Omit<NanobotConfigPayload, 'provider' | 'model'> & {
  provider: string;
  model: string;
  clear_api_key: boolean;
};

function initialForm(): FormState {
  return {
    workspace: '~/.nanobot/workspace',
    provider: '',
    model: '',
    api_key: '',
    clear_api_key: false,
    api_base: '',
    gateway_host: '127.0.0.1',
    gateway_port: 18790,
    websocket_enabled: true,
    websocket_host: '127.0.0.1',
    websocket_port: 8765,
    websocket_path: '/',
    websocket_requires_token: false,
    websocket_token: '',
    guard_mode: 'blocking',
    guard_base_url: 'http://127.0.0.1:6874',
    guard_timeout_s: 305,
  };
}

function formFromConfig(config: NanobotConfigResponse): FormState {
  return {
    workspace: config.workspace || '~/.nanobot/workspace',
    provider: config.provider || '',
    model: config.model || '',
    api_key: '',
    clear_api_key: false,
    api_base: config.api_base || '',
    gateway_host: config.gateway.host || '127.0.0.1',
    gateway_port: config.gateway.port || 18790,
    websocket_enabled: config.websocket.enabled,
    websocket_host: config.websocket.host || '127.0.0.1',
    websocket_port: config.websocket.port || 8765,
    websocket_path: config.websocket.path || '/',
    websocket_requires_token: config.websocket.requires_token,
    websocket_token: '',
    guard_mode: config.guard.mode || 'blocking',
    guard_base_url: config.guard.base_url || 'http://127.0.0.1:6874',
    guard_timeout_s: config.guard.timeout_s || 305,
  };
}

function normalizeModelForProvider(provider: string, modelId: string): string {
  const trimmed = modelId.trim();
  const normalizedProvider = provider.trim();
  if (!trimmed || !normalizedProvider) return trimmed;
  const prefix = `${normalizedProvider}/`;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmed.slice(prefix.length);
  }
  return trimmed;
}

function displayModelRef(provider: string, model: string): string {
  const trimmedModel = model.trim();
  const trimmedProvider = provider.trim();
  if (!trimmedModel) return '';
  if (!trimmedProvider || trimmedModel.includes('/')) return trimmedModel;
  return `${trimmedProvider}/${trimmedModel}`;
}

function websocketUrl(form: FormState): string {
  const rawPath = form.websocket_path.trim() || '/';
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `ws://${form.websocket_host || '127.0.0.1'}:${form.websocket_port || 8765}${path}`;
}

function StepProgress({ current, skipped, labels }: { current: number; skipped: Set<number>; labels: string[] }) {
  return (
    <div className="flex items-center justify-center gap-0.5 mb-6">
      {labels.map((label, i) => {
        const done = i < current && !skipped.has(i);
        const active = i === current;
        const skip = skipped.has(i);
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-0.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all
                ${skip ? 'bg-surface-2/50 text-text-muted/30' : done ? 'bg-emerald-500 text-white' : active ? 'bg-accent text-white ring-2 ring-accent/40' : 'bg-surface-2 text-text-muted'}`}>
                {done ? <CheckCircle className="w-3 h-3" /> : i + 1}
              </div>
              <span className={`text-[8px] font-medium ${skip ? 'text-text-muted/30' : active ? 'text-accent' : done ? 'text-emerald-400' : 'text-text-muted'}`}>{label}</span>
            </div>
            {i < labels.length - 1 && <div className={`w-8 h-0.5 mx-0.5 mb-3 ${done && !skipped.has(i + 1) ? 'bg-emerald-500/60' : 'bg-border/50'}`} />}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-muted mt-1 leading-5">{hint}</p>}
    </div>
  );
}

function SearchableDropdown({
  label,
  value,
  displayValue,
  placeholder,
  searchPlaceholder,
  options,
  onSelect,
  renderOption,
  disabled = false,
}: {
  label?: string;
  value: string;
  displayValue: string;
  placeholder: string;
  searchPlaceholder: string;
  options: { id: string; label: string; hint?: string }[];
  onSelect: (id: string) => void;
  renderOption?: (opt: { id: string; label: string; hint?: string }, selected: boolean) => ReactNode;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const labels = copy[locale];
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const filtered = filter
    ? options.filter(o => `${o.label} ${o.id} ${o.hint || ''}`.toLowerCase().includes(filter.toLowerCase()))
    : options;

  return (
    <div>
      {label && <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{label}</label>}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-[13px] text-left hover:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
      >
        <span className={value ? 'text-text-primary font-medium' : 'text-text-muted'}>{value ? displayValue : placeholder}</span>
        <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 border border-border rounded-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={searchPlaceholder}
                autoFocus
                className="w-full bg-surface-0 border border-border rounded-lg pl-8 pr-3 py-2 text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onSelect(o.id);
                  setOpen(false);
                  setFilter('');
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all ${value === o.id ? 'bg-accent/15 text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}
              >
                {renderOption ? renderOption(o, value === o.id) : <>{o.label}{o.hint ? <span className="text-text-muted ml-1">{o.hint}</span> : null}</>}
              </button>
            ))}
            {filtered.length === 0 && <p className="text-[12px] text-text-muted p-3 text-center">{labels.model.noModels}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function SecurityStep({
  accepted,
  onAcceptedChange,
}: {
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
}) {
  const { locale } = useI18n();
  const labels = copy[locale].security;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-warning" /><h3 className="text-lg font-bold text-text-primary">{labels.title}</h3></div>
      <div className="bg-warning/5 border border-warning/20 rounded-xl p-5 text-[12px] text-text-secondary leading-relaxed space-y-2">
        <p className="font-semibold text-text-primary">{labels.prompt}</p>
        <ul className="list-disc pl-4 space-y-1">
          {labels.items.map((item: string) => <li key={item}>{item}</li>)}
        </ul>
        <p className="text-[11px] text-text-muted">{labels.recommend}</p>
      </div>
      <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-border hover:border-accent/30 transition-all">
        <input type="checkbox" checked={accepted} onChange={e => onAcceptedChange(e.target.checked)} className="w-4 h-4 rounded accent-accent" />
        <span className="text-[13px] font-medium text-text-primary">{labels.checkbox}</span>
      </label>
    </div>
  );
}

function ModeStep({
  wizardMode,
  onModeChange,
}: {
  wizardMode: WizardMode;
  onModeChange: (mode: WizardMode) => void;
}) {
  const { locale } = useI18n();
  const labels = copy[locale].mode;
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-text-primary">{labels.title}</h3>
      <p className="text-[13px] text-text-muted">{labels.subtitle}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { id: 'quickstart' as const, icon: Zap, title: labels.quickstart, desc: labels.quickstartDesc },
          { id: 'manual' as const, icon: Settings2, title: labels.manual, desc: labels.manualDesc },
        ].map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => onModeChange(o.id)}
            className={`p-5 rounded-xl border-2 text-left transition-all ${wizardMode === o.id ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/30'}`}
          >
            <o.icon className={`w-6 h-6 mb-3 ${wizardMode === o.id ? 'text-accent' : 'text-text-muted'}`} />
            <p className="text-[14px] font-semibold text-text-primary">{o.title}</p>
            <p className="text-[11px] text-text-muted mt-1 leading-5">{o.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelSecretStep({
  form,
  setField,
  providerOptions,
  modelOptions,
  selectedModelOption,
  providerHasKey,
  providerSelected,
  showApiKey,
  setShowApiKey,
  manualModel,
  setManualModel,
  modelCatalogLoading,
  modelCatalogError,
  onProviderChange,
  onModelSelect,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  providerOptions: NanobotProviderOption[];
  modelOptions: ModelChoice[];
  selectedModelOption?: ModelChoice;
  providerHasKey: boolean;
  providerSelected: boolean;
  showApiKey: boolean;
  setShowApiKey: (show: boolean) => void;
  manualModel: boolean;
  setManualModel: (manual: boolean) => void;
  modelCatalogLoading: boolean;
  modelCatalogError: string;
  onProviderChange: (provider: string) => void;
  onModelSelect: (id: string) => void;
}) {
  const { locale } = useI18n();
  const labels = copy[locale].model;
  const selectedProvider = providerOptions.find(option => option.id === form.provider);
  const selectedModelValue = selectedModelOption?.id || displayModelRef(form.provider, form.model);
  const selectedDisplay = selectedModelOption
    ? `${selectedModelOption.label}${selectedModelOption.contextWindow ? ` (${Math.round(selectedModelOption.contextWindow / 1024)}K)` : ''}`
    : displayModelRef(form.provider, form.model);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2"><Key className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{labels.title}</h3></div>
      <p className="text-[13px] text-text-muted">{labels.subtitle}</p>

      <Field label={labels.provider} hint={labels.providerHint}>
        <SearchableDropdown
          value={form.provider}
          displayValue={selectedProvider ? selectedProvider.name : form.provider}
          placeholder={labels.providerPlaceholder}
          searchPlaceholder={labels.providerPlaceholder}
          options={providerOptions.map(option => ({
            id: option.id,
            label: option.name,
            hint: option.default_model,
          }))}
          onSelect={onProviderChange}
        />
      </Field>

      {modelCatalogLoading && (
        <div className="flex items-center gap-2 text-[12px] text-accent">
          <Loader2 className="w-4 h-4 animate-spin" />
          {labels.catalogLoading}
        </div>
      )}
      {modelCatalogError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[12px] text-amber-200">
          <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0" />
          <span>{modelCatalogError}</span>
        </div>
      )}

      {!manualModel && modelOptions.length > 0 && (
        <Field label={labels.modelId} hint={`${labels.storedAs} ${form.model || '-'}`}>
          <SearchableDropdown
            value={selectedModelValue}
            displayValue={selectedDisplay}
            placeholder={labels.chooseModel}
            searchPlaceholder={labels.searchModels}
            options={modelOptions.map(model => ({
              id: model.id,
              label: model.label,
              hint: `${displayModelRef(model.provider, model.shortId)}${model.contextWindow ? ` · ${Math.round(model.contextWindow / 1024)}K` : ''}${model.reasoning ? labels.reasoningTag : ''}${model.source === 'default' ? ` · ${labels.defaultFallback}` : ''}`,
            }))}
            onSelect={onModelSelect}
            disabled={!providerSelected}
            renderOption={(option, selected) => (
              <div>
                <div className={selected ? 'text-accent' : 'text-text-primary'}>{option.label}</div>
                {option.hint && <div className="mt-0.5 text-[11px] text-text-muted font-normal">{option.hint}</div>}
              </div>
            )}
          />
          <button
            type="button"
            onClick={() => setManualModel(true)}
            className="text-[11px] text-accent mt-2 hover:underline disabled:opacity-40"
            disabled={!providerSelected}
          >
            {labels.enterManual}
          </button>
        </Field>
      )}

      {(manualModel || modelOptions.length === 0) && (
        <Field label={labels.modelId} hint={`${labels.storedAs} ${form.model || '-'}`}>
          <input
            type="text"
            value={form.model}
            onChange={e => setField('model', normalizeModelForProvider(form.provider, e.target.value))}
            placeholder={labels.manualPlaceholder}
            disabled={!providerSelected}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {modelOptions.length > 0 && (
            <button type="button" onClick={() => setManualModel(false)} className="text-[11px] text-accent mt-2 hover:underline">
              {labels.backToList}
            </button>
          )}
        </Field>
      )}

      <Field label={labels.apiKey} hint={providerSelected ? (providerHasKey ? labels.apiKeyKeep : labels.apiKeyNew) : labels.apiKeyNeedsProvider}>
        <div className="relative">
          <input
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
            type={showApiKey ? 'text' : 'password'}
            value={form.api_key || ''}
            onChange={e => setField('api_key', e.target.value)}
            placeholder={providerSelected ? (providerHasKey ? labels.secretStored : labels.noSecret) : labels.apiKeyNeedsProvider}
            disabled={!providerSelected || form.clear_api_key}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setShowApiKey(!showApiKey)}
            disabled={!providerSelected}
          >
            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </Field>

      <Field label={labels.apiBase} hint={labels.apiBasePlaceholder}>
        <input
          className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
          value={form.api_base || ''}
          onChange={e => setField('api_base', e.target.value)}
          placeholder="https://..."
          disabled={!providerSelected}
        />
      </Field>

      {providerSelected && providerHasKey && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-0 px-3 py-2.5 text-[13px] text-text-secondary">
            <input
              type="checkbox"
              checked={form.clear_api_key}
              onChange={e => setField('clear_api_key', e.target.checked)}
            />
            {labels.clearApiKey}
          </label>
          {form.clear_api_key && <p className="text-[11px] leading-5 text-amber-300">{labels.clearApiKeyBlocked}</p>}
        </div>
      )}
    </div>
  );
}

function WorkspaceStep({
  form,
  setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const { locale } = useI18n();
  const labels = copy[locale].workspace;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><FolderOpen className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{labels.title}</h3></div>
      <p className="text-[13px] text-text-muted">{labels.subtitle}</p>
      <Field label={labels.label}>
        <input
          type="text"
          value={form.workspace}
          onChange={e => setField('workspace', e.target.value)}
          className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </Field>
    </div>
  );
}

function GatewayStep({
  form,
  setField,
  showWsToken,
  setShowWsToken,
  hasWsToken,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  showWsToken: boolean;
  setShowWsToken: (show: boolean) => void;
  hasWsToken: boolean;
}) {
  const { locale } = useI18n();
  const labels = copy[locale].gateway;
  const modelLabels = copy[locale].model;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Plug className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{labels.title}</h3></div>
      <p className="text-[13px] text-text-muted">{labels.subtitle}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={labels.gatewayHost}>
          <input className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" value={form.gateway_host} onChange={e => setField('gateway_host', e.target.value)} />
        </Field>
        <Field label={labels.gatewayPort}>
          <input className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" type="number" min={1} max={65535} value={form.gateway_port} onChange={e => setField('gateway_port', Number(e.target.value) || 18790)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-0 px-3 py-2.5 text-[13px] text-text-secondary">
        <input type="checkbox" checked={form.websocket_enabled} onChange={e => setField('websocket_enabled', e.target.checked)} />
        {labels.websocketEnabled}
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={labels.websocketHost}>
          <input className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50" value={form.websocket_host} onChange={e => setField('websocket_host', e.target.value)} disabled={!form.websocket_enabled} />
        </Field>
        <Field label={labels.websocketPort}>
          <input className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50" type="number" min={1} max={65535} value={form.websocket_port} onChange={e => setField('websocket_port', Number(e.target.value) || 8765)} disabled={!form.websocket_enabled} />
        </Field>
        <Field label={labels.websocketPath}>
          <input className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50" value={form.websocket_path} onChange={e => setField('websocket_path', e.target.value)} disabled={!form.websocket_enabled} />
        </Field>
        <div className="flex items-end">
          <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface-0 px-3 py-2.5 text-[13px] text-text-secondary">
            <input type="checkbox" checked={form.websocket_requires_token} onChange={e => setField('websocket_requires_token', e.target.checked)} disabled={!form.websocket_enabled} />
            {labels.websocketRequiresToken}
          </label>
        </div>
      </div>
      {form.websocket_requires_token && (
        <Field label={labels.websocketToken}>
          <div className="relative">
            <input
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
              type={showWsToken ? 'text' : 'password'}
              value={form.websocket_token || ''}
              onChange={e => setField('websocket_token', e.target.value)}
              placeholder={hasWsToken ? modelLabels.apiKeyKeep : labels.websocketToken}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              onClick={() => setShowWsToken(!showWsToken)}
            >
              {showWsToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
      )}
    </div>
  );
}

function GuardStep({
  form,
  setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const { locale } = useI18n();
  const labels = copy[locale].guard;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{labels.title}</h3></div>
      <p className="text-[13px] text-text-muted">{labels.subtitle}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={labels.guardMode}>
          <select
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
            value={form.guard_mode}
            onChange={e => setField('guard_mode', e.target.value as NanobotGuardMode)}
          >
            <option value="disabled">{labels.disabled}</option>
            <option value="observe">{labels.observe}</option>
            <option value="blocking">{labels.blocking}</option>
          </select>
        </Field>
        <Field label={labels.guardTimeout}>
          <input className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" type="number" min={1} value={form.guard_timeout_s} onChange={e => setField('guard_timeout_s', Number(e.target.value) || 305)} />
        </Field>
      </div>
      <Field label={labels.guardBaseUrl}>
        <input
          className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
          value={form.guard_base_url}
          onChange={e => setField('guard_base_url', e.target.value)}
          disabled={form.guard_mode === 'disabled'}
        />
      </Field>
    </div>
  );
}

function FinalizeStep({ wizardMode }: { wizardMode: WizardMode }) {
  const { locale } = useI18n();
  const labels = copy[locale].finalize;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-400" /><h3 className="text-lg font-bold text-text-primary">{labels.title}</h3></div>
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-[13px] leading-7 text-text-secondary">
        <p className="font-semibold text-text-primary">{labels.desc}</p>
        <p className="mt-2">{wizardMode === 'quickstart' ? labels.quickstart : labels.manual}</p>
        <p className="mt-2 text-[12px] text-text-muted">{labels.restart}</p>
      </div>
    </div>
  );
}

function ReviewStep({
  form,
  wizardMode,
  providerName,
  providerHasKey,
  submitting,
  configPath,
}: {
  form: FormState;
  wizardMode: WizardMode;
  providerName: string;
  providerHasKey: boolean;
  submitting: boolean;
  configPath: string;
}) {
  const { locale } = useI18n();
  const labels = copy[locale].review;
  const rows: [string, string][] = [
    [labels.mode, wizardMode === 'quickstart' ? labels.quickstart : labels.manual],
    [labels.provider, providerName || form.provider || labels.notSet],
    [labels.model, displayModelRef(form.provider, form.model) || labels.notSet],
    [labels.storedModel, form.model || labels.notSet],
    [labels.apiKey, form.api_key?.trim() ? labels.newKey : providerHasKey ? labels.storedKey : labels.none],
    [labels.apiBase, form.api_base || labels.notSet],
    [labels.workspace, form.workspace],
    [labels.gateway, `${form.gateway_host || '127.0.0.1'}:${form.gateway_port || 18790}`],
    [labels.websocket, form.websocket_enabled ? `${labels.enabled} (${websocketUrl(form)})` : labels.disabled],
    [labels.wsToken, form.websocket_requires_token ? (form.websocket_token ? labels.newKey : labels.storedKey) : labels.no],
    [labels.guard, form.guard_mode],
    [labels.guardUrl, form.guard_mode === 'disabled' ? labels.disabled : form.guard_base_url],
    [labels.configPath, configPath || '~/.nanobot/config.json'],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-400" /><h3 className="text-lg font-bold text-text-primary">{labels.title}</h3></div>
      <div className="bg-surface-0 border border-border rounded-xl overflow-hidden">
        <table className="w-full text-[12px]"><tbody>
          {rows.map(([key, value]) => (
            <tr key={key} className="border-b border-border/40 last:border-b-0">
              <td className="px-4 py-2 text-text-muted font-medium w-36">{key}</td>
              <td className="px-4 py-2 text-text-primary font-mono break-all">{value}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
      {submitting && <div className="flex items-center gap-2 text-accent text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> {copy[locale].applying}</div>}
    </div>
  );
}

export default function NanobotConfigure() {
  const { locale } = useI18n();
  const labels = copy[locale];
  const [config, setConfig] = useState<NanobotConfigResponse | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [step, setStep] = useState(0);
  const [wizardMode, setWizardMode] = useState<WizardMode>('quickstart');
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedModelConfigured, setSavedModelConfigured] = useState(false);
  const [error, setError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showWsToken, setShowWsToken] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const [modelProviders, setModelProviders] = useState<ModelProviderInfo[]>([]);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await systemAPI.getNanobotConfig();
        if (cancelled) return;
        setConfig(res.data);
        setForm(formFromConfig(res.data));
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.detail || err?.message || labels.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [labels.loadFailed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setModelCatalogLoading(true);
      setModelCatalogError('');
      try {
        const res = await systemAPI.onboardScan();
        if (cancelled) return;
        const data = res.data as { model_providers?: ModelProviderInfo[] };
        setModelProviders(Array.isArray(data.model_providers) ? data.model_providers : []);
      } catch {
        if (!cancelled) setModelCatalogError(labels.catalogFailed);
      } finally {
        if (!cancelled) setModelCatalogLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [labels.catalogFailed]);

  const providerOptions = config?.provider_options || [];
  const providerSelected = Boolean(form.provider.trim());
  const providerState = providerSelected ? config?.provider_configs?.[form.provider] : undefined;
  const providerHasKey = Boolean(providerState?.has_api_key);
  const selectedProvider = providerOptions.find(option => option.id === form.provider);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const modelOptions = useMemo(() => {
    const provider = form.provider.trim();
    if (!provider) return [];
    const seen = new Set<string>();
    const choices: ModelChoice[] = [];

    const pushChoice = (model: ModelInfo, providerId: string, source: 'catalog' | 'default') => {
      const rawId = String(model.id || '').trim();
      if (!rawId) return;
      const key = `${source}:${rawId.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      choices.push({
        id: rawId,
        label: model.name || normalizeModelForProvider(provider, rawId),
        provider: providerId || provider,
        shortId: normalizeModelForProvider(provider, rawId),
        contextWindow: Number(model.contextWindow || 0),
        reasoning: Boolean(model.reasoning),
        source,
      });
    };

    modelProviders.forEach(providerInfo => {
      const providerId = String(providerInfo.id || '').trim();
      const providerMatches = providerId.toLowerCase() === provider.toLowerCase();
      (providerInfo.models || []).forEach(model => {
        const modelId = String(model.id || '').trim();
        const idMatches = modelId.toLowerCase().startsWith(`${provider.toLowerCase()}/`);
        if (providerMatches || idMatches) pushChoice(model, providerId || provider, 'catalog');
      });
    });

    if (choices.length === 0 && selectedProvider?.default_model) {
      pushChoice(
        {
          id: selectedProvider.default_model,
          name: normalizeModelForProvider(provider, selectedProvider.default_model),
        },
        provider,
        'default',
      );
    }

    return choices.sort((a, b) => Number(a.source === 'default') - Number(b.source === 'default') || a.label.localeCompare(b.label));
  }, [form.provider, modelProviders, selectedProvider]);

  const selectedModelOption = useMemo(() => {
    const model = form.model.trim();
    if (!model) return undefined;
    const fullRef = displayModelRef(form.provider, model);
    return modelOptions.find(option => option.shortId === model || option.id === model || option.id === fullRef);
  }, [form.model, form.provider, modelOptions]);

  const modelValidation = useMemo(() => {
    if (!form.provider.trim()) return labels.model.validationProvider;
    if (!form.model.trim()) return labels.model.validationModel;
    if (form.clear_api_key) return labels.model.validationClear;
    if (!providerHasKey && !form.api_key?.trim()) return labels.model.validationKey;
    return '';
  }, [form.api_key, form.clear_api_key, form.model, form.provider, labels.model, providerHasKey]);

  const skipped = useMemo(() => {
    const result = new Set<number>();
    if (wizardMode === 'quickstart') [3, 4, 5].forEach(index => result.add(index));
    return result;
  }, [wizardMode]);

  const canNext = useMemo(() => {
    if (step === 0) return riskAccepted;
    if (step === 2) return !modelValidation;
    return true;
  }, [modelValidation, riskAccepted, step]);

  const handleProviderChange = (provider: string) => {
    const nextState = provider ? config?.provider_configs?.[provider] : undefined;
    setForm(prev => ({
      ...prev,
      provider,
      model: provider === prev.provider ? prev.model : '',
      api_base: nextState?.api_base || '',
      api_key: '',
      clear_api_key: false,
    }));
    setManualModel(false);
    setShowApiKey(false);
  };

  const handleModelSelect = (modelId: string) => {
    setField('model', normalizeModelForProvider(form.provider, modelId));
  };

  const goNext = () => {
    let next = step + 1;
    while (next < 8 && skipped.has(next)) next++;
    if (next > 7) next = 7;
    setStep(next);
    setError('');
  };

  const goBack = () => {
    let next = step - 1;
    while (next >= 0 && skipped.has(next)) next--;
    if (next < 0) next = 0;
    setStep(next);
    setError('');
  };

  const handleSubmit = async () => {
    if (modelValidation) {
      setError(modelValidation);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload: NanobotConfigPayload = {
        ...form,
        provider: form.provider.trim(),
        model: normalizeModelForProvider(form.provider, form.model),
        api_key: form.api_key?.trim() || null,
        clear_api_key: form.clear_api_key,
        api_base: form.api_base?.trim() || null,
        websocket_token: form.websocket_token?.trim() || null,
      };
      const res = await systemAPI.setNanobotConfig(payload);
      setConfig(res.data);
      setForm(formFromConfig(res.data));
      setSavedModelConfigured(Boolean(res.data.model_configured));
      setSaved(true);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : detail?.message || err?.message || labels.errorFallback);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center">
        <div className="flex items-center gap-3 text-text-secondary">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          {labels.loading}
        </div>
      </div>
    );
  }

  if (saved) {
    const complete = savedModelConfigured;
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <div className="flex flex-col items-center gap-3 mb-8">
            <img src="/logo.png" alt="XSafeClaw" className="w-16 h-16 object-contain rounded-xl shadow-lg shadow-accent/25" />
          </div>
          <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
            <div className="flex flex-col items-center gap-6 py-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${complete ? 'bg-emerald-500/15' : 'bg-amber-500/15'}`}>
                {complete ? <CheckCircle className="w-9 h-9 text-emerald-400" /> : <AlertTriangle className="w-9 h-9 text-amber-300" />}
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-text-primary">{complete ? labels.saved : labels.savedPartial}</p>
                <p className="text-[13px] text-text-secondary mt-2 leading-6">{complete ? labels.savedDesc : labels.savedPartialDesc}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                {complete && (
                  <button
                    type="button"
                    onClick={() => window.location.replace('/agent-valley')}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/25"
                  >
                    <Settings2 className="w-4 h-4" /> {labels.enterValley} <ChevronRight className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSaved(false);
                    setStep(2);
                  }}
                  className="flex items-center justify-center gap-2 px-6 py-3 border border-border bg-surface-0 text-text-secondary hover:text-text-primary font-semibold rounded-xl transition-all"
                >
                  {complete ? labels.editAgain : labels.continueConfigure}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stepLabels = Object.values(labels.steps);

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src="/logo.png" alt="XSafeClaw" className="w-12 h-12 object-contain rounded-xl shadow-lg shadow-accent/25" />
          <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            <Bot className="w-3.5 h-3.5" />
            {labels.eyebrow}
          </div>
          <p className="text-[13px] text-text-muted text-center max-w-2xl">{labels.title}</p>
          <p className="text-[12px] text-text-muted text-center max-w-2xl">{labels.subtitle}</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <StepProgress current={step} skipped={skipped} labels={stepLabels} />

          {step === 0 && <SecurityStep accepted={riskAccepted} onAcceptedChange={setRiskAccepted} />}
          {step === 1 && <ModeStep wizardMode={wizardMode} onModeChange={setWizardMode} />}
          {step === 2 && (
            <ModelSecretStep
              form={form}
              setField={setField}
              providerOptions={providerOptions}
              modelOptions={modelOptions}
              selectedModelOption={selectedModelOption}
              providerHasKey={providerHasKey}
              providerSelected={providerSelected}
              showApiKey={showApiKey}
              setShowApiKey={setShowApiKey}
              manualModel={manualModel}
              setManualModel={setManualModel}
              modelCatalogLoading={modelCatalogLoading}
              modelCatalogError={modelCatalogError}
              onProviderChange={handleProviderChange}
              onModelSelect={handleModelSelect}
            />
          )}
          {step === 3 && <WorkspaceStep form={form} setField={setField} />}
          {step === 4 && <GatewayStep form={form} setField={setField} showWsToken={showWsToken} setShowWsToken={setShowWsToken} hasWsToken={Boolean(config?.websocket.has_token)} />}
          {step === 5 && <GuardStep form={form} setField={setField} />}
          {step === 6 && <FinalizeStep wizardMode={wizardMode} />}
          {step === 7 && (
            <ReviewStep
              form={form}
              wizardMode={wizardMode}
              providerName={selectedProvider?.name || form.provider}
              providerHasKey={providerHasKey}
              submitting={saving}
              configPath={config?.config_path || '~/.nanobot/config.json'}
            />
          )}

          {step === 2 && modelValidation && (
            <div className="flex items-center gap-2 mt-4 text-amber-300 text-[12px]">
              <AlertTriangle className="w-4 h-4" /> {modelValidation}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 mt-4 text-red-400 text-[12px]">
              <XCircle className="w-4 h-4" /> {error}
            </div>
          )}

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text-primary disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="w-4 h-4" /> {labels.commonBack}
            </button>
            {step < 7 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!canNext}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-40 text-white text-[13px] font-semibold rounded-xl transition-all shadow-lg shadow-accent/25"
              >
                {labels.commonNext} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[13px] font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/25"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {saving ? labels.applyingBtn : labels.applyBtn}
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-text-muted mt-6">Powered by XSafeClaw</p>
      </div>
    </div>
  );
}
