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

const STEP_LABELS = ['Security','Mode','Config','Setup','Workspace','Provider','Gateway','Channels','Search','Skills','Hooks','Finalize','Review'];

/* ─── Progress Bar ─── */
function StepProgress({ current, skipped }: { current: number; skipped: Set<number> }) {
  return (
    <div className="flex items-center justify-center gap-0.5 mb-6">
      {STEP_LABELS.map((label, i) => {
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
            {i < STEP_LABELS.length - 1 && <div className={`w-4 h-0.5 mx-0.5 mb-3 ${done && !skipped.has(i + 1) ? 'bg-emerald-500/60' : 'bg-border/50'}`} />}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Step 0: Security ─── */
function SecurityStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-warning" /><h3 className="text-lg font-bold text-text-primary">Security Notice</h3></div>
      <div className="bg-warning/5 border border-warning/20 rounded-xl p-5 text-[12px] text-text-secondary leading-relaxed space-y-2">
        <p className="font-semibold text-text-primary">Please read before continuing.</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>OpenClaw is a personal agent with one trusted operator boundary by default.</li>
          <li>This bot can read files and run actions if tools are enabled. A bad prompt can trick it into doing unsafe things.</li>
          <li>If multiple users can message one tool-enabled agent, they share that delegated tool authority.</li>
          <li>If you're not comfortable with security hardening, don't run OpenClaw without help.</li>
        </ul>
        <p className="text-[11px] text-text-muted">Recommended: pairing/allowlists, sandbox tools, keep secrets out of agent's reach. Run <code className="text-accent">openclaw security audit --deep</code> regularly.</p>
      </div>
      <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-border hover:border-accent/30 transition-all">
        <input type="checkbox" checked={form.riskAccepted} onChange={e => setForm({ ...form, riskAccepted: e.target.checked })} className="w-4 h-4 rounded accent-accent" />
        <span className="text-[13px] font-medium text-text-primary">I understand this is personal-by-default and shared/multi-user use requires lock-down.</span>
      </label>
    </div>
  );
}

/* ─── Step 1: Mode ─── */
function ModeStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-text-primary">Onboarding Mode</h3>
      <p className="text-[13px] text-text-muted">Choose how you want to configure OpenClaw.</p>
      <div className="grid grid-cols-2 gap-4">
        {[
          { id: 'quickstart', icon: Zap, title: 'QuickStart', desc: 'Use sensible defaults. Configure details later.' },
          { id: 'manual', icon: Settings2, title: 'Manual', desc: 'Configure port, network, Tailscale, channels, search, and skills.' },
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
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-text-primary">Existing Configuration Detected</h3>

      {configSummary.length > 0 && (
        <div className="bg-surface-0 border border-border rounded-xl p-4 font-mono text-[12px] space-y-0.5">
          {configSummary.map((line, i) => {
            const [key, ...rest] = line.split(': ');
            return <p key={i} className="text-text-secondary">{key}: <span className="text-text-primary">{rest.join(': ')}</span></p>;
          })}
          {configSummary.length === 0 && <p className="text-text-muted">No key settings detected.</p>}
        </div>
      )}

      <div className="space-y-3">
        {[
          { id: 'keep', icon: CheckCircle, title: 'Use existing values', desc: 'Keep your current configuration.' },
          { id: 'update', icon: RefreshCw, title: 'Update values', desc: 'Modify specific settings.' },
          { id: 'reset', icon: Trash2, title: 'Reset', desc: 'Start fresh with a new configuration.' },
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
          <p className="text-[12px] font-semibold text-text-primary">Reset scope</p>
          {[
            { id: 'config', title: 'Config only', desc: 'Delete openclaw.json only.' },
            { id: 'config+creds+sessions', title: 'Config + credentials + sessions', desc: 'Delete config, API keys, and session history.' },
            { id: 'full', title: 'Full reset (config + creds + sessions + workspace)', desc: 'Delete everything and start completely fresh.' },
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
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-text-primary">What do you want to set up?</h3>
      <div className="space-y-3">
        {[
          { id: 'local', icon: Server, title: 'Local gateway (this machine)', desc: 'Run the gateway on this machine.' },
          { id: 'remote', icon: Globe, title: 'Remote gateway (info-only)', desc: 'Connect to a gateway running elsewhere.' },
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
          <p className="text-[11px] text-text-muted">Selecting remote will skip local gateway steps and jump directly to review.</p>
          <div><label className="text-[12px] font-medium text-text-muted block mb-1">Gateway WebSocket URL</label>
            <input type="text" value={form.remoteUrl} onChange={e => setForm({ ...form, remoteUrl: e.target.value })} placeholder="wss://192.168.1.100:18789"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
            {form.remoteUrl.trim() && !form.remoteUrl.trim().startsWith('ws://') && !form.remoteUrl.trim().startsWith('wss://') && (
              <p className="text-[11px] text-red-400 mt-1">URL must start with ws:// or wss://</p>
            )}
          </div>
          <div><label className="text-[12px] font-medium text-text-muted block mb-1">Remote Token (optional)</label>
            <input type="password" value={form.remoteToken} onChange={e => setForm({ ...form, remoteToken: e.target.value })} placeholder="Gateway token"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" /></div>
        </div>
      )}
    </div>
  );
}

/* ─── Step 4: Workspace ─── */
function WorkspaceStep({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><FolderOpen className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">Workspace Directory</h3></div>
      <p className="text-[13px] text-text-muted">Where OpenClaw stores agent workspace files.</p>
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
            {filtered.length === 0 && <p className="text-[12px] text-text-muted p-3 text-center">No results</p>}
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
  const [manual, setManual] = useState(false);
  const selected = authProviders.find(p => p.id === form.authProvider);
  const isSupported = selected?.supported ?? false;
  const methods = selected?.methods || [];
  const hasMultipleMethods = methods.length > 1;
  const effectiveMethod = form.authMethod || (methods.length === 1 ? methods[0]?.id : '');
  const keyUrl = PROVIDER_KEY_URLS[form.authProvider] || '';
  const AGGREGATOR_PROVIDERS = new Set([
    'openrouter', 'kilocode', 'litellm', 'ai-gateway', 'cloudflare-ai-gateway',
    'opencode', 'synthetic', 'together', 'huggingface', 'venice', 'skip',
  ]);
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
      <div className="flex items-center gap-2"><Key className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">Model / Auth Provider</h3></div>

      {/* 1. Provider 选择 */}
      <div>
        <label className="text-[12px] font-semibold text-text-primary block mb-1.5">1. Select Provider</label>
        <SearchableDropdown
          label=""
          value={form.authProvider}
          displayValue={selected ? `${selected.name}${selected.hint ? ` — ${selected.hint}` : ''}` : ''}
          placeholder="Choose a provider..."
          searchPlaceholder="Search providers..."
          options={authProviders.map(p => ({
            id: p.id,
            label: p.name + (p.supported ? '' : ' — requires CLI'),
            hint: p.hint || '',
          }))}
          onSelect={id => {
            const prov = authProviders.find(p => p.id === id);
            if (!prov?.supported && id !== 'skip') return;
            const provMethods = prov?.methods || [];
            setForm({
              ...form,
              authProvider: id,
              authMethod: provMethods.length === 1 ? provMethods[0].id : '',
              apiKey: '', modelId: '',
              cfAccountId: '', cfGatewayId: '', litellmBaseUrl: 'http://localhost:4000',
              vllmBaseUrl: 'http://127.0.0.1:8000/v1', vllmModelId: '',
              customBaseUrl: '', customModelId: '', customProviderId: '', customCompatibility: 'openai',
            });
          }}
        />
      </div>

      {/* 2. Auth Method 子选（如果 provider 有多个方法） */}
      {isSupported && hasMultipleMethods && (
        <div>
          <label className="text-[12px] font-semibold text-text-primary block mb-1.5">2. {selected?.name} auth method</label>
          <div className="space-y-1.5">
            {methods.map(m => (
              <button key={m.id} onClick={() => setForm({ ...form, authMethod: m.id, apiKey: '', modelId: '' })}
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
            {hasMultipleMethods ? '3' : '2'}. API Key
            {keyUrl && <a href={keyUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent hover:underline text-[11px] font-normal">Get key →</a>}
          </label>
          <div className="relative">
            <input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
              placeholder="Paste your API key..."
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
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">Account ID</label>
            <input type="text" value={form.cfAccountId} onChange={e => setForm({ ...form, cfAccountId: e.target.value })}
              placeholder="Cloudflare Account ID"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">Gateway ID</label>
            <input type="text" value={form.cfGatewayId} onChange={e => setForm({ ...form, cfGatewayId: e.target.value })}
              placeholder="Cloudflare Gateway ID"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
        </div>
      )}

      {/* LiteLLM — base URL */}
      {showApiKey && methodReady && form.authProvider === 'litellm' && (
        <div>
          <label className="text-[12px] font-semibold text-text-primary block mb-1.5">Base URL</label>
          <input type="text" value={form.litellmBaseUrl} onChange={e => setForm({ ...form, litellmBaseUrl: e.target.value })}
            placeholder="http://localhost:4000"
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          <p className="text-[11px] text-text-muted mt-1">LiteLLM proxy server address (default: http://localhost:4000)</p>
        </div>
      )}

      {/* vLLM — base URL + model ID */}
      {form.authProvider === 'vllm' && (
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">2. Base URL</label>
            <input type="text" value={form.vllmBaseUrl} onChange={e => setForm({ ...form, vllmBaseUrl: e.target.value })}
              placeholder="http://127.0.0.1:8000/v1"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
            <p className="text-[11px] text-text-muted mt-1">vLLM server address with /v1 suffix</p>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">3. API Key</label>
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder="vLLM API key (if required)"
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
              <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">4. Model ID</label>
            <input type="text" value={form.vllmModelId} onChange={e => setForm({ ...form, vllmModelId: e.target.value })}
              placeholder="e.g. meta-llama/Meta-Llama-3-8B-Instruct"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
        </div>
      )}

      {/* Custom provider — base URL + model ID + compatibility */}
      {form.authProvider === 'custom' && (
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">2. Base URL</label>
            <input type="text" value={form.customBaseUrl} onChange={e => setForm({ ...form, customBaseUrl: e.target.value })}
              placeholder="https://your-llm-server.com/v1"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">3. API Key <span className="text-text-muted font-normal">(optional)</span></label>
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder="API key for your endpoint"
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
              <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">4. Model ID</label>
            <input type="text" value={form.customModelId} onChange={e => setForm({ ...form, customModelId: e.target.value })}
              placeholder="e.g. my-model-large"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">5. API Compatibility</label>
            <div className="flex gap-3">
              {['openai', 'anthropic'].map(mode => (
                <button key={mode} onClick={() => setForm({ ...form, customCompatibility: mode })}
                  className={`flex-1 px-4 py-2.5 rounded-xl border-2 text-[13px] font-medium transition-all
                    ${form.customCompatibility === mode ? 'border-accent bg-accent/5 text-text-primary' : 'border-border text-text-secondary hover:border-accent/30'}`}>
                  {mode === 'openai' ? 'OpenAI Compatible' : 'Anthropic Compatible'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-primary block mb-1.5">6. Provider ID <span className="text-text-muted font-normal">(optional, auto-derived from URL)</span></label>
            <input type="text" value={form.customProviderId} onChange={e => setForm({ ...form, customProviderId: e.target.value })}
              placeholder="e.g. my-llm-server"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
        </div>
      )}

      {/* 4. Default Model */}
      {showModel && !manual && visibleModels.length > 0 && (
        <div>
          <SearchableDropdown
            label={`${hasMultipleMethods ? '4' : '3'}. Default Model`}
            value={form.modelId}
            displayValue={selectedModel ? `${selectedModel.name}${selectedModel.contextWindow ? ` (${Math.round(selectedModel.contextWindow / 1024)}K)` : ''}` : form.modelId}
            placeholder="Choose a model..."
            searchPlaceholder="Search models..."
            options={visibleModels.map(m => ({ id: m.id, label: m.name, hint: `${m.contextWindow ? `${Math.round(m.contextWindow / 1024)}K` : ''}${m.reasoning ? ' · reasoning' : ''}` }))}
            onSelect={id => setForm({ ...form, modelId: id })}
          />
          <button onClick={() => setManual(true)} className="text-[11px] text-accent mt-2 hover:underline">Enter model ID manually</button>
        </div>
      )}

      {showModel && (manual || visibleModels.length === 0) && (
        <div>
          <label className="text-[12px] font-semibold text-text-primary block mb-1.5">{hasMultipleMethods ? '4' : '3'}. Model ID</label>
          <input type="text" value={form.modelId} onChange={e => setForm({ ...form, modelId: e.target.value })} placeholder="provider/model-name"
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          {visibleModels.length > 0 && (
            <button onClick={() => setManual(false)} className="text-[11px] text-accent mt-2 hover:underline">Back to model list</button>
          )}
        </div>
      )}

      {/* Not supported hint */}
      {form.authProvider && !isSupported && form.authProvider !== 'skip' && (
        <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 text-[12px] text-text-muted">
          This provider requires interactive CLI setup. Run <code className="text-accent">openclaw onboard</code> to configure it.
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
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Server className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">Gateway Configuration</h3></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-[12px] font-medium text-text-muted block mb-1">Port</label>
          <input type="number" value={form.gatewayPort} onChange={e => setForm({ ...form, gatewayPort: Number(e.target.value) })}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30" /></div>
        <div><label className="text-[12px] font-medium text-text-muted block mb-1">Bind Address</label>
          <select value={form.gatewayBind} onChange={e => setForm({ ...form, gatewayBind: e.target.value })}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="loopback">Loopback (127.0.0.1)</option><option value="lan">LAN (0.0.0.0)</option><option value="auto">Auto</option><option value="custom">Custom IP</option><option value="tailnet">Tailnet</option>
          </select></div>
        <div><label className="text-[12px] font-medium text-text-muted block mb-1">Auth Mode</label>
          <select value={form.gatewayAuthMode} onChange={e => setForm({ ...form, gatewayAuthMode: e.target.value })}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="token">Token (recommended)</option><option value="password">Password</option>
          </select></div>
        <div><label className="text-[12px] font-medium text-text-muted block mb-1">Tailscale Exposure</label>
          <select value={form.tailscaleMode} onChange={e => setForm({ ...form, tailscaleMode: e.target.value })}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="off">Off</option><option value="serve">Serve (private HTTPS)</option><option value="funnel">Funnel (public HTTPS)</option>
          </select></div>
      </div>
      <div><label className="text-[12px] font-medium text-text-muted block mb-1">Gateway Token (blank to auto-generate)</label>
        <input type="text" value={form.gatewayToken} onChange={e => setForm({ ...form, gatewayToken: e.target.value })} placeholder="Leave blank to auto-generate"
          className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/30" /></div>
    </div>
  );
}

/* ─── Step 8: Channels ─── */
function ChannelsStep({ form, setForm, channels }: { form: FormData; setForm: (f: FormData) => void; channels: ChannelInfo[] }) {
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
        setTestMsg(`Connected as ${res.data.bot_name || res.data.bot_open_id || 'bot'}`);
      } else {
        setTestStatus('fail');
        setTestMsg(res.data.error || 'Unknown error');
      }
    } catch (err: any) {
      setTestStatus('fail');
      setTestMsg(err?.response?.data?.detail || String(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Plug className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">Select Channels</h3></div>
      <p className="text-[13px] text-text-muted">Select communication channels to enable.</p>
      <div className="max-h-52 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
        {channels.map(ch => {
          const supported = SUPPORTED.has(ch.id);
          const selected = form.channels.includes(ch.id);
          return (
            <button key={ch.id} onClick={() => toggle(ch.id)} disabled={!supported}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-[12px] transition-all flex items-center justify-between
                ${!supported ? 'text-text-muted/40 cursor-not-allowed' : selected ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-surface-2'}`}>
              <span>{ch.name}{ch.configured ? ' (configured)' : ''}{!supported ? ' — coming soon' : ''}</span>
              {selected && <CheckCircle className="w-3.5 h-3.5" />}
            </button>
          );
        })}
      </div>

      {form.channels.includes('feishu') && (
        <div className="border border-accent/30 rounded-xl p-4 space-y-4 bg-accent/5">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-accent" />
            <span className="text-[13px] font-semibold text-text-primary">Feishu / Lark Configuration</span>
          </div>

          {/* Credential help */}
          <div className="bg-surface-0 border border-border rounded-lg p-3 text-[11px] text-text-muted space-y-1">
            <p>1. Go to <a href="https://open.feishu.cn" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Feishu Open Platform</a></p>
            <p>2. Create a self-built app</p>
            <p>3. Get App ID and App Secret from Credentials page</p>
            <p>4. Enable permissions: im:message, im:chat, contact:user.base:readonly</p>
            <p>5. Publish the app or add it to a test group</p>
            <p className="text-text-muted/60">Tip: you can also set FEISHU_APP_ID / FEISHU_APP_SECRET env vars.</p>
          </div>

          {/* App ID + App Secret */}
          <div>
            <label className={labelCls}>App Secret</label>
            <input type="password" value={form.feishuAppSecret} onChange={e => setForm({ ...form, feishuAppSecret: e.target.value })}
              placeholder="Enter App Secret..." className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>App ID</label>
            <input type="text" value={form.feishuAppId} onChange={e => setForm({ ...form, feishuAppId: e.target.value })}
              placeholder="cli_xxxxxxxxxxxxxxxx" className={inputCls} />
          </div>

          {/* Connection test */}
          {form.feishuAppId && form.feishuAppSecret && (
            <div className="flex items-center gap-3">
              <button onClick={runTest} disabled={testStatus === 'testing'}
                className="px-4 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-[12px] font-semibold rounded-lg transition-all flex items-center gap-1.5">
                {testStatus === 'testing' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing...</> : <><Globe className="w-3.5 h-3.5" /> Test Connection</>}
              </button>
              {testStatus === 'ok' && <span className="text-[12px] text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />{testMsg}</span>}
              {testStatus === 'fail' && <span className="text-[12px] text-red-400 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{testMsg}</span>}
            </div>
          )}

          {/* Connection mode */}
          <div>
            <label className={labelCls}>Connection Mode</label>
            <div className="flex gap-2">
              <button className={radioCls(form.feishuConnectionMode === 'websocket')}
                onClick={() => setForm({ ...form, feishuConnectionMode: 'websocket' })}>WebSocket (default)</button>
              <button className={radioCls(form.feishuConnectionMode === 'webhook')}
                onClick={() => setForm({ ...form, feishuConnectionMode: 'webhook' })}>Webhook</button>
            </div>
          </div>

          {/* Webhook-specific fields */}
          {form.feishuConnectionMode === 'webhook' && (
            <div className="space-y-3 pl-3 border-l-2 border-accent/20">
              <div>
                <label className={labelCls}>Verification Token</label>
                <input type="password" value={form.feishuVerificationToken}
                  onChange={e => setForm({ ...form, feishuVerificationToken: e.target.value })}
                  placeholder="Enter verification token..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Webhook Path</label>
                <input type="text" value={form.feishuWebhookPath}
                  onChange={e => setForm({ ...form, feishuWebhookPath: e.target.value })}
                  placeholder="/feishu/events" className={inputCls} />
              </div>
            </div>
          )}

          {/* Domain */}
          <div>
            <label className={labelCls}>Domain</label>
            <div className="flex gap-2">
              <button className={radioCls(form.feishuDomain === 'feishu')}
                onClick={() => setForm({ ...form, feishuDomain: 'feishu' })}>Feishu (feishu.cn) — China</button>
              <button className={radioCls(form.feishuDomain === 'lark')}
                onClick={() => setForm({ ...form, feishuDomain: 'lark' })}>Lark (larksuite.com) — International</button>
            </div>
          </div>

          {/* Group policy */}
          <div>
            <label className={labelCls}>Group Chat Policy</label>
            <div className="flex gap-2 flex-wrap">
              {([
                ['open', 'Open — respond in all groups (requires mention)'],
                ['allowlist', 'Allowlist — only respond in specific groups'],
                ['disabled', 'Disabled — don\'t respond in groups'],
              ] as const).map(([val, label]) => (
                <button key={val} className={radioCls(form.feishuGroupPolicy === val)}
                  onClick={() => setForm({ ...form, feishuGroupPolicy: val })}>{label}</button>
              ))}
            </div>
          </div>

          {/* Group allowlist */}
          {form.feishuGroupPolicy === 'allowlist' && (
            <div className="pl-3 border-l-2 border-accent/20">
              <label className={labelCls}>Group Allowlist (chat IDs, comma separated)</label>
              <input type="text" value={form.feishuGroupAllowFrom}
                onChange={e => setForm({ ...form, feishuGroupAllowFrom: e.target.value })}
                placeholder="oc_xxxxx, oc_yyyyy" className={inputCls} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Step 9: Search ─── */
function SearchStep({ form, setForm, searchProviders }: { form: FormData; setForm: (f: FormData) => void; searchProviders: SearchProviderInfo[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Search className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">Search Provider</h3></div>
      <p className="text-[13px] text-text-muted">Web search lets your agent look things up online.</p>
      <div className="space-y-1 border border-border rounded-xl p-2">
        <button onClick={() => setForm({ ...form, searchProvider: '', searchApiKey: '' })}
          className={`w-full text-left px-3 py-2.5 rounded-lg text-[12px] transition-all ${!form.searchProvider ? 'bg-accent/15 text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
          Skip for now
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
          <label className="text-[12px] font-medium text-text-muted block mb-1">{searchProviders.find(s => s.id === form.searchProvider)?.name} API Key</label>
          <input type="password" value={form.searchApiKey} onChange={e => setForm({ ...form, searchApiKey: e.target.value })}
            placeholder={searchProviders.find(s => s.id === form.searchProvider)?.placeholder || 'API key...'}
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
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Wrench className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">Install Missing Skill Dependencies</h3></div>
      <div className="bg-surface-0 border border-border rounded-xl p-4 text-[12px] flex gap-4">
        <span>Eligible: <span className="text-emerald-400 font-semibold">{eligible.length}</span></span>
        <span>Missing deps: <span className="text-warning font-semibold">{missingDeps.length}</span></span>
        <span>Total: {skills.length}</span>
      </div>
      <p className="text-[13px] text-text-muted">Select skills to install dependencies for. Already-eligible skills are pre-checked.</p>
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
                  ? <span className="text-emerald-400">ready</span>
                  : <span className="text-text-muted">needs: {missingBins.join(', ') || 'dependencies'}</span>
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
  const toggle = (name: string) => setForm({ ...form, hooks: form.hooks.includes(name) ? form.hooks.filter(x => x !== name) : [...form.hooks, name] });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Plug className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">Enable Hooks</h3></div>
      <p className="text-[13px] text-text-muted">Hooks automate actions when agent events occur.</p>
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
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Rocket className="w-5 h-5 text-accent" /><h3 className="text-lg font-bold text-text-primary">Finalize</h3></div>
      <label className="flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all border-border hover:border-accent/30">
        <input type="checkbox" checked={form.installDaemon} onChange={e => setForm({ ...form, installDaemon: e.target.checked })} className="w-5 h-5 rounded accent-accent" />
        <div><p className="text-[13px] font-semibold text-text-primary">Install Gateway service (recommended)</p><p className="text-[11px] text-text-muted">Auto-start the gateway on boot via systemd/launchd.</p></div>
      </label>
    </div>
  );
}

/* ─── Step 13: Review ─── */
function ReviewStep({ form, authProviders, submitting }: { form: FormData; authProviders: AuthProviderInfo[]; submitting: boolean }) {
  const prov = authProviders.find(p => p.id === form.authProvider);
  const rows = form.mode === 'remote'
    ? [
        ['Mode', 'Remote gateway'],
        ['Gateway URL', form.remoteUrl || '(not set)'],
        ['Token', form.remoteToken ? '••••••••' : '(none)'],
      ]
    : [
        ['Mode', form.mode],
        ['Auth Provider', prov?.name || form.authProvider || '(not set)'],
        ['Default Model', form.modelId || '(not set)'],
        ['Gateway', `${form.gatewayBind}:${form.gatewayPort}`],
        ['Auth', form.gatewayAuthMode],
        ['Tailscale', form.tailscaleMode],
        ['Search', form.searchProvider || 'Skip'],
        ['Daemon', form.installDaemon ? 'Install' : 'Skip'],
        ['Workspace', form.workspace],
        ['Hooks', form.hooks.length > 0 ? form.hooks.join(', ') : 'None'],
        ['Channels', form.channels.length > 0 ? form.channels.join(', ') : 'None'],
        ...(form.channels.includes('feishu') ? [
          ['Feishu Domain', form.feishuDomain === 'lark' ? 'Lark (International)' : 'Feishu (China)'],
          ['Feishu Mode', form.feishuConnectionMode],
          ['Feishu Group', form.feishuGroupPolicy],
        ] as [string, string][] : []),
        ['Skills', form.selectedSkills.length > 0 ? form.selectedSkills.join(', ') : 'None'],
      ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-400" /><h3 className="text-lg font-bold text-text-primary">Review Configuration</h3></div>
      <div className="bg-surface-0 border border-border rounded-xl overflow-hidden">
        <table className="w-full text-[12px]"><tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-border/40 last:border-b-0">
              <td className="px-4 py-2 text-text-muted font-medium w-28">{k}</td>
              <td className="px-4 py-2 text-text-primary font-mono">{v}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
      {submitting && <div className="flex items-center gap-2 text-accent text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> Applying configuration...</div>}
    </div>
  );
}

/* ─── Main ─── */
export default function Configure() {
  const navigate = useNavigate();
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
    (async () => {
      try {
        const status = await systemAPI.status();
        if (!status.data.openclaw_installed) {
          navigate('/setup', { replace: true });
          return;
        }
      } catch { /* proceed anyway */ }

      try {
        const res = await systemAPI.onboardScan();
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
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [navigate]);

  const skipped = new Set<number>();
  skipped.add(9);
  if (form.wizardMode === 'quickstart') { [3, 4, 6, 7, 8].forEach(i => skipped.add(i)); }
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

  if (done) return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center gap-3 mb-8"><img src="/logo.png" alt="SafeClaw" className="w-16 h-16 rounded-xl shadow-lg shadow-accent/25" /></div>
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center"><CheckCircle className="w-9 h-9 text-emerald-400" /></div>
            <div className="text-center">
              <p className="text-lg font-bold text-text-primary">{form.mode === 'remote' ? 'Remote Gateway Configured!' : 'Configuration Complete!'}</p>
              <p className="text-[13px] text-text-secondary mt-2">{form.mode === 'remote' ? 'Remote gateway is configured and ready to use.' : 'SafeClaw is fully configured and ready to use.'}</p>
            </div>
            <button onClick={() => window.location.replace('/home')}
              className="flex items-center gap-2 px-8 py-3 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/25">
              <Settings2 className="w-4 h-4" /> Enter Dashboard <ChevronRight className="w-4 h-4" />
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
          <img src="/logo.png" alt="SafeClaw" className="w-12 h-12 rounded-xl shadow-lg shadow-accent/25" />
          <p className="text-[13px] text-text-muted">Configure OpenClaw</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <StepProgress current={step} skipped={skipped} />
          {step === 0 && <SecurityStep form={form} setForm={setForm} />}
          {step === 1 && <ModeStep form={form} setForm={setForm} />}
          {step === 2 && <ConfigStep form={form} setForm={setForm} configSummary={configSummary} />}
          {step === 3 && <SetupTypeStep form={form} setForm={setForm} />}
          {step === 4 && <WorkspaceStep form={form} setForm={setForm} />}
          {step === 5 && <AuthProviderStep form={form} setForm={setForm} authProviders={authProviders} modelProviders={modelProviders} showKey={showApiKey} setShowKey={setShowApiKey} />}
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
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            {step < 12 ? (
              <button onClick={goNext} disabled={!canNext()}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-40 text-white text-[13px] font-semibold rounded-xl transition-all shadow-lg shadow-accent/25">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[13px] font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/25">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {submitting ? 'Applying...' : 'Apply Configuration'}
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-text-muted mt-6">Powered by SafeClaw</p>
      </div>
    </div>
  );
}
