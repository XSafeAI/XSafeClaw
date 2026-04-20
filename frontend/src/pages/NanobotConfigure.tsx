import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  ChevronRight,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Plug,
  Save,
  Server,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import {
  systemAPI,
  type NanobotConfigPayload,
  type NanobotConfigResponse,
  type NanobotGuardMode,
} from '../services/api';
import { useI18n } from '../i18n';

const copy = {
  zh: {
    eyebrow: 'Nanobot Configure',
    title: '配置 Nanobot 默认运行时',
    subtitle: '点击保存后才会写入 ~/.nanobot/config.json。首次打开不会预填 provider、model 或 API Key。',
    loading: '正在读取 Nanobot 配置...',
    loadFailed: '读取 Nanobot 配置失败',
    modelSection: '模型与密钥',
    modelSectionDesc: 'Provider、模型和 API Key 需要你手动填写。你也可以先只保存 workspace、gateway、WebSocket 和 Guard 基础配置。',
    provider: 'Provider',
    providerPlaceholder: '暂不选择，先保存基础配置',
    providerHint: '不预填默认 provider。先选 provider 后才能编辑对应 API Key。',
    model: '模型 ID',
    modelHint: '留空表示稍后再选模型。',
    apiKey: 'API Key',
    apiKeyKeep: '留空表示保留已保存的 API Key',
    apiKeyNew: '为当前 provider 写入新的 API Key',
    apiKeyNeedsProvider: '先选择 provider，才能编辑对应 API Key',
    clearApiKey: '清除当前 provider 已保存的 API Key',
    apiBase: 'API Base',
    apiBasePlaceholder: '可选，例如 https://api.openai.com/v1',
    workspaceSection: 'Workspace',
    workspaceSectionDesc: 'Nanobot 的会话、记忆和运行数据目录。',
    workspace: '工作目录',
    gatewaySection: 'Gateway 与 WebSocket',
    gatewaySectionDesc: 'XSafeClaw 通过 Nanobot gateway health 与 WebSocket channel 识别、聊天和创建智能体。',
    gatewayHost: 'Gateway Host',
    gatewayPort: 'Gateway Port',
    websocketEnabled: '启用 WebSocket channel',
    websocketHost: 'WebSocket Host',
    websocketPort: 'WebSocket Port',
    websocketPath: 'WebSocket Path',
    websocketRequiresToken: 'WebSocket 需要 token',
    websocketToken: 'WebSocket Token',
    guardSection: 'XSafeClaw Guard',
    guardSectionDesc: '写入 Nanobot hook，让原生 nanobot agent/gateway 启动时加载 XSafeClaw 安全检查。',
    guardMode: 'Guard 模式',
    guardBaseUrl: 'Guard Base URL',
    guardTimeout: 'Guard Timeout',
    disabled: '关闭',
    observe: '观察',
    blocking: '阻断',
    incompleteTitle: 'Nanobot 仍待模型配置',
    incompleteDesc: '你现在可以先保存基础配置，但在选择 provider 和 model 之前，Chat 和 Agent Valley 仍不会把 Nanobot 视为已完成配置。',
    save: '保存 Nanobot 配置',
    saving: '保存中...',
    saveWithoutModelConfirm: '当前还没有选择完整的 provider 和 model。\n\n这次保存只会写入基础配置，Nanobot 仍会保持“待配置”状态，Chat 和 Agent Valley 暂时不可用。\n\n是否继续保存？',
    saved: 'Nanobot 配置已保存',
    savedDesc: 'Nanobot 运行时已完整配置。现在可以启动 nanobot gateway，或直接进入 Agent Valley 创建 Nanobot 智能体。',
    savedPartial: '基础配置已保存',
    savedPartialDesc: 'provider 和 model 还没有配置完成。Nanobot 仍会保持待配置状态，稍后需要回来补全模型设置。',
    enterValley: '进入 Agent Valley',
    continueConfigure: '继续配置模型',
    backSetup: '返回安装向导',
    editAgain: '继续编辑',
    errorFallback: '保存失败',
    secretStored: '已有密钥已保存',
    noSecret: '当前 provider 尚未保存密钥',
  },
  en: {
    eyebrow: 'Nanobot Configure',
    title: 'Configure the default Nanobot runtime',
    subtitle: 'The file ~/.nanobot/config.json is created only after you click Save. Provider, model, and API key are blank on first load.',
    loading: 'Reading Nanobot config...',
    loadFailed: 'Failed to read Nanobot config',
    modelSection: 'Model and Secret',
    modelSectionDesc: 'Provider, model, and API key must be entered manually. You can also save workspace, gateway, WebSocket, and Guard settings first.',
    provider: 'Provider',
    providerPlaceholder: 'Not now, save base config first',
    providerHint: 'No default provider is preselected. Choose a provider before editing provider-specific secrets.',
    model: 'Model ID',
    modelHint: 'Leave blank to configure the model later.',
    apiKey: 'API Key',
    apiKeyKeep: 'Leave blank to keep the stored API key',
    apiKeyNew: 'Write a new API key for the selected provider',
    apiKeyNeedsProvider: 'Select a provider before editing its API key',
    clearApiKey: 'Clear the stored API key for this provider',
    apiBase: 'API Base',
    apiBasePlaceholder: 'Optional, for example https://api.openai.com/v1',
    workspaceSection: 'Workspace',
    workspaceSectionDesc: 'Where Nanobot stores sessions, memory, and runtime data.',
    workspace: 'Workspace',
    gatewaySection: 'Gateway and WebSocket',
    gatewaySectionDesc: 'XSafeClaw uses Nanobot gateway health and WebSocket channel for discovery, chat, and agent creation.',
    gatewayHost: 'Gateway Host',
    gatewayPort: 'Gateway Port',
    websocketEnabled: 'Enable WebSocket channel',
    websocketHost: 'WebSocket Host',
    websocketPort: 'WebSocket Port',
    websocketPath: 'WebSocket Path',
    websocketRequiresToken: 'Require WebSocket token',
    websocketToken: 'WebSocket Token',
    guardSection: 'XSafeClaw Guard',
    guardSectionDesc: 'Writes a Nanobot hook so native nanobot agent/gateway loads XSafeClaw safety checks on startup.',
    guardMode: 'Guard Mode',
    guardBaseUrl: 'Guard Base URL',
    guardTimeout: 'Guard Timeout',
    disabled: 'Disabled',
    observe: 'Observe',
    blocking: 'Blocking',
    incompleteTitle: 'Nanobot still needs model configuration',
    incompleteDesc: 'You can save the base config now, but Nanobot will still be treated as incomplete until provider and model are set. Chat and Agent Valley will stay blocked.',
    save: 'Save Nanobot Config',
    saving: 'Saving...',
    saveWithoutModelConfirm: 'Provider and model are not fully configured yet.\n\nThis save will only write the base config. Nanobot will remain in a needs-config state, and Chat / Agent Valley will stay unavailable.\n\nContinue saving?',
    saved: 'Nanobot config saved',
    savedDesc: 'The Nanobot runtime is fully configured. You can start nanobot gateway now, or enter Agent Valley to create Nanobot agents.',
    savedPartial: 'Base config saved',
    savedPartialDesc: 'Provider and model are still incomplete. Nanobot will remain in needs-config state until you come back and finish the model setup.',
    enterValley: 'Enter Agent Valley',
    continueConfigure: 'Continue Configuring',
    backSetup: 'Back to Setup',
    editAgain: 'Edit Again',
    errorFallback: 'Save failed',
    secretStored: 'Stored key exists',
    noSecret: 'No key stored for this provider',
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

function Section({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-surface-1/90 p-6 shadow-2xl shadow-black/20">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-300">
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-black text-text-primary">{title}</h2>
          <p className="mt-1 text-[13px] leading-6 text-text-muted">{desc}</p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  hint,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? 'md:col-span-2' : ''}`}>
      <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.12em] text-text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] leading-5 text-text-muted">{hint}</span>}
    </label>
  );
}

const inputClass = 'w-full rounded-xl border border-border bg-surface-0 px-3 py-2.5 text-[13px] text-text-primary outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20';

export default function NanobotConfigure() {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const labels = copy[locale];
  const [config, setConfig] = useState<NanobotConfigResponse | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedModelConfigured, setSavedModelConfigured] = useState(false);
  const [error, setError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showWsToken, setShowWsToken] = useState(false);

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

  const providerOptions = config?.provider_options || [];
  const providerSelected = Boolean(form.provider.trim());
  const modelConfigured = Boolean(form.provider.trim() && form.model.trim());
  const providerState = providerSelected ? config?.provider_configs?.[form.provider] : undefined;
  const providerHasKey = Boolean(providerState?.has_api_key);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

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
  };

  const handleSubmit = async () => {
    if (!modelConfigured && !window.confirm(labels.saveWithoutModelConfirm)) {
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload: NanobotConfigPayload = {
        ...form,
        provider: form.provider?.trim() || null,
        model: form.model?.trim() || null,
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
      <div className="min-h-screen flex items-center justify-center bg-[#070b10] text-text-secondary">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-1 px-5 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-300" />
          {labels.loading}
        </div>
      </div>
    );
  }

  if (saved) {
    const complete = savedModelConfigured;
    return (
      <div className="min-h-screen relative overflow-hidden bg-[#070b10] text-text-primary">
        <div className={`absolute inset-0 pointer-events-none ${complete ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.18),transparent_35%)]' : 'bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.16),transparent_35%)]'}`} />
        <div className="relative z-10 max-w-2xl mx-auto px-6 py-24">
          <div className={`rounded-[2rem] p-8 text-center shadow-2xl ${complete ? 'border border-emerald-500/25 bg-emerald-500/5 shadow-emerald-950/30' : 'border border-amber-500/25 bg-amber-500/8 shadow-amber-950/20'}`}>
            <div className={`mx-auto w-16 h-16 rounded-3xl border flex items-center justify-center ${complete ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-300' : 'bg-amber-500/15 border-amber-500/25 text-amber-200'}`}>
              {complete ? <CheckCircle className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
            </div>
            <h1 className="mt-6 text-3xl font-black text-text-primary">{complete ? labels.saved : labels.savedPartial}</h1>
            <p className="mt-3 text-sm leading-7 text-text-secondary">{complete ? labels.savedDesc : labels.savedPartialDesc}</p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              {complete ? (
                <button
                  type="button"
                  onClick={() => navigate('/agent-valley', { replace: true })}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 hover:bg-cyan-600"
                >
                  {labels.enterValley}
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSaved(false)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-black shadow-lg shadow-amber-500/20 hover:bg-amber-400"
                >
                  {labels.continueConfigure}
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={complete ? () => setSaved(false) : () => navigate('/setup', { replace: true })}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 px-5 py-3 text-sm font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2"
              >
                {complete ? labels.editAgain : labels.backSetup}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#070b10] text-text-primary">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 left-1/4 w-[520px] h-[520px] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute top-1/2 -right-24 w-[460px] h-[460px] rounded-full bg-emerald-500/8 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-200">
              <Bot className="w-3.5 h-3.5" />
              {labels.eyebrow}
            </div>
            <h1 className="mt-5 text-4xl md:text-5xl font-black tracking-tight text-text-primary">{labels.title}</h1>
            <p className="mt-4 max-w-3xl text-sm md:text-base leading-7 text-text-secondary">{labels.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/setup', { replace: true })}
            className="hidden md:inline-flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-2 text-[13px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2"
          >
            {labels.backSetup}
          </button>
        </div>

        {error && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!modelConfigured && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-text-primary">{labels.incompleteTitle}</p>
              <p className="mt-1 text-[13px] leading-6 text-text-secondary">{labels.incompleteDesc}</p>
            </div>
          </div>
        )}

        <div className="mt-8 space-y-5">
          <Section icon={Key} title={labels.modelSection} desc={labels.modelSectionDesc}>
            <Field label={labels.provider} hint={labels.providerHint}>
              <select className={inputClass} value={form.provider} onChange={e => handleProviderChange(e.target.value)}>
                <option value="">{labels.providerPlaceholder}</option>
                {providerOptions.map(option => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </Field>
            <Field label={labels.model} hint={labels.modelHint}>
              <input
                className={inputClass}
                value={form.model}
                onChange={e => setField('model', e.target.value)}
                placeholder="provider/model-name"
              />
            </Field>
            <Field label={labels.apiKey} hint={providerSelected ? (providerHasKey ? labels.apiKeyKeep : labels.apiKeyNew) : labels.apiKeyNeedsProvider}>
              <div className="relative">
                <input
                  className={`${inputClass} pr-10`}
                  type={showApiKey ? 'text' : 'password'}
                  value={form.api_key || ''}
                  onChange={e => setField('api_key', e.target.value)}
                  placeholder={providerSelected ? (providerHasKey ? labels.secretStored : labels.noSecret) : labels.apiKeyNeedsProvider}
                  disabled={!providerSelected || form.clear_api_key}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setShowApiKey(v => !v)}
                  disabled={!providerSelected}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label={labels.apiBase} hint={labels.apiBasePlaceholder}>
              <input
                className={inputClass}
                value={form.api_base || ''}
                onChange={e => setField('api_base', e.target.value)}
                placeholder="https://..."
                disabled={!providerSelected}
              />
            </Field>
            {providerSelected && providerHasKey && (
              <label className="md:col-span-2 flex items-center gap-2 rounded-xl border border-border bg-surface-0 px-3 py-2.5 text-[13px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={form.clear_api_key}
                  onChange={e => setField('clear_api_key', e.target.checked)}
                />
                {labels.clearApiKey}
              </label>
            )}
          </Section>

          <Section icon={Server} title={labels.workspaceSection} desc={labels.workspaceSectionDesc}>
            <Field label={labels.workspace} wide>
              <input className={inputClass} value={form.workspace} onChange={e => setField('workspace', e.target.value)} />
            </Field>
          </Section>

          <Section icon={Plug} title={labels.gatewaySection} desc={labels.gatewaySectionDesc}>
            <Field label={labels.gatewayHost}>
              <input className={inputClass} value={form.gateway_host} onChange={e => setField('gateway_host', e.target.value)} />
            </Field>
            <Field label={labels.gatewayPort}>
              <input className={inputClass} type="number" min={1} max={65535} value={form.gateway_port} onChange={e => setField('gateway_port', Number(e.target.value) || 18790)} />
            </Field>
            <label className="md:col-span-2 flex items-center gap-2 rounded-xl border border-border bg-surface-0 px-3 py-2.5 text-[13px] text-text-secondary">
              <input type="checkbox" checked={form.websocket_enabled} onChange={e => setField('websocket_enabled', e.target.checked)} />
              {labels.websocketEnabled}
            </label>
            <Field label={labels.websocketHost}>
              <input className={inputClass} value={form.websocket_host} onChange={e => setField('websocket_host', e.target.value)} disabled={!form.websocket_enabled} />
            </Field>
            <Field label={labels.websocketPort}>
              <input className={inputClass} type="number" min={1} max={65535} value={form.websocket_port} onChange={e => setField('websocket_port', Number(e.target.value) || 8765)} disabled={!form.websocket_enabled} />
            </Field>
            <Field label={labels.websocketPath}>
              <input className={inputClass} value={form.websocket_path} onChange={e => setField('websocket_path', e.target.value)} disabled={!form.websocket_enabled} />
            </Field>
            <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-0 px-3 py-2.5 text-[13px] text-text-secondary">
              <input type="checkbox" checked={form.websocket_requires_token} onChange={e => setField('websocket_requires_token', e.target.checked)} disabled={!form.websocket_enabled} />
              {labels.websocketRequiresToken}
            </label>
            {form.websocket_requires_token && (
              <Field label={labels.websocketToken} wide>
                <div className="relative">
                  <input
                    className={`${inputClass} pr-10`}
                    type={showWsToken ? 'text' : 'password'}
                    value={form.websocket_token || ''}
                    onChange={e => setField('websocket_token', e.target.value)}
                    placeholder={config?.websocket.has_token ? labels.apiKeyKeep : labels.websocketToken}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-muted hover:text-text-primary"
                    onClick={() => setShowWsToken(v => !v)}
                  >
                    {showWsToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
            )}
          </Section>

          <Section icon={Shield} title={labels.guardSection} desc={labels.guardSectionDesc}>
            <Field label={labels.guardMode}>
              <select className={inputClass} value={form.guard_mode} onChange={e => setField('guard_mode', e.target.value as NanobotGuardMode)}>
                <option value="disabled">{labels.disabled}</option>
                <option value="observe">{labels.observe}</option>
                <option value="blocking">{labels.blocking}</option>
              </select>
            </Field>
            <Field label={labels.guardTimeout}>
              <input className={inputClass} type="number" min={1} value={form.guard_timeout_s} onChange={e => setField('guard_timeout_s', Number(e.target.value) || 305)} />
            </Field>
            <Field label={labels.guardBaseUrl} wide>
              <input className={inputClass} value={form.guard_base_url} onChange={e => setField('guard_base_url', e.target.value)} disabled={form.guard_mode === 'disabled'} />
            </Field>
          </Section>
        </div>

        <div className="sticky bottom-0 mt-8 -mx-6 border-t border-border bg-[#070b10]/85 px-6 py-4 backdrop-blur-xl">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <p className="text-[12px] text-text-muted">
              {config?.config_path || '~/.nanobot/config.json'}
            </p>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? labels.saving : labels.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
