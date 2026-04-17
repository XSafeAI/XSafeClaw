/**
 * Configure — 14-step onboard wizard, 1:1 clone of OpenClaw's native onboard flow.
 * Steps: Security → Mode → Config → SetupType → Workspace → Provider → Model →
 *        Gateway → Channels → Search → Skills → Hooks → Finalize → Review
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Zap, Settings2, Key, Server, Plug, Wrench, CheckCircle,
  ChevronRight, ChevronLeft, Eye, EyeOff, Loader2, XCircle,
  RefreshCw, Trash2, Globe, FolderOpen, Search, Rocket,
} from 'lucide-react';
import { systemAPI } from '../services/api';
import { useI18n } from '../i18n';
import type { Translations } from '../i18n/locales/en';

/* ─── Types ─── */
interface AuthMethod { id: string; label: string; hint?: string; modelProviders?: string[]; }
interface AuthProviderInfo { id: string; name: string; hint: string; supported?: boolean; methods?: AuthMethod[]; }
interface ModelInfo { id: string; name: string; contextWindow: number; reasoning: boolean; available: boolean; input: string; }
interface ModelProviderInfo { id: string; name: string; models: ModelInfo[]; keyUrl?: string; }
interface ChannelInfo { id: string; name: string; configured: boolean; }
interface SkillInfo { name: string; description: string; emoji: string; eligible: boolean; disabled: boolean; missing: { bins?: string[]; anyBins?: string[]; env?: string[]; os?: string[]; config?: string[] }; source: string; bundled: boolean; }
interface HookInfo { name: string; description: string; emoji: string; enabled: boolean; }
interface SearchProviderInfo { id: string; name: string; hint: string; placeholder: string; }

interface FormData {
  mode: string;
  authProvider: string;
  authMethod: string;
  apiKey: string;
  modelFilter: string;
  modelId: string;
  gatewayPort: number;
  gatewayBind: string;
  gatewayAuthMode: string;
  gatewayToken: string;
  channels: string[];
  hooks: string[];
  workspace: string;
  installDaemon: boolean;
  tailscaleMode: string;
  searchProvider: string;
  searchApiKey: string;
  remoteUrl: string;
  remoteToken: string;
  selectedSkills: string[];
  wizardMode: 'quickstart' | 'manual';
  configAction: string;
  resetScope: string;
  riskAccepted: boolean;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuConnectionMode: string;
  feishuDomain: string;
  feishuGroupPolicy: string;
  feishuGroupAllowFrom: string;
  feishuVerificationToken: string;
  feishuWebhookPath: string;
  cfAccountId: string;
  cfGatewayId: string;
  litellmBaseUrl: string;
  vllmBaseUrl: string;
  vllmModelId: string;
  customBaseUrl: string;
  customModelId: string;
  customProviderId: string;
  customCompatibility: string;
}

const INITIAL: FormData = {
  mode: 'local', authProvider: '', authMethod: '', apiKey: '', modelFilter: '', modelId: '',
  gatewayPort: 18789, gatewayBind: 'loopback', gatewayAuthMode: 'token', gatewayToken: '',
  channels: [], hooks: [], workspace: '~/.openclaw/workspace',
  installDaemon: true, tailscaleMode: 'off',
  searchProvider: '', searchApiKey: '', remoteUrl: '', remoteToken: '',
  selectedSkills: [], wizardMode: 'quickstart', configAction: 'update', resetScope: '',
  riskAccepted: false, feishuAppId: '', feishuAppSecret: '',
  feishuConnectionMode: 'websocket', feishuDomain: 'feishu', feishuGroupPolicy: 'open',
  feishuGroupAllowFrom: '', feishuVerificationToken: '', feishuWebhookPath: '/feishu/events',
  cfAccountId: '', cfGatewayId: '', litellmBaseUrl: 'http://localhost:4000',
  vllmBaseUrl: 'http://127.0.0.1:8000/v1', vllmModelId: '', customBaseUrl: '', customModelId: '',
  customProviderId: '', customCompatibility: 'openai',
};

const AGGREGATOR_PROVIDERS = new Set([
  'openrouter', 'kilocode', 'litellm', 'ai-gateway', 'cloudflare-ai-gateway',
  'opencode', 'synthetic', 'together', 'huggingface', 'venice', 'skip',
]);

/* ─── Progress Bar ─── */
function StepProgress({ current, skipped, labels }: { current: number; skipped: Set<number>; labels: string[] }) {
  return (
    <div className="flex items-center justify-center gap-0.5 mb-6">
      {labels.map((label, i) => {
        const done = i < current && !skipped.has(i);
        const active = i === current;
        const skip = skipped.has(i);
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center gap-0.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all
                ${skip ? 'bg-surface-2/50 text-text-muted/30' : done ? 'bg-emerald-500 text-white' : active ? 'bg-accent text-white ring-2 ring-accent/40' : 'bg-surface-2 text-text-muted'}`}>
                {done ? <CheckCircle className="w-3 h-3" /> : i + 1}
              </div>
              <span className={`text-[8px] font-medium ${skip ? 'text-text-muted/30' : active ? 'text-accent' : done ? 'text-emerald-400' : 'text-text-muted'}`}>{label}</span>
            </div>
            {i < labels.length - 1 && <div className={`w-4 h-0.5 mx-0.5 mb-3 ${done && !skipped.has(i + 1) ? 'bg-emerald-500/60' : 'bg-border/50'}`} />}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Step 0: Security ─── */
function SecurityStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-warning" /><h3 className="text-lg font-bold text-text-primary">{t.configure.security.title}</h3></div>
      <div className="bg-warning/5 border border-warning/20 rounded-xl p-5 text-[12px] text-text-secondary leading-relaxed space-y-2">
        <p className="font-semibold text-text-primary">{t.configure.security.prompt}</p>
        <ul className="list-disc pl-4 space-y-1">
          {t.configure.security.items.map((item: string, i: number) => <li key={i}>{item}</li>)}
        </ul>
        <p className="text-[11px] text-text-muted">{t.configure.security.recommend}</p>
      </div>
      <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-border hover:border-accent/30 transition-all">
        <input type="checkbox" checked={form.riskAccepted} onChange={e => setForm({ ...form, riskAccepted: e.target.checked })} className="w-4 h-4 rounded accent-accent" />
        <span className="text-[13px] font-medium text-text-primary">{t.configure.security.checkbox}</span>
      </label>
    </div>
  );
}

/* ─── Step 1: Mode ─── */
function ModeStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-text-primary">{t.configure.mode.title}</h3>
      <p className="text-[13px] text-text-muted">{t.configure.mode.subtitle}</p>
      <div className="grid grid-cols-2 gap-4">
        {[
          { id: 'quickstart', icon: Zap, title: t.configure.mode.quickstart, desc: t.configure.mode.quickstartDesc },
          { id: 'manual', icon: Settings2, title: t.configure.mode.manual, desc: t.configure.mode.manualDesc },
        ].map(o => (
          <button key={o.id} onClick={() => setForm({ ...form, wizardMode: o.id as 'quickstart' | 'manual' })}
            className={`p-5 rounded-xl border-2 text-left transition-all ${form.wizardMode === o.id ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/30'}`}>
            <o.icon className={`w-6 h-6 mb-3 ${form.wizardMode === o.id ? 'text-accent' : 'text-text-muted'}`} />
            <p className="text-[14px] font-semibold text-text-primary">{o.title}</p>
            <p className="text-[11px] text-text-muted mt-1">{o.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Step 2: Config Handling ─── */
function ConfigStep({ form, setForm, configSummary }: { form: FormData; setForm: (f: FormData) => void; configSummary: string[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-text-primary">{t.configure.config.title}</h3>

      {configSummary.length > 0 ? (
        <div className="bg-surface-0 border border-border rounded-xl p-4 font-mono text-[12px] space-y-0.5">
          {configSummary.map((line, i) => {
            const [key, ...rest] = line.split(': ');
            return <p key={i} className="text-text-secondary">{key}: <span className="text-text-primary">{rest.join(': ')}</span></p>;
          })}
        </div>
      ) : (
        <p className="text-[13px] text-text-muted">{t.configure.config.noKeySettings}</p>
      )}

      <div className="space-y-3">
        {[
          { id: 'keep', icon: CheckCircle, title: t.configure.config.keep, desc: t.configure.config.keepDesc },
          { id: 'update', icon: RefreshCw, title: t.configure.config.update, desc: t.configure.config.updateDesc },
          { id: 'reset', icon: Trash2, title: t.configure.config.reset, desc: t.configure.config.resetDesc },
        ].map(o => (
          <button key={o.id} onClick={() => setForm({ ...form, configAction: o.id, resetScope: o.id === 'reset' ? form.resetScope : '' })}
            className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${form.configAction === o.id ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/30'}`}>
            <o.icon className={`w-5 h-5 flex-shrink-0 ${form.configAction === o.id ? 'text-accent' : 'text-text-muted'}`} />
            <div><p className="text-[13px] font-semibold text-text-primary">{o.title}</p><p className="text-[11px] text-text-muted">{o.desc}</p></div>
          </button>
        ))}
      </div>

      {form.configAction === 'reset' && (
        <div className="space-y-2 mt-2 pl-4 border-l-2 border-red-500/30">
          <p className="text-[12px] font-semibold text-text-primary">{t.configure.config.resetScopeTitle}</p>
          {[
            { id: 'config', title: t.configure.config.resetConfigOnly, desc: t.configure.config.resetConfigOnlyDesc },
            { id: 'config+creds+sessions', title: t.configure.config.resetCreds, desc: t.configure.config.resetCredsDesc },
            { id: 'full', title: t.configure.config.resetFull, desc: t.configure.config.resetFullDesc },
          ].map(o => (
            <button key={o.id} onClick={() => setForm({ ...form, resetScope: o.id })}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 text-[13px] transition-all
                ${form.resetScope === o.id ? 'border-red-500/60 bg-red-500/5 font-semibold text-text-primary' : 'border-border text-text-secondary hover:border-red-500/30'}`}>
              {o.title}
              <span className="text-[11px] text-text-muted ml-2">{o.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Step 3: Setup Type ─── */
function SetupTypeStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-text-primary">{t.configure.setupType.title}</h3>
      <div className="space-y-3">
        {[
          { id: 'local', icon: Server, title: t.configure.setupType.local, desc: t.configure.setupType.localDesc },
          { id: 'remote', icon: Globe, title: t.configure.setupType.remote, desc: t.configure.setupType.remoteDesc },
        ].map(o => (
          <button key={o.id} onClick={() => setForm({ ...form, mode: o.id })}
            className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${form.mode === o.id ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/30'}`}>
            <o.icon className={`w-5 h-5 flex-shrink-0 ${form.mode === o.id ? 'text-accent' : 'text-text-muted'}`} />
            <div><p className="text-[13px] font-semibold text-text-primary">{o.title}</p><p className="text-[11px] text-text-muted">{o.desc}</p></div>
          </button>
        ))}
      </div>
      {form.mode === 'remote' && (
        <div className="space-y-3 mt-4 pl-4 border-l-2 border-border">
          <p className="text-[11px] text-text-muted">{t.configure.setupType.remoteHint}</p>
          <div><label className="text-[12px] font-medium text-text-muted block mb-1">{t.configure.setupType.wsUrl}</label>
            <input type="text" value={form.remoteUrl} onChange={e => setForm({ ...form, remoteUrl: e.target.value })} placeholder={t.configure.setupType.wsUrlPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
            {form.remoteUrl.trim() && !form.remoteUrl.trim().startsWith('ws://') && !form.remoteUrl.trim().startsWith('wss://') && (
              <p className="text-[11px] text-red-400 mt-1">{t.configure.setupType.urlMustWs}</p>
            )}
          </div>
          <div><label className="text-[12px] font-medium text-text-muted block mb-1">{t.configure.setupType.remoteToken}</label>
            <input type="password" value={form.remoteToken} onChange={e => setForm({ ...form, remoteToken: e.target.value })} placeholder={t.configure.setupType.remoteTokenPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" /></div>
        </div>
      )}
    </div>
  );
}

/* ─── Step 4: Workspace ─── */
function WorkspaceStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><FolderOpen className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{t.configure.workspace.title}</h3></div>
      <p className="text-[13px] text-text-muted">{t.configure.workspace.subtitle}</p>
      <input type="text" value={form.workspace} onChange={e => setForm({ ...form, workspace: e.target.value })}
        className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
    </div>
  );
}

/* ─── Step 5: Provider + Model (combined) ─── */
/* ─── Searchable Dropdown ─── */
function SearchableDropdown({ label, value, displayValue, placeholder, searchPlaceholder, options, onSelect, renderOption }: {
  label: string; value: string; displayValue: string; placeholder: string; searchPlaceholder: string;
  options: { id: string; label: string; hint?: string }[];
  onSelect: (id: string) => void;
  renderOption?: (opt: { id: string; label: string; hint?: string }, selected: boolean) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const filtered = filter ? options.filter(o => o.label.toLowerCase().includes(filter.toLowerCase()) || o.id.toLowerCase().includes(filter.toLowerCase())) : options;
  return (
    <div>
      <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{label}</label>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-[13px] text-left hover:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all">
        <span className={value ? 'text-text-primary font-medium' : 'text-text-muted'}>{value ? displayValue : placeholder}</span>
        <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 border border-border rounded-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input type="text" value={filter} onChange={e => setFilter(e.target.value)} placeholder={searchPlaceholder} autoFocus
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.map(o => (
              <button key={o.id} onClick={() => { onSelect(o.id); setOpen(false); setFilter(''); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all ${value === o.id ? 'bg-accent/15 text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
                {renderOption ? renderOption(o, value === o.id) : <>{o.label}{o.hint ? <span className="text-text-muted ml-1">{o.hint}</span> : null}</>}
              </button>
            ))}
            {filtered.length === 0 && <p className="text-[12px] text-text-muted p-3 text-center">{t.configure.searchable.noResults}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Step 5: Provider + Model (combined) ─── */
/* ─── Step 5: Auth Provider ─── */
function AuthProviderStep({ form, setForm, authProviders, modelProviders, showKey, setShowKey }: {
  form: FormData; setForm: (f: FormData) => void; authProviders: AuthProviderInfo[]; modelProviders: ModelProviderInfo[];
  showKey: boolean; setShowKey: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [manual, setManual] = useState(false);
  const selected = authProviders.find(p => p.id === form.authProvider);
  const isSupported = selected?.supported ?? false;
  const methods = selected?.methods || [];
  const hasMultipleMethods = methods.length > 1;
  const effectiveMethod = form.authMethod || (methods.length === 1 ? methods[0]?.id : '');
  const keyUrl = PROVIDER_KEY_URLS[form.authProvider] || '';
  const selectedMethod = methods.find(m => m.id === effectiveMethod);
  const explicitIds = selectedMethod?.modelProviders;
  const inferredIds = explicitIds
    ?? (form.authProvider && !AGGREGATOR_PROVIDERS.has(form.authProvider) ? [form.authProvider] : undefined);
  const relevantProviders = inferredIds
    ? modelProviders.filter(p => inferredIds.includes(p.id))
    : modelProviders;
  const visibleModels = relevantProviders.flatMap(p => p.models);
  const allModels = modelProviders.flatMap(p => p.models);
  const selectedModel = allModels.find(m => m.id === form.modelId);
  const _hasCustomUI = form.authProvider === 'vllm' || form.authProvider === 'custom';
  const showApiKey = isSupported && form.authProvider !== 'skip' && !_hasCustomUI;
  const methodReady = !hasMultipleMethods || !!form.authMethod;
  const showModel = showApiKey && methodReady;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2"><Key className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{t.configure.auth.title}</h3></div>

      {/* 1. Provider 选择 */}
      <div>
        <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.selectProvider}</label>
        <SearchableDropdown
          label=""
          value={form.authProvider}
          displayValue={selected ? `${selected.name}${selected.hint ? ` — ${selected.hint}` : ''}` : ''}
          placeholder={t.configure.auth.chooseProvider}
          searchPlaceholder={t.configure.auth.searchProviders}
          options={authProviders.map(p => ({
            id: p.id,
            label: p.name + (p.supported ? '' : t.configure.auth.requiresCliSuffix),
            hint: p.hint || '',
          }))}
          onSelect={id => {
            const prov = authProviders.find(p => p.id === id);
            if (!prov?.supported && id !== 'skip') return;
            const provMethods = prov?.methods || [];
            const nextAuthMethod = provMethods.length === 1 ? provMethods[0].id : '';
            setForm({
              ...form,
              authProvider: id,
              authMethod: nextAuthMethod,
              apiKey: '', modelId: '',
              cfAccountId: '', cfGatewayId: '', litellmBaseUrl: 'http://localhost:4000',
              vllmBaseUrl: 'http://127.0.0.1:8000/v1', vllmModelId: '',
              customBaseUrl: '', customModelId: '', customProviderId: '', customCompatibility: 'openai',
            });
            setManual(false);
          }}
        />
      </div>

      {/* 2. Auth Method 子选（如果 provider 有多个方法） */}
      {isSupported && hasMultipleMethods && (
        <div>
          <label className="text-[12px] font-semibold text-text-primary block mb-1.5">
            {t.configure.auth.authMethod.replace(/\{name\}/g, selected?.name || '')}
          </label>
          <div className="space-y-1.5">
            {methods.map(m => (
              <button
                key={m.id}
                onClick={() => {
                  setForm({ ...form, authMethod: m.id, apiKey: '', modelId: '' });
                  setManual(false);
                }}
                className={`w-full text-left px-4 py-3 rounded-xl border-2 text-[13px] transition-all
                  ${form.authMethod === m.id ? 'border-accent bg-accent/5 font-semibold text-text-primary' : 'border-border text-text-secondary hover:border-accent/30'}`}>
                {m.label}
                {m.hint && <span className="text-text-muted text-[11px] ml-2">{m.hint}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. API Key */}
      {showApiKey && methodReady && (
        <div>
          <label className="text-[12px] font-semibold text-text-primary block mb-1.5">
            {hasMultipleMethods ? t.configure.auth.apiKeyStep3 : t.configure.auth.apiKeyStep2}
            {keyUrl && <a href={keyUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent hover:underline text-[11px] font-normal">{t.configure.auth.getKey}</a>}
          </label>
          <div className="relative">
            <input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
              placeholder={t.configure.auth.pasteKey}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
            <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Cloudflare AI Gateway — extra fields */}
      {showApiKey && methodReady && form.authProvider === 'cloudflare-ai-gateway' && (
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.accountId}</label>
            <input type="text" value={form.cfAccountId} onChange={e => setForm({ ...form, cfAccountId: e.target.value })}
              placeholder={t.configure.auth.cfAccountPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.gatewayId}</label>
            <input type="text" value={form.cfGatewayId} onChange={e => setForm({ ...form, cfGatewayId: e.target.value })}
              placeholder={t.configure.auth.cfGatewayPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
        </div>
      )}

      {/* LiteLLM — base URL */}
      {showApiKey && methodReady && form.authProvider === 'litellm' && (
        <div>
          <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.baseUrl}</label>
          <input type="text" value={form.litellmBaseUrl} onChange={e => setForm({ ...form, litellmBaseUrl: e.target.value })}
            placeholder={t.configure.auth.litellmUrlPlaceholder}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          <p className="text-[11px] text-text-muted mt-1">{t.configure.auth.litellmHint}</p>
        </div>
      )}

      {/* vLLM — base URL + model ID */}
      {form.authProvider === 'vllm' && (
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.step2BaseUrl}</label>
            <input type="text" value={form.vllmBaseUrl} onChange={e => setForm({ ...form, vllmBaseUrl: e.target.value })}
              placeholder={t.configure.auth.vllmUrlPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
            <p className="text-[11px] text-text-muted mt-1">{t.configure.auth.vllmBaseHint}</p>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.apiKeyStep3}</label>
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder={t.configure.auth.vllmApiKeyPlaceholder}
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
              <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.modelIdStep4}</label>
            <input type="text" value={form.vllmModelId} onChange={e => setForm({ ...form, vllmModelId: e.target.value })}
              placeholder={t.configure.auth.vllmModelIdPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
        </div>
      )}

      {/* Custom provider — base URL + model ID + compatibility */}
      {form.authProvider === 'custom' && (
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.step2BaseUrl}</label>
            <input type="text" value={form.customBaseUrl} onChange={e => setForm({ ...form, customBaseUrl: e.target.value })}
              placeholder={t.configure.auth.customBaseUrlPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.customApiKeyOptional}</label>
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder={t.configure.auth.customApiKeyPlaceholder}
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
              <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.modelIdStep4}</label>
            <input type="text" value={form.customModelId} onChange={e => setForm({ ...form, customModelId: e.target.value })}
              placeholder={t.configure.auth.customModelIdPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.compatibility}</label>
            <div className="flex gap-3">
              {['openai', 'anthropic'].map(mode => (
                <button key={mode} onClick={() => setForm({ ...form, customCompatibility: mode })}
                  className={`flex-1 px-4 py-2.5 rounded-xl border-2 text-[13px] font-medium transition-all
                    ${form.customCompatibility === mode ? 'border-accent bg-accent/5 text-text-primary' : 'border-border text-text-secondary hover:border-accent/30'}`}>
                  {mode === 'openai' ? t.configure.auth.openaiCompat : t.configure.auth.anthropicCompat}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{t.configure.auth.providerIdOptional}</label>
            <input type="text" value={form.customProviderId} onChange={e => setForm({ ...form, customProviderId: e.target.value })}
              placeholder={t.configure.auth.customProviderIdPlaceholder}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
        </div>
      )}

      {/* 4. Default Model */}
      {showModel && !manual && visibleModels.length > 0 && (
        <div>
          <SearchableDropdown
            label={hasMultipleMethods ? t.configure.auth.defaultModel : t.configure.auth.defaultModelShort}
            value={form.modelId}
            displayValue={selectedModel ? `${selectedModel.name}${selectedModel.contextWindow ? ` (${Math.round(selectedModel.contextWindow / 1024)}K)` : ''}` : form.modelId}
            placeholder={t.configure.auth.chooseModel}
            searchPlaceholder={t.configure.auth.searchModels}
            options={visibleModels.map(m => ({
              id: m.id,
              label: m.name,
              hint: `${m.contextWindow ? `${Math.round(m.contextWindow / 1024)}K` : ''}${m.reasoning ? t.configure.auth.reasoningTag : ''}`,
            }))}
            onSelect={id => setForm({ ...form, modelId: id })}
          />
          <button onClick={() => setManual(true)} className="text-[11px] text-accent mt-2 hover:underline">{t.configure.auth.enterModelManually}</button>
        </div>
      )}

      {showModel && (manual || visibleModels.length === 0) && (
        <div>
          <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{hasMultipleMethods ? t.configure.auth.modelIdStep4 : t.configure.auth.modelIdStep}</label>
          <input type="text" value={form.modelId} onChange={e => setForm({ ...form, modelId: e.target.value })} placeholder={t.configure.auth.modelIdPlaceholder}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          {visibleModels.length > 0 && (
            <button onClick={() => setManual(false)} className="text-[11px] text-accent mt-2 hover:underline">{t.configure.auth.backToList}</button>
          )}
        </div>
      )}

      {/* Not supported hint */}
      {form.authProvider && !isSupported && form.authProvider !== 'skip' && (
        <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 text-[12px] text-text-muted">
          {t.configure.auth.providerRequiresCliBefore}<code className="text-accent">openclaw onboard</code>{t.configure.auth.providerRequiresCliAfter}
        </div>
      )}
    </div>
  );
}


const PROVIDER_KEY_URLS: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  moonshot: 'https://platform.moonshot.cn/console/api-keys',
  minimax: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  mistral: 'https://console.mistral.ai/api-keys',
  xai: 'https://console.x.ai/',
  openrouter: 'https://openrouter.ai/keys',
  together: 'https://api.together.xyz/settings/api-keys',
  huggingface: 'https://huggingface.co/settings/tokens',
  venice: 'https://venice.ai/settings/api',
  qianfan: 'https://console.bce.baidu.com/qianfan/ais/console/apiKey',
  modelstudio: 'https://bailian.console.aliyun.com/',
  zai: 'https://open.bigmodel.cn/usercenter/apikeys',
  xiaomi: 'https://developers.xiaomi.com/mimo',
  volcengine: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  litellm: 'https://litellm.ai',
};

/* ─── Step 7: Gateway ─── */
function GatewayStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Server className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{t.configure.gateway.title}</h3></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-[12px] font-medium text-text-muted block mb-1">{t.configure.gateway.port}</label>
          <input type="number" value={form.gatewayPort} onChange={e => setForm({ ...form, gatewayPort: Number(e.target.value) })}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30" /></div>
        <div><label className="text-[12px] font-medium text-text-muted block mb-1">{t.configure.gateway.bindAddress}</label>
          <select value={form.gatewayBind} onChange={e => setForm({ ...form, gatewayBind: e.target.value })}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="loopback">{t.configure.gateway.bindLoopback}</option><option value="lan">{t.configure.gateway.bindLan}</option><option value="auto">{t.configure.gateway.bindAuto}</option><option value="custom">{t.configure.gateway.bindCustom}</option><option value="tailnet">{t.configure.gateway.bindTailnet}</option>
          </select></div>
        <div><label className="text-[12px] font-medium text-text-muted block mb-1">{t.configure.gateway.authMode}</label>
          <select value={form.gatewayAuthMode} onChange={e => setForm({ ...form, gatewayAuthMode: e.target.value })}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="token">{t.configure.gateway.authToken}</option><option value="password">{t.configure.gateway.authPassword}</option>
          </select></div>
        <div><label className="text-[12px] font-medium text-text-muted block mb-1">{t.configure.gateway.tailscaleExposure}</label>
          <select value={form.tailscaleMode} onChange={e => setForm({ ...form, tailscaleMode: e.target.value })}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="off">{t.configure.gateway.tsOff}</option><option value="serve">{t.configure.gateway.tsServe}</option><option value="funnel">{t.configure.gateway.tsFunnel}</option>
          </select></div>
      </div>
      <div><label className="text-[12px] font-medium text-text-muted block mb-1">{t.configure.gateway.gatewayToken}</label>
        <input type="text" value={form.gatewayToken} onChange={e => setForm({ ...form, gatewayToken: e.target.value })} placeholder={t.configure.gateway.gatewayTokenPlaceholder}
          className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" /></div>
    </div>
  );
}

/* ─── Step 8: Channels ─── */
function ChannelsStep({ form, setForm, channels }: { form: FormData; setForm: (f: FormData) => void; channels: ChannelInfo[] }) {
  const { t } = useI18n();
  const SUPPORTED = new Set(['feishu']);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const toggle = (id: string) => {
    if (!SUPPORTED.has(id)) return;
    setForm({ ...form, channels: form.channels.includes(id) ? form.channels.filter(x => x !== id) : [...form.channels, id] });
  };
  const inputCls = 'w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30';
  const labelCls = 'text-[12px] font-medium text-text-muted block mb-1';
  const radioCls = (active: boolean) =>
    `px-3 py-2 rounded-lg text-[12px] transition-all border ${active ? 'border-accent bg-accent/15 text-accent font-semibold' : 'border-border text-text-secondary hover:bg-surface-2'}`;

  const runTest = async () => {
    setTestStatus('testing'); setTestMsg('');
    try {
      const res = await systemAPI.feishuTest(form.feishuAppId, form.feishuAppSecret, form.feishuDomain);
      if (res.data.ok) {
        setTestStatus('ok');
        const name = String(res.data.bot_name || res.data.bot_open_id || 'bot');
        setTestMsg(t.configure.channels.connectedAs.replace('{name}', name));
      } else {
        setTestStatus('fail');
        setTestMsg(res.data.error || t.configure.channels.unknownError);
      }
    } catch (err: any) {
      setTestStatus('fail');
      setTestMsg(err?.response?.data?.detail || String(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Plug className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{t.configure.channels.title}</h3></div>
      <p className="text-[13px] text-text-muted">{t.configure.channels.subtitle}</p>
      <div className="max-h-52 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
        {channels.map(ch => {
          const supported = SUPPORTED.has(ch.id);
          const selected = form.channels.includes(ch.id);
          return (
            <button key={ch.id} onClick={() => toggle(ch.id)} disabled={!supported}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-[12px] transition-all flex items-center justify-between
                ${!supported ? 'text-text-muted/40 cursor-not-allowed' : selected ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-surface-2'}`}>
              <span>{ch.name}{ch.configured ? t.configure.channels.configured : ''}{!supported ? t.configure.channels.comingSoon : ''}</span>
              {selected && <CheckCircle className="w-3.5 h-3.5" />}
            </button>
          );
        })}
      </div>

      {form.channels.includes('feishu') && (
        <div className="border border-accent/30 rounded-xl p-4 space-y-4 bg-accent/5">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-accent" />
            <span className="text-[13px] font-semibold text-text-primary">{t.configure.channels.feishuTitle}</span>
          </div>

          {/* Credential help */}
          <div className="bg-surface-0 border border-border rounded-lg p-3 text-[11px] text-text-muted space-y-1">
            <p>{t.configure.channels.feishuHelp1Prefix}<a href="https://open.feishu.cn" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{t.configure.channels.feishuOpenPlatform}</a></p>
            <p>{t.configure.channels.feishuHelp2}</p>
            <p>{t.configure.channels.feishuHelp3}</p>
            <p>{t.configure.channels.feishuHelp4}</p>
            <p>{t.configure.channels.feishuHelp5}</p>
            <p className="text-text-muted/60">{t.configure.channels.feishuTip}</p>
          </div>

          {/* App ID + App Secret */}
          <div>
            <label className={labelCls}>{t.configure.channels.appSecret}</label>
            <input type="password" value={form.feishuAppSecret} onChange={e => setForm({ ...form, feishuAppSecret: e.target.value })}
              placeholder={t.configure.channels.appSecretPlaceholder} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t.configure.channels.appId}</label>
            <input type="text" value={form.feishuAppId} onChange={e => setForm({ ...form, feishuAppId: e.target.value })}
              placeholder={t.configure.channels.appIdPlaceholder} className={inputCls} />
          </div>

          {/* Connection test */}
          {form.feishuAppId && form.feishuAppSecret && (
            <div className="flex items-center gap-3">
              <button onClick={runTest} disabled={testStatus === 'testing'}
                className="px-4 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-[12px] font-semibold rounded-lg transition-all flex items-center gap-1.5">
                {testStatus === 'testing' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t.configure.channels.testing}</> : <><Globe className="w-3.5 h-3.5" /> {t.configure.channels.testConnection}</>}
              </button>
              {testStatus === 'ok' && <span className="text-[12px] text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />{testMsg}</span>}
              {testStatus === 'fail' && <span className="text-[12px] text-red-400 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{testMsg}</span>}
            </div>
          )}

          {/* Connection mode */}
          <div>
            <label className={labelCls}>{t.configure.channels.connectionMode}</label>
            <div className="flex gap-2">
              <button className={radioCls(form.feishuConnectionMode === 'websocket')}
                onClick={() => setForm({ ...form, feishuConnectionMode: 'websocket' })}>{t.configure.channels.wsDefault}</button>
              <button className={radioCls(form.feishuConnectionMode === 'webhook')}
                onClick={() => setForm({ ...form, feishuConnectionMode: 'webhook' })}>{t.configure.channels.webhook}</button>
            </div>
          </div>

          {/* Webhook-specific fields */}
          {form.feishuConnectionMode === 'webhook' && (
            <div className="space-y-3 pl-3 border-l-2 border-accent/20">
              <div>
                <label className={labelCls}>{t.configure.channels.verificationToken}</label>
                <input type="password" value={form.feishuVerificationToken}
                  onChange={e => setForm({ ...form, feishuVerificationToken: e.target.value })}
                  placeholder={t.configure.channels.verificationPlaceholder} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t.configure.channels.webhookPath}</label>
                <input type="text" value={form.feishuWebhookPath}
                  onChange={e => setForm({ ...form, feishuWebhookPath: e.target.value })}
                  placeholder={t.configure.channels.webhookPathPlaceholder} className={inputCls} />
              </div>
            </div>
          )}

          {/* Domain */}
          <div>
            <label className={labelCls}>{t.configure.channels.domain}</label>
            <div className="flex gap-2">
              <button className={radioCls(form.feishuDomain === 'feishu')}
                onClick={() => setForm({ ...form, feishuDomain: 'feishu' })}>{t.configure.channels.feishuChina}</button>
              <button className={radioCls(form.feishuDomain === 'lark')}
                onClick={() => setForm({ ...form, feishuDomain: 'lark' })}>{t.configure.channels.larkIntl}</button>
            </div>
          </div>

          {/* Group policy */}
          <div>
            <label className={labelCls}>{t.configure.channels.groupPolicy}</label>
            <div className="flex gap-2 flex-wrap">
              {([
                ['open', t.configure.channels.gpOpen],
                ['allowlist', t.configure.channels.gpAllowlist],
                ['disabled', t.configure.channels.gpDisabled],
              ] as const).map(([val, label]) => (
                <button key={val} className={radioCls(form.feishuGroupPolicy === val)}
                  onClick={() => setForm({ ...form, feishuGroupPolicy: val })}>{label}</button>
              ))}
            </div>
          </div>

          {/* Group allowlist */}
          {form.feishuGroupPolicy === 'allowlist' && (
            <div className="pl-3 border-l-2 border-accent/20">
              <label className={labelCls}>{t.configure.channels.groupAllowlist}</label>
              <input type="text" value={form.feishuGroupAllowFrom}
                onChange={e => setForm({ ...form, feishuGroupAllowFrom: e.target.value })}
                placeholder={t.configure.channels.groupAllowlistPlaceholder} className={inputCls} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Step 9: Search ─── */
function SearchStep({ form, setForm, searchProviders }: { form: FormData; setForm: (f: FormData) => void; searchProviders: SearchProviderInfo[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Search className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{t.configure.search.title}</h3></div>
      <p className="text-[13px] text-text-muted">{t.configure.search.subtitle}</p>
      <div className="space-y-1 border border-border rounded-xl p-2">
        <button onClick={() => setForm({ ...form, searchProvider: '', searchApiKey: '' })}
          className={`w-full text-left px-3 py-2.5 rounded-lg text-[12px] transition-all ${!form.searchProvider ? 'bg-accent/15 text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
          {t.configure.search.skip}
        </button>
        {searchProviders.map(sp => (
          <button key={sp.id} onClick={() => setForm({ ...form, searchProvider: sp.id })}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-[12px] transition-all ${form.searchProvider === sp.id ? 'bg-accent/15 text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
            {sp.name} <span className="text-text-muted ml-1">— {sp.hint}</span>
          </button>
        ))}
      </div>
      {form.searchProvider && (
        <div>
          <label className="text-[12px] font-medium text-text-muted block mb-1">{(searchProviders.find(s => s.id === form.searchProvider)?.name || '') + t.configure.search.apiKeySuffix}</label>
          <input type="password" value={form.searchApiKey} onChange={e => setForm({ ...form, searchApiKey: e.target.value })}
            placeholder={searchProviders.find(s => s.id === form.searchProvider)?.placeholder || t.configure.search.apiKeyPlaceholder}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
      )}
    </div>
  );
}

/* ─── Step 10: Skills ─── */
function SkillsStep({ form, setForm, skills }: { form: FormData; setForm: (f: FormData) => void; skills: SkillInfo[] }) {
  const installable = skills.filter(s => {
    const missing = s.missing && typeof s.missing === 'object' ? s.missing : {};
    const osRestriction = Array.isArray(missing.os) ? missing.os : [];
    return !s.disabled && osRestriction.length === 0;
  });
  const eligible = skills.filter(s => s.eligible && !s.disabled);
  const missingDeps = installable.filter(s => !s.eligible);
  const toggle = (name: string) => setForm({ ...form, selectedSkills: form.selectedSkills.includes(name) ? form.selectedSkills.filter(x => x !== name) : [...form.selectedSkills, name] });
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Wrench className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{t.configure.skills.title}</h3></div>
      <div className="bg-surface-0 border border-border rounded-xl p-4 text-[12px] flex gap-4">
        <span>{t.configure.skills.eligible} <span className="text-emerald-400 font-semibold">{eligible.length}</span></span>
        <span>{t.configure.skills.missingDeps} <span className="text-warning font-semibold">{missingDeps.length}</span></span>
        <span>{t.configure.skills.total} {skills.length}</span>
      </div>
      <p className="text-[13px] text-text-muted">{t.configure.skills.subtitle}</p>
      <div className="max-h-64 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
        {installable.map(s => {
          const isEligible = s.eligible;
          const missing = s.missing && typeof s.missing === 'object' ? s.missing : {};
          const missingBins = Array.isArray(missing.bins) ? missing.bins : [];
          return (
            <label key={s.name} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all ${form.selectedSkills.includes(s.name) ? 'bg-accent/10' : 'hover:bg-surface-2'}`}>
              <input type="checkbox" checked={form.selectedSkills.includes(s.name)} onChange={() => toggle(s.name)} className="sr-only" />
              <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${form.selectedSkills.includes(s.name) ? 'bg-accent border-accent' : 'border-text-muted'}`}>
                {form.selectedSkills.includes(s.name) && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
              <span className="text-[12px]">{s.emoji} {s.name}</span>
              <span className="text-[10px] ml-auto truncate max-w-[250px]">
                {isEligible
                  ? <span className="text-emerald-400">{t.configure.skills.ready}</span>
                  : <span className="text-text-muted">{t.configure.skills.needs} {missingBins.join(', ') || t.configure.skills.depsFallback}</span>
                }
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Step 11: Hooks ─── */
function HooksStep({ form, setForm, hooks }: { form: FormData; setForm: (f: FormData) => void; hooks: HookInfo[] }) {
  const { t } = useI18n();
  const toggle = (name: string) => setForm({ ...form, hooks: form.hooks.includes(name) ? form.hooks.filter(x => x !== name) : [...form.hooks, name] });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Plug className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{t.configure.hooks.title}</h3></div>
      <p className="text-[13px] text-text-muted">{t.configure.hooks.subtitle}</p>
      <div className="space-y-2">
        {hooks.map(h => (
          <label key={h.name} className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all ${form.hooks.includes(h.name) ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/30'}`}>
            <input type="checkbox" checked={form.hooks.includes(h.name)} onChange={() => toggle(h.name)} className="sr-only" />
            <span className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${form.hooks.includes(h.name) ? 'bg-accent border-accent' : 'border-text-muted'}`}>
              {form.hooks.includes(h.name) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 10 10"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            <div><p className="text-[13px] font-medium text-text-primary">{h.emoji} {h.name}</p><p className="text-[11px] text-text-muted">{h.description}</p></div>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ─── Step 12: Finalize ─── */
function FinalizeStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Rocket className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">{t.configure.finalize.title}</h3></div>
      <label className="flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all border-border hover:border-accent/30">
        <input type="checkbox" checked={form.installDaemon} onChange={e => setForm({ ...form, installDaemon: e.target.checked })} className="w-5 h-5 rounded accent-accent" />
        <div><p className="text-[13px] font-semibold text-text-primary">{t.configure.finalize.installDaemon}</p><p className="text-[11px] text-text-muted">{t.configure.finalize.installDaemonDesc}</p></div>
      </label>
    </div>
  );
}

/* ─── Step 13: Review ─── */
function _reviewGatewayBind(bind: string, g: Translations['configure']['gateway']): string {
  if (bind === 'loopback') return g.bindLoopback;
  if (bind === 'lan') return g.bindLan;
  if (bind === 'auto') return g.bindAuto;
  if (bind === 'custom') return g.bindCustom;
  if (bind === 'tailnet') return g.bindTailnet;
  return bind;
}

function _reviewGatewayAuth(mode: string, g: Translations['configure']['gateway']): string {
  if (mode === 'token') return g.authToken;
  if (mode === 'password') return g.authPassword;
  return mode;
}

function _reviewTailscale(mode: string, g: Translations['configure']['gateway']): string {
  if (mode === 'off') return g.tsOff;
  if (mode === 'serve') return g.tsServe;
  if (mode === 'funnel') return g.tsFunnel;
  return mode;
}

function _reviewFeishuConn(m: string, c: Translations['configure']['channels']): string {
  if (m === 'websocket') return c.wsDefault;
  if (m === 'webhook') return c.webhook;
  return m;
}

function _reviewFeishuGroup(p: string, c: Translations['configure']['channels']): string {
  if (p === 'open') return c.gpOpen;
  if (p === 'allowlist') return c.gpAllowlist;
  if (p === 'disabled') return c.gpDisabled;
  return p;
}

function ReviewStep({ form, authProviders, submitting }: { form: FormData; authProviders: AuthProviderInfo[]; submitting: boolean }) {
  const { t } = useI18n();
  const r = t.configure.review;
  const g = t.configure.gateway;
  const ch = t.configure.channels;
  const prov = authProviders.find(p => p.id === form.authProvider);
  const rows = form.mode === 'remote'
    ? [
        [r.mode, r.remoteGateway],
        [r.gatewayUrl, form.remoteUrl || r.notSet],
        [r.token, form.remoteToken ? '••••••••' : r.none],
      ]
    : [
        [r.mode, form.mode === 'local' ? r.modeLocal : r.modeRemote],
        [r.authProvider, prov?.name || form.authProvider || r.notSet],
        [r.defaultModel, form.modelId || r.notSet],
        [r.gateway, `${_reviewGatewayBind(form.gatewayBind, g)}:${form.gatewayPort}`],
        [r.auth, _reviewGatewayAuth(form.gatewayAuthMode, g)],
        [r.tailscale, _reviewTailscale(form.tailscaleMode, g)],
        [r.search, form.searchProvider || r.skip],
        [r.daemon, form.installDaemon ? r.install : r.skip],
        [r.workspace, form.workspace],
        [r.hooks, form.hooks.length > 0 ? form.hooks.join(', ') : r.noneList],
        [r.channels, form.channels.length > 0 ? form.channels.join(', ') : r.noneList],
        ...(form.channels.includes('feishu') ? [
          [r.feishuDomain, form.feishuDomain === 'lark' ? r.larkIntl : r.feishuChina],
          [r.feishuMode, _reviewFeishuConn(form.feishuConnectionMode, ch)],
          [r.feishuGroup, _reviewFeishuGroup(form.feishuGroupPolicy, ch)],
        ] as [string, string][] : []),
        [r.skills, form.selectedSkills.length > 0 ? form.selectedSkills.join(', ') : r.none],
      ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-400" /><h3 className="text-lg font-bold text-text-primary">{t.configure.reviewTitle}</h3></div>
      <div className="bg-surface-0 border border-border rounded-xl overflow-hidden">
        <table className="w-full text-[12px]"><tbody>
          {rows.map(([k, v], i) => (
            <tr key={`${i}-${k}`} className="border-b border-border/40 last:border-b-0">
              <td className="px-4 py-2 text-text-muted font-medium w-28">{k}</td>
              <td className="px-4 py-2 text-text-primary font-mono">{v}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
      {submitting && <div className="flex items-center gap-2 text-accent text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> {t.configure.applying}</div>}
    </div>
  );
}

const SETUP_PLATFORM_KEY = 'xsafeclaw_setup_platform';

/** Hermes: short wizard (security → status → API key → done). OpenClaw onboard is not used. */
function HermesConfigureFlow({ initialStatus }: { initialStatus: Record<string, unknown> }) {
  const { t } = useI18n();
  const h = t.configure.hermes;
  const TOTAL_STEPS = 4;
  const [step, setStep] = useState(0);
  const [st, setSt] = useState<Record<string, unknown>>(initialStatus);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [hermesApiKey, setHermesApiKey] = useState('');
  const [showHermesKey, setShowHermesKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keySaveResult, setKeySaveResult] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [keySaveError, setKeySaveError] = useState('');
  const keyAlreadyConfigured = st.hermes_api_key_configured === true;

  const hermesLabels = [h.steps.security, h.steps.status, h.steps.apiKey, h.steps.done];
  const hermesSkipped = new Set<number>();

  async function refreshStatus() {
    setRefreshing(true);
    try {
      const res = await systemAPI.status();
      setSt(res.data as Record<string, unknown>);
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  }

  async function saveHermesApiKey() {
    setSavingKey(true);
    setKeySaveResult('idle');
    setKeySaveError('');
    try {
      await systemAPI.saveHermesApiKey(hermesApiKey.trim());
      setKeySaveResult('ok');
      setSt(prev => ({ ...prev, hermes_api_key_configured: !!hermesApiKey.trim() }));
    } catch (err: any) {
      setKeySaveResult('fail');
      setKeySaveError(err?.response?.data?.detail || String(err));
    } finally {
      setSavingKey(false);
    }
  }

  const canNextHermes = (): boolean => {
    if (step === 0) return riskAccepted;
    return true;
  };

  function goNextHermes() {
    if (step < TOTAL_STEPS - 1) setStep(step + 1);
  }
  function goBackHermes() {
    if (step > 0) setStep(step - 1);
  }

  const hermesPath = (st.hermes_path as string) || '—';
  const version = (st.openclaw_version as string) || '—';
  const apiPort = (st.hermes_api_port as number) ?? '—';
  const cfgPath = (st.hermes_config_path as string) || '—';
  const home = (st.hermes_home as string) || '—';
  const gwOk = st.daemon_running === true;
  const cfgExists = st.config_exists === true;

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src="/logo.png" alt="XSafeClaw" className="w-12 h-12 object-contain rounded-xl shadow-lg shadow-accent/25" />
          <p className="text-[15px] font-semibold text-text-primary">{h.pageTitle}</p>
          <p className="text-[12px] text-text-muted text-center max-w-lg">{h.pageSubtitle}</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <StepProgress current={step} skipped={hermesSkipped} labels={hermesLabels} />

          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-warning" /><h3 className="text-lg font-bold text-text-primary">{h.security.title}</h3></div>
              <div className="bg-warning/5 border border-warning/20 rounded-xl p-5 text-[12px] text-text-secondary leading-relaxed space-y-2">
                <p className="font-semibold text-text-primary">{h.security.prompt}</p>
                <ul className="list-disc pl-4 space-y-1">
                  {h.security.items.map((item: string, i: number) => <li key={i}>{item}</li>)}
                </ul>
                <p className="text-[11px] text-text-muted">{h.security.recommend}</p>
              </div>
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-border hover:border-violet-500/30 transition-all">
                <input type="checkbox" checked={riskAccepted} onChange={e => setRiskAccepted(e.target.checked)} className="w-4 h-4 rounded accent-violet-500" />
                <span className="text-[13px] font-medium text-text-primary">{h.security.checkbox}</span>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-lg font-bold text-text-primary">{h.statusTitle}</h3>
                  <p className="text-[12px] text-text-muted mt-1">{h.statusDesc}</p>
                </div>
                <button type="button" onClick={refreshStatus} disabled={refreshing}
                  className="flex items-center gap-2 px-3 py-2 text-[12px] font-medium rounded-lg border border-border hover:bg-surface-2 text-text-secondary">
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> {h.refresh}
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  [h.labelBinary, hermesPath],
                  [h.labelVersion, version],
                  [h.labelHome, home],
                  [h.labelConfig, cfgPath],
                  [h.labelApiPort, String(apiPort)],
                  [h.labelGateway, gwOk ? h.gatewayUp : h.gatewayDown],
                  [h.labelConfigStatus, cfgExists ? h.configPresent : h.configMissing],
                ].map(([k, v], i) => (
                  <div key={i} className="bg-surface-0 border border-border rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted font-medium">{k}</p>
                    <p className="text-[12px] text-text-primary font-mono break-all mt-1">{v}</p>
                  </div>
                ))}
              </div>
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 space-y-2">
                <p className="text-[12px] font-semibold text-text-primary">{h.envHintTitle}</p>
                <p className="text-[11px] text-text-muted leading-relaxed">{h.envHintBody}</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2"><Key className="w-5 h-5 text-violet-400" /><h3 className="text-lg font-bold text-text-primary">{h.apiKeyTitle}</h3></div>
              <p className="text-[13px] text-text-secondary leading-relaxed">{h.apiKeyDesc}</p>

              <div className="bg-surface-0 border border-border rounded-xl p-4 text-[12px] text-text-muted space-y-2 leading-relaxed">
                <p className="font-semibold text-text-primary">{h.apiKeyGuideTitle}</p>
                <ol className="list-decimal pl-4 space-y-1">
                  {h.apiKeyGuideSteps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                </ol>
              </div>

              {keyAlreadyConfigured && keySaveResult !== 'ok' && (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-[12px] text-emerald-400">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{h.apiKeyAlreadySet}</span>
                </div>
              )}

              <div>
                <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{h.apiKeyLabel}</label>
                <div className="relative">
                  <input
                    type={showHermesKey ? 'text' : 'password'}
                    value={hermesApiKey}
                    onChange={e => { setHermesApiKey(e.target.value); setKeySaveResult('idle'); }}
                    placeholder={keyAlreadyConfigured ? h.apiKeyPlaceholderUpdate : h.apiKeyPlaceholder}
                    className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                  <button onClick={() => setShowHermesKey(!showHermesKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                    {showHermesKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-text-muted mt-1.5">{h.apiKeyHint}</p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={saveHermesApiKey} disabled={savingKey || !hermesApiKey.trim()}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-[12px] font-semibold rounded-lg transition-all">
                  {savingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                  {h.apiKeySaveBtn}
                </button>
                {keySaveResult === 'ok' && <span className="text-[12px] text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />{h.apiKeySaved}</span>}
                {keySaveResult === 'fail' && <span className="text-[12px] text-red-400 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{keySaveError || h.apiKeySaveFailed}</span>}
              </div>

              <p className="text-[11px] text-text-muted">{h.apiKeySkipHint}</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-400" /><h3 className="text-lg font-bold text-text-primary">{h.doneTitle}</h3></div>
              <p className="text-[13px] text-text-secondary leading-relaxed">{h.doneDesc}</p>
              <div className="bg-surface-0 border border-border rounded-xl p-4 space-y-2">
                <p className="text-[12px] font-semibold text-text-primary">{h.hintTitle}</p>
                <p className="text-[12px] text-text-muted leading-relaxed">{h.hintBody}</p>
              </div>
              <button type="button" onClick={() => window.location.replace('/agent-valley')}
                className="flex items-center gap-2 px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/25">
                <Settings2 className="w-4 h-4" /> {t.configure.enterAgentValley} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <button type="button" onClick={goBackHermes} disabled={step === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text-primary disabled:opacity-30 transition-all">
              <ChevronLeft className="w-4 h-4" /> {t.common.back}
            </button>
            {step < TOTAL_STEPS - 1 ? (
              <button type="button" onClick={goNextHermes} disabled={!canNextHermes()}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-[13px] font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/25">
                {t.common.next} <ChevronRight className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>
        <p className="text-center text-[11px] text-text-muted mt-6">{t.common.poweredBy}</p>
      </div>
    </div>
  );
}

/* ─── Main ─── */
export default function Configure() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [agentFlow, setAgentFlow] = useState<'loading' | 'openclaw' | 'hermes'>('loading');
  const [hermesStatusSnapshot, setHermesStatusSnapshot] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [showApiKey, setShowApiKey] = useState(false);
  const [authProviders, setAuthProviders] = useState<AuthProviderInfo[]>([]);
  const [modelProviders, setModelProviders] = useState<ModelProviderInfo[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [hooks, setHooks] = useState<HookInfo[]>([]);
  const [searchProviders, setSearchProviders] = useState<SearchProviderInfo[]>([]);
  const [configExists, setConfigExists] = useState(false);
  const [configSummary, setConfigSummary] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const statusRes = await systemAPI.status();
        if (cancelled) return;

        const st = statusRes.data as Record<string, unknown> & {
          platform?: string;
          hermes_installed?: boolean;
          openclaw_installed?: boolean;
        };
        const pref = typeof localStorage !== 'undefined' ? localStorage.getItem(SETUP_PLATFORM_KEY) : null;

        const useHermes =
          st.platform === 'hermes'
          || (pref === 'hermes' && st.hermes_installed === true)
          || (st.hermes_installed === true && st.openclaw_installed !== true);

        if (useHermes) {
          if (typeof localStorage !== 'undefined') localStorage.removeItem(SETUP_PLATFORM_KEY);
          setHermesStatusSnapshot(st);
          setAgentFlow('hermes');
          return;
        }

        if (typeof localStorage !== 'undefined' && pref === 'openclaw') {
          localStorage.removeItem(SETUP_PLATFORM_KEY);
        }

        const res = await systemAPI.onboardScan();
        if (cancelled) return;

        const d = res.data as any;
        setAuthProviders(d.auth_providers || []);
        setModelProviders(d.model_providers || []);
        setChannels(d.channels || []);
        setSkills(d.skills || []);
        setHooks(d.hooks || []);
        setSearchProviders(d.search_providers || []);
        setConfigExists(d.config_exists ?? false);
        setConfigSummary(d.config_summary || []);
        const defs = d.defaults || {};
        setForm(prev => ({ ...prev,
          gatewayPort: defs.gateway_port || prev.gatewayPort,
          gatewayBind: defs.gateway_bind || prev.gatewayBind,
          gatewayAuthMode: defs.gateway_auth_mode || prev.gatewayAuthMode,
          gatewayToken: defs.gateway_token || prev.gatewayToken,
          tailscaleMode: defs.tailscale_mode || prev.tailscaleMode,
          workspace: defs.workspace || prev.workspace,
          hooks: defs.enabled_hooks?.length ? defs.enabled_hooks : prev.hooks,
          searchProvider: defs.search_provider || prev.searchProvider,
          searchApiKey: defs.search_api_key || prev.searchApiKey,
        }));
        setAgentFlow('openclaw');
      } catch {
        if (!cancelled) setAgentFlow('openclaw');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [navigate]);

  const skipped = new Set<number>();
  skipped.add(9);
  if (form.wizardMode === 'quickstart') { [3, 4, 6, 7, 8, 10, 11].forEach(i => skipped.add(i)); }
  if (!configExists) skipped.add(2);
  if (form.mode === 'remote') { [4, 5, 6, 7, 8, 10, 11].forEach(i => skipped.add(i)); }

  const canNext = useCallback((): boolean => {
    if (step === 0) return form.riskAccepted;
    if (step === 2) {
      if (!form.configAction) return false;
      if (form.configAction === 'reset') return !!form.resetScope;
      return true;
    }
    if (step === 3 && form.mode === 'remote') {
      const url = form.remoteUrl.trim();
      return url.startsWith('ws://') || url.startsWith('wss://');
    }
    if (step === 5) {
      if (!form.authProvider) return false;
      if (form.authProvider === 'skip') return true;
      const prov = authProviders.find(p => p.id === form.authProvider);
      if (!prov?.supported) return false;
      const methods = prov?.methods || [];
      if (methods.length > 1 && !form.authMethod) return false;
      if (form.authProvider === 'cloudflare-ai-gateway' && (!form.cfAccountId.trim() || !form.cfGatewayId.trim())) return false;
      if (form.authProvider === 'vllm') return !!form.vllmBaseUrl.trim() && !!form.vllmModelId.trim();
      if (form.authProvider === 'custom') return !!form.customBaseUrl.trim() && !!form.customModelId.trim();
      return !!form.modelId;
    }
    if (step === 7) {
      if (form.channels.includes('feishu')) {
        if (!form.feishuAppId.trim() || !form.feishuAppSecret.trim()) return false;
        if (form.feishuConnectionMode === 'webhook' && !form.feishuVerificationToken.trim()) return false;
      }
      return true;
    }
    return true;
  }, [step, form, authProviders]);

  async function goNext() {
    if (step === 2 && form.configAction === 'reset' && form.resetScope) {
      try {
        setSubmitting(true);
        await systemAPI.configReset(form.resetScope, form.workspace);
        setConfigSummary([]);
        setForm(prev => ({
          ...INITIAL,
          wizardMode: prev.wizardMode,
          riskAccepted: prev.riskAccepted,
          configAction: 'reset',
          resetScope: prev.resetScope,
        }));
      } catch (err: any) {
        setError(err.response?.data?.detail || String(err));
        return;
      } finally {
        setSubmitting(false);
      }
    }

    let n = step + 1;
    while (n < 13 && skipped.has(n)) n++;
    if (n > 12) n = 12;
    setStep(n); setError('');
  }
  function goBack() {
    let n = step - 1;
    while (n >= 0 && skipped.has(n)) n--;
    if (n < 0) n = 0;
    setStep(n); setError('');
  }

  async function handleSubmit() {
    setSubmitting(true); setError('');
    try {
      const effectiveProvider = form.authMethod || (authProviders.find(p => p.id === form.authProvider)?.methods?.[0]?.id) || form.authProvider;
      await systemAPI.onboardConfig({
        mode: form.mode, provider: effectiveProvider, api_key: form.apiKey, model_id: form.modelId,
        gateway_port: form.gatewayPort, gateway_bind: form.gatewayBind, gateway_auth_mode: form.gatewayAuthMode,
        gateway_token: form.gatewayToken, channels: form.channels, hooks: form.hooks,
        workspace: form.workspace, install_daemon: form.installDaemon, tailscale_mode: form.tailscaleMode,
        search_provider: form.searchProvider, search_api_key: form.searchApiKey,
        remote_url: form.remoteUrl, remote_token: form.remoteToken, selected_skills: form.selectedSkills,
        feishu_app_id: form.feishuAppId, feishu_app_secret: form.feishuAppSecret,
        feishu_connection_mode: form.feishuConnectionMode, feishu_domain: form.feishuDomain,
        feishu_group_policy: form.feishuGroupPolicy,
        feishu_group_allow_from: form.feishuGroupAllowFrom ? form.feishuGroupAllowFrom.split(',').map(s => s.trim()).filter(Boolean) : [],
        feishu_verification_token: form.feishuVerificationToken, feishu_webhook_path: form.feishuWebhookPath,
        cf_account_id: form.cfAccountId, cf_gateway_id: form.cfGatewayId, litellm_base_url: form.litellmBaseUrl,
        vllm_base_url: form.vllmBaseUrl, vllm_model_id: form.vllmModelId,
        custom_base_url: form.customBaseUrl, custom_model_id: form.customModelId,
        custom_provider_id: form.customProviderId, custom_compatibility: form.customCompatibility,
      });
      setDone(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || String(err));
    } finally { setSubmitting(false); }
  }

  if (loading) return <div className="min-h-screen bg-surface-0 flex items-center justify-center"><Loader2 className="w-8 h-8 text-accent animate-spin" /></div>;

  if (agentFlow === 'hermes' && hermesStatusSnapshot) {
    return <HermesConfigureFlow initialStatus={hermesStatusSnapshot} />;
  }

  if (done) return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center gap-3 mb-8"><img src="/logo.png" alt="XSafeClaw" className="w-16 h-16 object-contain rounded-xl shadow-lg shadow-accent/25" /></div>
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center"><CheckCircle className="w-9 h-9 text-emerald-400" /></div>
            <div className="text-center">
              <p className="text-lg font-bold text-text-primary">{form.mode === 'remote' ? t.configure.remoteComplete : t.configure.configComplete}</p>
              <p className="text-[13px] text-text-secondary mt-2">{form.mode === 'remote' ? t.configure.remoteCompleteDesc : t.configure.configCompleteDesc}</p>
            </div>
            <button onClick={() => window.location.replace('/agent-valley')}
              className="flex items-center gap-2 px-8 py-3 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/25">
              <Settings2 className="w-4 h-4" /> {t.configure.enterAgentValley} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src="/logo.png" alt="XSafeClaw" className="w-12 h-12 object-contain rounded-xl shadow-lg shadow-accent/25" />
          <p className="text-[13px] text-text-muted">{t.configure.title}</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <StepProgress current={step} skipped={skipped} labels={Object.values(t.configure.steps)} />
          {step === 0 && <SecurityStep form={form} setForm={setForm} />}
          {step === 1 && <ModeStep form={form} setForm={setForm} />}
          {step === 2 && <ConfigStep form={form} setForm={setForm} configSummary={configSummary} />}
          {step === 3 && <SetupTypeStep form={form} setForm={setForm} />}
          {step === 4 && <WorkspaceStep form={form} setForm={setForm} />}
          {step === 5 && (
            <AuthProviderStep
              form={form}
              setForm={setForm}
              authProviders={authProviders}
              modelProviders={modelProviders}
              showKey={showApiKey}
              setShowKey={setShowApiKey}
            />
          )}
          {step === 6 && <GatewayStep form={form} setForm={setForm} />}
          {step === 7 && <ChannelsStep form={form} setForm={setForm} channels={channels} />}
          {step === 8 && <SearchStep form={form} setForm={setForm} searchProviders={searchProviders} />}
          {step === 9 && <SkillsStep form={form} setForm={setForm} skills={skills} />}
          {step === 10 && <HooksStep form={form} setForm={setForm} hooks={hooks} />}
          {step === 11 && <FinalizeStep form={form} setForm={setForm} />}
          {step === 12 && <ReviewStep form={form} authProviders={authProviders} submitting={submitting} />}
          {error && <div className="flex items-center gap-2 mt-4 text-red-400 text-[12px]"><XCircle className="w-4 h-4" /> {error}</div>}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <button onClick={goBack} disabled={step === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text-primary disabled:opacity-30 transition-all">
              <ChevronLeft className="w-4 h-4" /> {t.common.back}
            </button>
            {step < 12 ? (
              <button onClick={goNext} disabled={!canNext()}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-40 text-white text-[13px] font-semibold rounded-xl transition-all shadow-lg shadow-accent/25">
                {t.common.next} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[13px] font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/25">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {submitting ? t.configure.applyingBtn : t.configure.applyBtn}
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-text-muted mt-6">{t.common.poweredBy}</p>
      </div>
    </div>
  );
}
