import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Cpu, Eye, EyeOff, Key, Loader2, Sparkles, XCircle } from 'lucide-react';
import { systemAPI } from '../../../../services/api';

const AGGREGATOR_PROVIDERS = new Set([
  'openrouter', 'kilocode', 'litellm', 'ai-gateway', 'cloudflare-ai-gateway',
  'opencode', 'synthetic', 'together', 'huggingface', 'venice', 'skip',
]);

const PROVIDER_KEY_URLS = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  gemini: 'https://aistudio.google.com/apikey',
  moonshot: 'https://platform.moonshot.cn/console/api-keys',
  minimax: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  'minimax-cn': 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  mistral: 'https://console.mistral.ai/api-keys',
  xai: 'https://console.x.ai/',
  deepseek: 'https://platform.deepseek.com/api_keys',
  openrouter: 'https://openrouter.ai/keys',
  together: 'https://api.together.xyz/settings/api-keys',
  huggingface: 'https://huggingface.co/settings/tokens',
  venice: 'https://venice.ai/settings/api',
  qianfan: 'https://console.bce.baidu.com/qianfan/ais/console/apiKey',
  alibaba: 'https://dashscope.console.aliyun.com/apiKey',
  modelstudio: 'https://bailian.console.aliyun.com/',
  zai: 'https://open.bigmodel.cn/usercenter/apikeys',
  xiaomi: 'https://developers.xiaomi.com/mimo',
  'kimi-coding': 'https://www.kimi.com/code/en',
  'kimi-coding-cn': 'https://platform.moonshot.cn/console/api-keys',
  arcee: 'https://app.arcee.ai/',
  kilocode: 'https://kilo.ai/',
  volcengine: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  litellm: 'https://litellm.ai',
};

const DEFAULT_FORM = {
  mode: 'local',
  authProvider: '',
  authMethod: '',
  apiKey: '',
  modelId: '',
  gatewayPort: 18789,
  gatewayBind: 'loopback',
  gatewayAuthMode: 'token',
  gatewayToken: '',
  workspace: '',
  installDaemon: true,
  tailscaleMode: 'off',
  searchProvider: '',
  searchApiKey: '',
  remoteUrl: '',
  remoteToken: '',
  hooks: [],
  cfAccountId: '',
  cfGatewayId: '',
  litellmBaseUrl: 'http://localhost:4000',
  vllmBaseUrl: 'http://127.0.0.1:8000/v1',
  vllmModelId: '',
  customBaseUrl: '',
  customModelId: '',
  customProviderId: '',
  customCompatibility: 'openai',
};

function safeErrorMessage(err, fallback) {
  return err?.response?.data?.detail || err?.message || fallback;
}

function deriveCustomProviderId(baseUrl, explicitProviderId = '') {
  const trimmed = String(explicitProviderId || '').trim();
  if (trimmed) return trimmed;
  try {
    const parsed = new URL(baseUrl);
    const host = String(parsed.hostname || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const port = parsed.port ? `-${parsed.port}` : '';
    return `custom-${host || 'custom'}${port}`;
  } catch {
    return 'custom';
  }
}

const API_KEY_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

function buildInitialForm(defaults = {}) {
  return {
    ...DEFAULT_FORM,
    mode: defaults.mode || 'local',
    authProvider: '',
    authMethod: '',
    modelId: '',
    gatewayPort: defaults.gateway_port ?? DEFAULT_FORM.gatewayPort,
    gatewayBind: defaults.gateway_bind || DEFAULT_FORM.gatewayBind,
    gatewayAuthMode: defaults.gateway_auth_mode || DEFAULT_FORM.gatewayAuthMode,
    gatewayToken: defaults.gateway_token || '',
    workspace: defaults.workspace || DEFAULT_FORM.workspace,
    installDaemon: defaults.install_daemon ?? DEFAULT_FORM.installDaemon,
    tailscaleMode: defaults.tailscale_mode || DEFAULT_FORM.tailscaleMode,
    searchProvider: defaults.search_provider || '',
    searchApiKey: defaults.search_api_key || '',
    remoteUrl: defaults.remote_url || '',
    remoteToken: defaults.remote_token || '',
    hooks: Array.isArray(defaults.enabled_hooks) ? defaults.enabled_hooks : [],
  };
}

function validateForm(form, authProviders) {
  if (!form.authProvider) return 'Choose a provider before applying this model.';
  if (form.authProvider === 'skip') return 'Pick a real provider to configure this model.';

  const provider = authProviders.find((item) => item.id === form.authProvider);
  if (!provider?.supported) return 'This provider still requires the full Configure flow.';

  const methods = provider.methods || [];
  if (methods.length > 1 && !form.authMethod) return 'Choose an auth method for this provider.';
  if (form.authProvider === 'cloudflare-ai-gateway' && (!form.cfAccountId.trim() || !form.cfGatewayId.trim())) {
    return 'Cloudflare AI Gateway needs both Account ID and Gateway ID.';
  }
  if (form.authProvider === 'vllm') {
    if (!form.vllmBaseUrl.trim() || !form.vllmModelId.trim()) {
      return 'vLLM requires both a base URL and a model ID.';
    }
    return '';
  }
  if (form.authProvider === 'custom') {
    if (!form.customBaseUrl.trim() || !form.customModelId.trim()) {
      return 'Custom providers require a base URL and a model ID.';
    }
    return '';
  }
  if (!form.modelId.trim()) return 'Choose a model before applying this configuration.';
  return '';
}

function SearchablePicker({
  label,
  value,
  displayValue,
  placeholder,
  searchPlaceholder,
  options,
  onSelect,
  renderOption,
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) setFilter('');
  }, [open]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => (
      `${option.label} ${option.id} ${option.hint || ''}`.toLowerCase().includes(needle)
    ));
  }, [filter, options]);

  return (
    <div className="tc-model-setup-field">
      <label className="tc-model-setup-label">{label}</label>
      <button
        type="button"
        className={`tc-model-setup-picker ${open ? 'tc-model-setup-picker-open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={value ? 'tc-model-setup-picker-value' : 'tc-model-setup-picker-placeholder'}>
          {value ? displayValue : placeholder}
        </span>
        <ChevronDown className={`tc-model-setup-picker-icon ${open ? 'tc-model-setup-picker-icon-open' : ''}`} />
      </button>
      {open ? (
        <div className="tc-model-setup-dropdown">
          <div className="tc-model-setup-dropdown-search">
            <input
              type="text"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
              className="tc-model-setup-input tc-model-setup-input-search"
            />
          </div>
          <div className="tc-model-setup-dropdown-list">
            {filtered.length === 0 ? (
              <div className="tc-model-setup-empty">No result matched this search.</div>
            ) : filtered.map((option) => {
              const selected = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={[
                    'tc-model-setup-option',
                    selected ? 'tc-model-setup-option-selected' : '',
                    option.disabled ? 'tc-model-setup-option-disabled' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (option.disabled) return;
                    onSelect(option.id);
                    setOpen(false);
                    setFilter('');
                  }}
                >
                  {renderOption ? renderOption(option, selected) : (
                    <>
                      <span>{option.label}</span>
                      {option.hint ? <span className="tc-model-setup-option-hint">{option.hint}</span> : null}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ModelSetupModal({
  open,
  authProviders = [],
  modelProviders = [],
  // Per-provider endpoint preset bundles from /system/onboard-scan (§33).
  // Shape: { [providerId]: { env_key, current, presets: [{id,label,hint,base_url}] } }
  // Today only ``alibaba`` populates a bundle so we can offer a
  // DashScope-vs-Coding-Plan picker; all other providers fall through
  // with no picker rendered. OpenClaw scan payloads omit this field
  // entirely and the default ``{}`` keeps the modal compatible.
  providerEndpoints = {},
  // §47 — per-provider XSafeClaw-pinned recommended Base URL.  Shape:
  // { [providerId]: "https://..." }.  Used as the placeholder for the
  // optional Base URL override input rendered for every provider that
  // doesn't have a preset bundle (i.e. everyone except alibaba today).
  // OpenClaw scan payloads omit this field entirely.
  providerRecommendedBaseUrls = {},
  // §53 — active runtime's platform ('openclaw' | 'hermes' | 'nanobot' | '').
  // Forwarded to ``systemAPI.providerHasKey`` so that on a Hermes-default
  // server ("settings.is_hermes=True") the modal still asks OpenClaw's
  // auth store when the user is configuring an OpenClaw runtime — and
  // vice-versa. Empty string falls through to the legacy
  // ``settings.is_hermes`` branch on the backend.
  runtimePlatform = '',
  defaults = null,
  loading = false,
  loadingError = '',
  onRetry,
  onClose,
  onConfigured,
}) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [manualModelEntry, setManualModelEntry] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [providerHasExistingKey, setProviderHasExistingKey] = useState(false);
  // Per-provider endpoint choice, keyed by auth-provider slug.  Initialised
  // lazily from ``providerEndpoints[slug].current`` (what's already in
  // ~/.hermes/.env) so re-saving an existing alibaba config doesn't
  // silently flip DASHSCOPE_BASE_URL back to the "recommended" preset.
  const [endpointChoice, setEndpointChoice] = useState({});
  // §47 — free-form Base URL override per provider. Distinct from
  // ``endpointChoice`` (which is dropdown-shaped, alibaba-only).
  // Cleared on modal open / provider switch so a stale value from a
  // previous session can't leak into a fresh quick-model-config request.
  const [baseUrlOverride, setBaseUrlOverride] = useState({});

  const availableAuthProviders = useMemo(
    () => authProviders.filter((provider) => provider.id !== 'skip'),
    [authProviders],
  );

  useEffect(() => {
    if (!open) return undefined;
    const nextForm = buildInitialForm(defaults || {});
    setForm(nextForm);
    setManualModelEntry(false);
    setShowKey(false);
    setSubmitting(false);
    setSubmitError('');
    // Seed endpoint choices from what Hermes's .env already has, falling
    // back to the first preset.  Running this on every open (instead of
    // once per prop change) keeps the picker consistent if the user
    // closed the modal, edited .env externally, and reopened it.
    const seeded = {};
    for (const [pid, bundle] of Object.entries(providerEndpoints || {})) {
      const current = String(bundle?.current || '').trim();
      if (current) {
        seeded[pid] = current;
      } else if (Array.isArray(bundle?.presets) && bundle.presets.length > 0) {
        seeded[pid] = bundle.presets[0].base_url;
      }
    }
    setEndpointChoice(seeded);
    setBaseUrlOverride({});
  }, [open, defaults, providerEndpoints]);

  useEffect(() => {
    if (!open || (defaults && defaults.workspace)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await systemAPI.status();
        if (cancelled || !data?.default_workspace) return;
        setForm((f) => ({ ...f, workspace: f.workspace || data.default_workspace }));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [open, defaults]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, submitting]);

  const selectedProvider = useMemo(
    () => availableAuthProviders.find((provider) => provider.id === form.authProvider),
    [availableAuthProviders, form.authProvider],
  );
  const providerMethods = selectedProvider?.methods || [];
  const hasMultipleMethods = providerMethods.length > 1;
  const effectiveMethod = form.authMethod || (providerMethods.length === 1 ? providerMethods[0]?.id : '');
  const selectedMethod = providerMethods.find((method) => method.id === effectiveMethod);
  const explicitProviderIds = selectedMethod?.modelProviders;
  // Narrow the model list to the provider slug the user just authed against.
  //
  // Old rule: for aggregator auth providers (openrouter, kilocode, …) we
  // showed models from *all* providers.  That was correct for openclaw,
  // where aggregators don't carry their own catalog and reuse other
  // extensions' ids — but on Hermes it produced the §30 trap: pick
  // OpenRouter, see a model labelled ``Claude Opus 4.6`` that's actually
  // ``nous/anthropic/claude-opus-4.6`` (Nous-routed), save it with an
  // OpenRouter key, get a 401 at chat time. The slug prefix was invisible
  // in the UI (only ``model.name`` was rendered), so users had no way to
  // tell two same-named routes apart.
  //
  // New rule: whenever the user picked *any* auth provider (aggregator or
  // not), filter modelProviders to that exact slug.  Only fall back to
  // "show everything" when (a) no auth provider is selected yet, or (b)
  // the auth slug has no matching modelProviders entry AND it's an
  // aggregator — that last clause preserves openclaw's
  // aggregator-borrows-from-everyone behaviour while letting Hermes's
  // per-aggregator catalogs (populated via fetch_openrouter_models etc.)
  // win whenever they exist.
  const inferredProviderIds = explicitProviderIds
    ?? (form.authProvider && form.authProvider !== 'skip' ? [form.authProvider] : undefined);
  let relevantProviders = inferredProviderIds
    ? modelProviders.filter((provider) => inferredProviderIds.includes(provider.id))
    : modelProviders;
  if (
    inferredProviderIds
    && relevantProviders.length === 0
    && AGGREGATOR_PROVIDERS.has(form.authProvider)
  ) {
    relevantProviders = modelProviders;
  }
  const visibleModels = relevantProviders.flatMap((provider) => provider.models || []);
  const allModels = modelProviders.flatMap((provider) => provider.models || []);
  const selectedModel = allModels.find((model) => model.id === form.modelId);
  const providerSupported = selectedProvider?.supported ?? false;
  const showApiKey = providerSupported && form.authProvider !== 'skip' && form.authProvider !== 'vllm' && form.authProvider !== 'custom';
  const showModelPicker = showApiKey && (!hasMultipleMethods || !!form.authMethod);
  const keyUrl = PROVIDER_KEY_URLS[form.authProvider] || '';

  if (!open) return null;

  const currentValidationError = defaults?.mode === 'remote' && !defaults?.remote_url
    ? 'This workspace is using remote mode without a stored gateway URL. Please reopen the full Configure page.'
    : validateForm(form, availableAuthProviders);

  const handleSubmit = async () => {
    if (submitting) return;
    const validationError = currentValidationError;
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      const effectiveProvider = form.authMethod
        || providerMethods[0]?.id
        || form.authProvider;

      let configuredModelId = form.modelId.trim();
      if (!configuredModelId && form.authProvider === 'vllm' && form.vllmModelId.trim()) {
        configuredModelId = `vllm/${form.vllmModelId.trim()}`;
      }
      if (!configuredModelId && form.authProvider === 'custom' && form.customModelId.trim()) {
        configuredModelId = `${deriveCustomProviderId(form.customBaseUrl, form.customProviderId)}/${form.customModelId.trim()}`;
      }

      const realApiKey = form.apiKey === API_KEY_MASK ? '' : form.apiKey;

      const isSimpleSetup = form.authProvider !== 'vllm'
        && form.authProvider !== 'custom'
        && form.authProvider !== 'cloudflare-ai-gateway';

      // §33 — forward the selected base-URL for providers that ship a
      // preset bundle (today just alibaba).  Uses ``form.authProvider``
      // rather than ``effectiveProvider`` because the endpoint bundle
      // is keyed by auth-provider slug (e.g. ``alibaba``), not by the
      // auth-method id (``alibaba-api-key``) the backend ultimately
      // receives.  Skipped when no bundle exists, so other providers'
      // requests stay payload-clean.
      // §47 — Base URL resolution mirror of Configure.tsx::saveModelToHermes.
      //   • If a preset bundle exists (alibaba), the dropdown selection wins.
      //   • Otherwise, the free-form override input wins; blank → undefined
      //     so the backend uses ``_HERMES_RECOMMENDED_BASE_URLS`` as the
      //     XSafeClaw-pinned default for this provider.
      const endpointBundle = providerEndpoints?.[form.authProvider];
      let endpointBaseUrl = '';
      if (endpointBundle) {
        endpointBaseUrl = endpointChoice[form.authProvider]
          || endpointBundle.current
          || endpointBundle.presets?.[0]?.base_url
          || '';
      } else {
        endpointBaseUrl = String(baseUrlOverride[form.authProvider] || '').trim();
      }

      let modelReady = false;
      if (isSimpleSetup) {
        const res = await systemAPI.quickModelConfig({
          provider: effectiveProvider,
          api_key: realApiKey,
          model_id: configuredModelId,
          base_url: endpointBaseUrl || undefined,
        });
        modelReady = Boolean(res.data?.model_ready);
      } else {
        await systemAPI.onboardConfig({
          mode: defaults?.mode || 'local',
          provider: effectiveProvider,
          api_key: realApiKey,
          model_id: configuredModelId,
          gateway_port: defaults?.gateway_port ?? form.gatewayPort,
          gateway_bind: defaults?.gateway_bind || form.gatewayBind,
          gateway_auth_mode: defaults?.gateway_auth_mode || form.gatewayAuthMode,
          gateway_token: defaults?.gateway_token || form.gatewayToken,
          workspace: defaults?.workspace || form.workspace,
          install_daemon: defaults?.install_daemon ?? form.installDaemon,
          tailscale_mode: defaults?.tailscale_mode || form.tailscaleMode,
          search_provider: defaults?.search_provider || form.searchProvider,
          search_api_key: defaults?.search_api_key || form.searchApiKey,
          remote_url: defaults?.remote_url || form.remoteUrl,
          remote_token: defaults?.remote_token || form.remoteToken,
          hooks: Array.isArray(defaults?.enabled_hooks) ? defaults.enabled_hooks : form.hooks,
          cf_account_id: form.cfAccountId,
          cf_gateway_id: form.cfGatewayId,
          litellm_base_url: form.litellmBaseUrl,
          vllm_base_url: form.vllmBaseUrl,
          vllm_model_id: form.vllmModelId,
          custom_base_url: form.customBaseUrl,
          custom_model_id: form.customModelId,
          custom_provider_id: form.customProviderId,
          custom_compatibility: form.customCompatibility,
        });
      }

      await onConfigured?.({
        modelId: configuredModelId,
        modelName: selectedModel?.name || configuredModelId,
        provider: configuredModelId.split('/')[0] || '',
        reasoning: Boolean(selectedModel?.reasoning),
        modelReady,
      });
    } catch (err) {
      setSubmitError(safeErrorMessage(err, 'Failed to configure this model.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="tc-task-modal-backdrop" onMouseDown={() => (!submitting ? onClose?.() : null)}>
      <section
        className="tc-ornate-panel tc-task-modal tc-model-setup-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tc-task-modal-head">
          <div>
            <div className="tc-task-lane-overline">MODEL SETUP</div>
            <div className="tc-task-lane-title">Configure New Model</div>
          </div>
          <button
            type="button"
            className="tc-task-detail-close"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!submitting) onClose?.();
            }}
          >
            CLOSE
          </button>
        </div>

        <div className="tc-model-setup-summary">
          <div className="tc-model-setup-summary-chip">
            <Sparkles className="tc-model-setup-summary-icon" />
            <div>
              <div className="tc-model-setup-summary-label">Setup path</div>
              <div className="tc-model-setup-summary-value">Provider {'->'} Auth {'->'} Model</div>
            </div>
          </div>
          <div className="tc-model-setup-summary-chip">
            <Cpu className="tc-model-setup-summary-icon" />
            <div>
              <div className="tc-model-setup-summary-label">Current mode</div>
              <div className="tc-model-setup-summary-value">{(defaults?.mode || 'local').toUpperCase()}</div>
            </div>
          </div>
        </div>

        <div className="tc-model-setup-body">
          {loading ? (
            <div className="tc-model-setup-state">
              <Loader2 className="tc-model-setup-spinner" />
              <span>Loading model catalog...</span>
              <span className="tc-model-setup-state-hint">First load after upgrade may take longer</span>
            </div>
          ) : loadingError ? (
            <div className="tc-inline-error tc-model-setup-error-panel">
              <div>{loadingError}</div>
              <button type="button" className="tc-summon-confirm tc-model-setup-retry" onClick={onRetry}>
                Retry
              </button>
            </div>
          ) : (
            <>
              <SearchablePicker
                label="Provider"
                value={form.authProvider}
                displayValue={selectedProvider ? `${selectedProvider.name}${selectedProvider.hint ? ` - ${selectedProvider.hint}` : ''}` : ''}
                placeholder="Choose a provider"
                searchPlaceholder="Search providers..."
                options={availableAuthProviders.map((provider) => ({
                  id: provider.id,
                  label: provider.name,
                  hint: provider.hint || '',
                  disabled: provider.supported === false,
                }))}
                onSelect={(id) => {
                  const provider = availableAuthProviders.find((item) => item.id === id);
                  if (!provider || provider.supported === false) return;
                  const methods = provider.methods || [];
                  const nextAuthMethod = methods.length === 1 ? methods[0].id : '';
                  setProviderHasExistingKey(false);
                  setForm((prev) => ({
                    ...prev,
                    authProvider: id,
                    authMethod: nextAuthMethod,
                    apiKey: '',
                    modelId: '',
                    cfAccountId: '',
                    cfGatewayId: '',
                    litellmBaseUrl: DEFAULT_FORM.litellmBaseUrl,
                    vllmBaseUrl: DEFAULT_FORM.vllmBaseUrl,
                    vllmModelId: '',
                    customBaseUrl: '',
                    customModelId: '',
                    customProviderId: '',
                    customCompatibility: DEFAULT_FORM.customCompatibility,
                  }));
                  setManualModelEntry(false);
                  // §53 — pin to the active runtime's platform when known.
                  // ``runtimePlatform`` may be 'nanobot' or '' for which
                  // the backend has no dedicated auth-store branch yet —
                  // fall through to ``undefined`` (legacy) in that case.
                  const platformParam = runtimePlatform === 'openclaw' || runtimePlatform === 'hermes'
                    ? runtimePlatform
                    : undefined;
                  systemAPI.providerHasKey(id, platformParam).then((res) => {
                    const hasKey = Boolean(res.data?.has_key);
                    setProviderHasExistingKey(hasKey);
                    if (hasKey) {
                      setForm((prev) => prev.authProvider === id && !prev.apiKey ? { ...prev, apiKey: API_KEY_MASK } : prev);
                    }
                  }).catch(() => {});
                }}
                renderOption={(option, selected) => (
                  <div className="tc-model-setup-option-copy">
                    <span className="tc-model-setup-option-title">
                      {option.label}
                      {selected ? <CheckCircle2 className="tc-model-setup-check" /> : null}
                    </span>
                    <span className="tc-model-setup-option-hint">
                      {option.disabled ? 'Configure page only' : option.hint}
                    </span>
                  </div>
                )}
              />

              {providerSupported && hasMultipleMethods ? (
                <div className="tc-model-setup-field">
                  <label className="tc-model-setup-label">Auth Method</label>
                  <div className="tc-model-setup-chip-grid">
                    {providerMethods.map((method) => (
                      <button
                        key={method.id}
                        type="button"
                        className={`tc-model-setup-chip ${form.authMethod === method.id ? 'tc-model-setup-chip-selected' : ''}`}
                        onClick={() => {
                          setForm((prev) => ({
                            ...prev,
                            authMethod: method.id,
                            apiKey: prev.apiKey === API_KEY_MASK ? API_KEY_MASK : '',
                            modelId: '',
                          }));
                          setManualModelEntry(false);
                        }}
                      >
                        <span className="tc-model-setup-chip-title">{method.label}</span>
                        {method.hint ? <span className="tc-model-setup-chip-hint">{method.hint}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {showApiKey ? (
                <div className="tc-model-setup-field">
                  <label className="tc-model-setup-label">
                    API Key
                    {keyUrl ? (
                      <a className="tc-model-setup-link" href={keyUrl} target="_blank" rel="noopener noreferrer">
                        Get key
                      </a>
                    ) : null}
                  </label>
                  <div className="tc-model-setup-secret">
                    <input
                      type={form.apiKey === API_KEY_MASK ? 'password' : showKey ? 'text' : 'password'}
                      value={form.apiKey}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (form.apiKey === API_KEY_MASK && next !== API_KEY_MASK) {
                          setForm((prev) => ({ ...prev, apiKey: next.replace(API_KEY_MASK, '') }));
                        } else {
                          setForm((prev) => ({ ...prev, apiKey: next }));
                        }
                      }}
                      placeholder="Paste your API key"
                      className="tc-model-setup-input"
                    />
                    {form.apiKey !== API_KEY_MASK ? (
                      <button type="button" className="tc-model-setup-secret-toggle" onClick={() => setShowKey((prev) => !prev)}>
                        {showKey ? <EyeOff className="tc-model-setup-secret-icon" /> : <Eye className="tc-model-setup-secret-icon" />}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* §33 — per-provider endpoint preset picker.  Today only
                  alibaba ships a bundle; the block stays dormant for every
                  other provider.  Placed directly under the API-key input
                  so the "this URL receives this key" relationship is
                  visible at a glance — that's the entire failure mode the
                  picker is here to prevent. */}
              {/* §47 — optional free-form Base URL override for providers
                  without a preset bundle.  Renders for every selectable
                  Hermes provider except ``alibaba`` (covered by the
                  dropdown below), ``custom`` (Custom Endpoint flow has
                  its own URL field) and ``copilot`` (OAuth — no URL).
                  Blank input → backend falls through to
                  ``_HERMES_RECOMMENDED_BASE_URLS[provider]``.  Without
                  this field the user has no in-app way to redirect
                  api.openai.com / api.anthropic.com /
                  generativelanguage.googleapis.com to a reachable proxy. */}
              {showApiKey
                && !providerEndpoints?.[form.authProvider]
                && form.authProvider !== 'custom'
                && form.authProvider !== 'copilot' ? (() => {
                const recommended = providerRecommendedBaseUrls?.[form.authProvider] || '';
                const current = String(baseUrlOverride[form.authProvider] || '');
                return (
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">Base URL (optional — overrides default endpoint)</label>
                    <input
                      type="text"
                      value={current}
                      onChange={(event) => setBaseUrlOverride((prev) => ({
                        ...prev,
                        [form.authProvider]: event.target.value,
                      }))}
                      placeholder={recommended || 'Hermes will pick its adapter default if left blank'}
                      className="tc-model-setup-input"
                    />
                    <p className="tc-model-setup-hint">
                      Leave blank to use the recommended URL shown above. If you're in mainland China without a VPN, paste a reachable proxy endpoint here (e.g. a reverse proxy that forwards api.openai.com / api.anthropic.com / generativelanguage.googleapis.com).
                    </p>
                  </div>
                );
              })() : null}

              {showApiKey && providerEndpoints?.[form.authProvider] ? (() => {
                const bundle = providerEndpoints[form.authProvider];
                const currentSel = endpointChoice[form.authProvider]
                  || bundle.presets?.[0]?.base_url
                  || '';
                const activePreset = (bundle.presets || []).find((p) => p.base_url === currentSel);
                return (
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">API Endpoint</label>
                    <select
                      value={currentSel}
                      onChange={(event) => setEndpointChoice((prev) => ({
                        ...prev,
                        [form.authProvider]: event.target.value,
                      }))}
                      className="tc-model-setup-input"
                    >
                      {(bundle.presets || []).map((preset) => (
                        <option key={preset.id} value={preset.base_url}>{preset.label}</option>
                      ))}
                    </select>
                    {activePreset?.hint ? (
                      <p className="tc-model-setup-hint">{activePreset.hint}</p>
                    ) : null}
                    <p className="tc-model-setup-hint tc-model-setup-hint-mono">
                      {bundle.env_key}={currentSel}
                    </p>
                  </div>
                );
              })() : null}

              {showApiKey && form.authProvider === 'cloudflare-ai-gateway' ? (
                <div className="tc-model-setup-grid">
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">Account ID</label>
                    <input
                      type="text"
                      value={form.cfAccountId}
                      onChange={(event) => setForm((prev) => ({ ...prev, cfAccountId: event.target.value }))}
                      placeholder="Cloudflare account id"
                      className="tc-model-setup-input"
                    />
                  </div>
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">Gateway ID</label>
                    <input
                      type="text"
                      value={form.cfGatewayId}
                      onChange={(event) => setForm((prev) => ({ ...prev, cfGatewayId: event.target.value }))}
                      placeholder="Gateway id"
                      className="tc-model-setup-input"
                    />
                  </div>
                </div>
              ) : null}

              {showApiKey && form.authProvider === 'litellm' ? (
                <div className="tc-model-setup-field">
                  <label className="tc-model-setup-label">LiteLLM Base URL</label>
                  <input
                    type="text"
                    value={form.litellmBaseUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, litellmBaseUrl: event.target.value }))}
                    placeholder="http://localhost:4000"
                    className="tc-model-setup-input"
                  />
                </div>
              ) : null}

              {form.authProvider === 'vllm' ? (
                <div className="tc-model-setup-grid">
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">vLLM Base URL</label>
                    <input
                      type="text"
                      value={form.vllmBaseUrl}
                      onChange={(event) => setForm((prev) => ({ ...prev, vllmBaseUrl: event.target.value }))}
                      placeholder="http://127.0.0.1:8000/v1"
                      className="tc-model-setup-input"
                    />
                  </div>
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">API Key</label>
                    <div className="tc-model-setup-secret">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={form.apiKey}
                        onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                        placeholder="Optional vLLM key"
                        className="tc-model-setup-input"
                      />
                      <button type="button" className="tc-model-setup-secret-toggle" onClick={() => setShowKey((prev) => !prev)}>
                        {showKey ? <EyeOff className="tc-model-setup-secret-icon" /> : <Eye className="tc-model-setup-secret-icon" />}
                      </button>
                    </div>
                  </div>
                  <div className="tc-model-setup-field tc-model-setup-field-wide">
                    <label className="tc-model-setup-label">Model ID</label>
                    <input
                      type="text"
                      value={form.vllmModelId}
                      onChange={(event) => setForm((prev) => ({ ...prev, vllmModelId: event.target.value }))}
                      placeholder="Model served by your vLLM endpoint"
                      className="tc-model-setup-input"
                    />
                  </div>
                </div>
              ) : null}

              {form.authProvider === 'custom' ? (
                <div className="tc-model-setup-grid">
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">Base URL</label>
                    <input
                      type="text"
                      value={form.customBaseUrl}
                      onChange={(event) => setForm((prev) => ({ ...prev, customBaseUrl: event.target.value }))}
                      placeholder="https://your-provider.example/v1"
                      className="tc-model-setup-input"
                    />
                  </div>
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">API Key (optional)</label>
                    <div className="tc-model-setup-secret">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={form.apiKey}
                        onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                        placeholder="Optional API key"
                        className="tc-model-setup-input"
                      />
                      <button type="button" className="tc-model-setup-secret-toggle" onClick={() => setShowKey((prev) => !prev)}>
                        {showKey ? <EyeOff className="tc-model-setup-secret-icon" /> : <Eye className="tc-model-setup-secret-icon" />}
                      </button>
                    </div>
                  </div>
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">Model ID</label>
                    <input
                      type="text"
                      value={form.customModelId}
                      onChange={(event) => setForm((prev) => ({ ...prev, customModelId: event.target.value }))}
                      placeholder="Provider model id"
                      className="tc-model-setup-input"
                    />
                  </div>
                  <div className="tc-model-setup-field">
                    <label className="tc-model-setup-label">Provider ID (optional)</label>
                    <input
                      type="text"
                      value={form.customProviderId}
                      onChange={(event) => setForm((prev) => ({ ...prev, customProviderId: event.target.value }))}
                      placeholder="custom-my-provider"
                      className="tc-model-setup-input"
                    />
                  </div>
                  <div className="tc-model-setup-field tc-model-setup-field-wide">
                    <label className="tc-model-setup-label">Compatibility</label>
                    <div className="tc-model-setup-chip-grid">
                      {['openai', 'anthropic'].map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`tc-model-setup-chip ${form.customCompatibility === mode ? 'tc-model-setup-chip-selected' : ''}`}
                          onClick={() => setForm((prev) => ({ ...prev, customCompatibility: mode }))}
                        >
                          <span>{mode === 'openai' ? 'OpenAI-compatible' : 'Anthropic-compatible'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {showModelPicker && !manualModelEntry && visibleModels.length > 0 ? (
                <SearchablePicker
                  label="Model"
                  value={form.modelId}
                  // Belt-and-braces companion to the provider-scope filter
                  // above: even if the filter somehow lets a cross-routed
                  // entry slip through (backend drift, stale cache, openclaw
                  // aggregator fallback), the slug prefix here makes the
                  // routing visible, so users can't silently pick
                  // ``nous/anthropic/claude-opus-4.6`` while they thought they
                  // were picking the OpenRouter-routed one.
                  displayValue={selectedModel
                    ? `${(String(selectedModel.id || '').split('/')[0] || '')} · ${selectedModel.name}${selectedModel.contextWindow ? ` (${Math.round(selectedModel.contextWindow / 1024)}K)` : ''}`
                    : form.modelId}
                  placeholder="Choose a model"
                  searchPlaceholder="Search models..."
                  options={visibleModels.map((model) => {
                    const slug = String(model.id || '').split('/')[0] || '';
                    return {
                      id: model.id,
                      label: slug ? `${slug} · ${model.name}` : model.name,
                      hint: `${model.contextWindow ? `${Math.round(model.contextWindow / 1024)}K` : ''}${model.reasoning ? ' REASON' : ''}`.trim(),
                    };
                  })}
                  onSelect={(id) => setForm((prev) => ({ ...prev, modelId: id }))}
                  renderOption={(option, selected) => (
                    <div className="tc-model-setup-option-row">
                      <span className="tc-model-setup-option-title">
                        {option.label}
                        {selected ? <CheckCircle2 className="tc-model-setup-check" /> : null}
                      </span>
                      {option.hint ? <span className="tc-model-setup-inline-meta">{option.hint}</span> : null}
                    </div>
                  )}
                />
              ) : null}

              {showModelPicker ? (
                <div className="tc-model-setup-field">
                  <label className="tc-model-setup-label">
                    {manualModelEntry || visibleModels.length === 0 ? 'Model ID' : 'Manual model entry'}
                  </label>
                  {manualModelEntry || visibleModels.length === 0 ? (
                    <>
                      <input
                        type="text"
                        value={form.modelId}
                        onChange={(event) => setForm((prev) => ({ ...prev, modelId: event.target.value }))}
                        placeholder="provider/model"
                        className="tc-model-setup-input"
                      />
                      {visibleModels.length > 0 ? (
                        <button type="button" className="tc-model-setup-text-btn" onClick={() => setManualModelEntry(false)}>
                          Back to discovered models
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <button type="button" className="tc-model-setup-text-btn" onClick={() => setManualModelEntry(true)}>
                      Enter model id manually
                    </button>
                  )}
                </div>
              ) : null}

              {form.authProvider && !providerSupported ? (
                <div className="tc-inline-error tc-model-setup-error-panel">
                  This provider still needs the full OpenClaw Configure flow. Open `/openclaw_configure` if you want to set it up.
                </div>
              ) : null}
            </>
          )}
        </div>

        {submitError ? (
          <div className="tc-inline-error tc-model-setup-submit-error">
            <XCircle className="tc-model-setup-submit-error-icon" />
            <span>{submitError}</span>
          </div>
        ) : null}

        <div className="tc-model-setup-actions">
          <button type="button" className="tc-task-detail-close" disabled={submitting} onClick={onClose}>
            CANCEL
          </button>
          <button
            type="button"
            className="tc-summon-confirm tc-model-setup-apply"
            onClick={handleSubmit}
            disabled={loading || submitting || !!currentValidationError}
          >
            {submitting ? <Loader2 className="tc-model-setup-apply-spinner" /> : <Key className="tc-model-setup-apply-icon" />}
            <span>{submitting ? 'Applying...' : 'Add New Model'}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
