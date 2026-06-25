import { useEffect, useMemo, useRef, useState } from 'react';
import { systemAPI } from './services/api';
import { ConfigField, ConfigSelect, ConfigTextInput } from './StoreConfigFields';
import {
  defaultOpenClawStoreConfigForm,
  type OpenClawAuthProvider,
  type OpenClawChannel,
  type OpenClawConfigAction,
  type OpenClawCustomCompatibility,
  type OpenClawFeishuConnectionMode,
  type OpenClawFeishuDomain,
  type OpenClawFeishuGroupPolicy,
  type OpenClawGatewayAuthMode,
  type OpenClawGatewayBind,
  type OpenClawHook,
  type OpenClawMode,
  type OpenClawModelProvider,
  type OpenClawResetScope,
  type OpenClawSearchProvider,
  type OpenClawSkill,
  type OpenClawStoreConfigForm,
  type OpenClawTailscaleMode,
  storeConfigText,
} from './storeConfigTypes';

type OpenClawScanState = {
  authProviders: OpenClawAuthProvider[];
  modelProviders: OpenClawModelProvider[];
  channels: OpenClawChannel[];
  skills: OpenClawSkill[];
  hooks: OpenClawHook[];
  searchProviders: OpenClawSearchProvider[];
};

type OpenClawStoreConfigOptions = {
  enabled: boolean;
  configured: boolean;
  onSaved: () => void;
};

const emptyOpenClawScanState: OpenClawScanState = {
  authProviders: [],
  modelProviders: [],
  channels: [],
  skills: [],
  hooks: [],
  searchProviders: [],
};

const openClawModes = ['local', 'remote'] as const;
const configActions = ['keep', 'update', 'reset'] as const;
const resetScopes = ['', 'config', 'config+creds+sessions', 'full'] as const;
const gatewayBinds = ['loopback', 'lan', 'auto', 'custom', 'tailnet'] as const;
const gatewayAuthModes = ['token', 'password'] as const;
const tailscaleModes = ['off', 'serve', 'funnel'] as const;
const feishuConnectionModes = ['websocket', 'webhook'] as const;
const feishuDomains = ['feishu', 'lark'] as const;
const feishuGroupPolicies = ['open', 'allowlist', 'disabled'] as const;
const customCompatibilities = ['openai', 'anthropic'] as const;

function hasOwn(source: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function readStringDefault(source: Record<string, unknown>, key: string, fallback: string) {
  return hasOwn(source, key) && typeof source[key] === 'string' ? source[key] : fallback;
}

function readStringArrayDefault(source: Record<string, unknown>, key: string, fallback: string[]) {
  return Array.isArray(source[key]) ? source[key].map((item) => String(item)) : fallback;
}

function readBooleanDefault(source: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof source[key] === 'boolean' ? source[key] : fallback;
}

function readNumberDefault(source: Record<string, unknown>, key: string, fallback: number) {
  if (!hasOwn(source, key)) return fallback;
  const nextValue = Number(source[key]);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function readUnionDefault<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
) {
  const value = source[key];
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function readCommaListDefault(source: Record<string, unknown>, key: string, fallback: string) {
  if (Array.isArray(source[key])) {
    return source[key].map((item) => String(item).trim()).filter(Boolean).join(', ');
  }
  return readStringDefault(source, key, fallback);
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === 'string') return response.data.detail;
  }
  return error instanceof Error ? error.message : String(error);
}

function dedupeProviderOptions(
  authProviders: OpenClawAuthProvider[],
  modelProviders: OpenClawModelProvider[],
) {
  const seen = new Set<string>();
  const options: Array<{ id: string; name: string }> = [];

  for (const provider of authProviders) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    options.push({ id: provider.id, name: provider.name || provider.id });
  }

  for (const provider of modelProviders) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    options.push({ id: provider.id, name: provider.name || provider.id });
  }

  return options;
}

function applyOpenClawDefaults(
  previous: OpenClawStoreConfigForm,
  data: Record<string, unknown>,
): OpenClawStoreConfigForm {
  const defaults = (data.defaults && typeof data.defaults === 'object' ? data.defaults : {}) as Record<string, unknown>;
  const authProvider = hasOwn(defaults, 'auth_provider')
    ? readStringDefault(defaults, 'auth_provider', previous.authProvider)
    : readStringDefault(defaults, 'provider', previous.authProvider);
  const hooks = Array.isArray(defaults.enabled_hooks)
    ? readStringArrayDefault(defaults, 'enabled_hooks', previous.hooks)
    : readStringArrayDefault(defaults, 'hooks', previous.hooks);

  return {
    ...previous,
    mode: readUnionDefault<OpenClawMode>(defaults, 'mode', openClawModes, previous.mode),
    configAction: readUnionDefault<OpenClawConfigAction>(defaults, 'config_action', configActions, previous.configAction),
    resetScope: readUnionDefault<OpenClawResetScope>(defaults, 'reset_scope', resetScopes, previous.resetScope),
    authProvider,
    authMethod: readStringDefault(defaults, 'auth_method', previous.authMethod),
    apiKey: readStringDefault(defaults, 'api_key', previous.apiKey),
    modelId: readStringDefault(
      defaults,
      'model_id',
      readStringDefault(defaults, 'default_model', typeof data.default_model === 'string' ? data.default_model : previous.modelId),
    ),
    gatewayPort: readNumberDefault(defaults, 'gateway_port', previous.gatewayPort),
    gatewayBind: readUnionDefault<OpenClawGatewayBind>(defaults, 'gateway_bind', gatewayBinds, previous.gatewayBind),
    gatewayAuthMode: readUnionDefault<OpenClawGatewayAuthMode>(defaults, 'gateway_auth_mode', gatewayAuthModes, previous.gatewayAuthMode),
    gatewayToken: readStringDefault(defaults, 'gateway_token', previous.gatewayToken),
    workspace: readStringDefault(defaults, 'workspace', previous.workspace),
    channels: readStringArrayDefault(defaults, 'channels', previous.channels),
    hooks,
    searchProvider: readStringDefault(defaults, 'search_provider', previous.searchProvider),
    searchApiKey: readStringDefault(defaults, 'search_api_key', previous.searchApiKey),
    selectedSkills: readStringArrayDefault(defaults, 'selected_skills', previous.selectedSkills),
    installDaemon: readBooleanDefault(defaults, 'install_daemon', previous.installDaemon),
    tailscaleMode: readUnionDefault<OpenClawTailscaleMode>(defaults, 'tailscale_mode', tailscaleModes, previous.tailscaleMode),
    remoteUrl: readStringDefault(defaults, 'remote_url', previous.remoteUrl),
    remoteToken: readStringDefault(defaults, 'remote_token', previous.remoteToken),
    feishuAppId: readStringDefault(defaults, 'feishu_app_id', previous.feishuAppId),
    feishuAppSecret: readStringDefault(defaults, 'feishu_app_secret', previous.feishuAppSecret),
    feishuConnectionMode: readUnionDefault<OpenClawFeishuConnectionMode>(defaults, 'feishu_connection_mode', feishuConnectionModes, previous.feishuConnectionMode),
    feishuDomain: readUnionDefault<OpenClawFeishuDomain>(defaults, 'feishu_domain', feishuDomains, previous.feishuDomain),
    feishuGroupPolicy: readUnionDefault<OpenClawFeishuGroupPolicy>(defaults, 'feishu_group_policy', feishuGroupPolicies, previous.feishuGroupPolicy),
    feishuGroupAllowFrom: readCommaListDefault(defaults, 'feishu_group_allow_from', previous.feishuGroupAllowFrom),
    feishuVerificationToken: readStringDefault(defaults, 'feishu_verification_token', previous.feishuVerificationToken),
    feishuWebhookPath: readStringDefault(defaults, 'feishu_webhook_path', previous.feishuWebhookPath),
    cfAccountId: readStringDefault(defaults, 'cf_account_id', previous.cfAccountId),
    cfGatewayId: readStringDefault(defaults, 'cf_gateway_id', previous.cfGatewayId),
    litellmBaseUrl: readStringDefault(defaults, 'litellm_base_url', previous.litellmBaseUrl),
    vllmBaseUrl: readStringDefault(defaults, 'vllm_base_url', previous.vllmBaseUrl),
    vllmModelId: readStringDefault(defaults, 'vllm_model_id', previous.vllmModelId),
    customBaseUrl: readStringDefault(defaults, 'custom_base_url', previous.customBaseUrl),
    customModelId: readStringDefault(defaults, 'custom_model_id', previous.customModelId),
    customProviderId: readStringDefault(defaults, 'custom_provider_id', previous.customProviderId),
    customCompatibility: readUnionDefault<OpenClawCustomCompatibility>(defaults, 'custom_compatibility', customCompatibilities, previous.customCompatibility),
    customContextWindow: readNumberDefault(defaults, 'custom_context_window', previous.customContextWindow),
  };
}

export function useOpenClawStoreConfig({ enabled, configured, onSaved }: OpenClawStoreConfigOptions) {
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [openClawScan, setOpenClawScan] = useState<OpenClawScanState>(emptyOpenClawScanState);
  const [openClawConfigExists, setOpenClawConfigExists] = useState(configured);
  const [openClawConfigSummary, setOpenClawConfigSummary] = useState<string[]>([]);
  const [openClawForm, setOpenClawForm] = useState<OpenClawStoreConfigForm>(defaultOpenClawStoreConfigForm);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setOpenClawConfigExists(configured);
    setLoadingConfig(true);
    setLoadError('');
    systemAPI.onboardScan('openclaw')
      .then((response) => {
        if (cancelled) return;
        const data = response.data as Record<string, unknown>;

        setOpenClawScan({
          authProviders: Array.isArray(data.auth_providers) ? data.auth_providers as OpenClawAuthProvider[] : [],
          modelProviders: Array.isArray(data.model_providers) ? data.model_providers as OpenClawModelProvider[] : [],
          channels: Array.isArray(data.channels) ? data.channels as OpenClawChannel[] : [],
          skills: Array.isArray(data.skills) ? data.skills as OpenClawSkill[] : [],
          hooks: Array.isArray(data.hooks) ? data.hooks as OpenClawHook[] : [],
          searchProviders: Array.isArray(data.search_providers) ? data.search_providers as OpenClawSearchProvider[] : [],
        });
        setOpenClawConfigExists(Boolean(data.config_exists));
        setOpenClawConfigSummary(Array.isArray(data.config_summary) ? data.config_summary.map((line) => String(line)) : []);
        setOpenClawForm((previous) => applyOpenClawDefaults(previous, data));
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(`${storeConfigText.loadFailed}: ${errorMessage(error)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });

    return () => {
      cancelled = true;
    };
  }, [configured, enabled]);

  const selectedAuthProvider = useMemo(
    () => openClawScan.authProviders.find((provider) => provider.id === openClawForm.authProvider),
    [openClawForm.authProvider, openClawScan.authProviders],
  );
  const modelOptions = useMemo(() => {
    const selectedModelProvider = openClawScan.modelProviders.find((provider) => provider.id === openClawForm.authProvider);
    const source = selectedModelProvider?.models?.length
      ? selectedModelProvider.models
      : openClawScan.modelProviders.flatMap((provider) => provider.models || []);
    return source;
  }, [openClawForm.authProvider, openClawScan.modelProviders]);
  const providerOptions = useMemo(
    () => dedupeProviderOptions(openClawScan.authProviders, openClawScan.modelProviders),
    [openClawScan.authProviders, openClawScan.modelProviders],
  );
  const showFeishuFields = openClawForm.channels.some((channel) => channel === 'feishu' || channel === 'lark');

  const clearMessages = () => {
    setSavedMessage('');
    setSaveError('');
  };

  const handleSaved = () => {
    setSavedMessage(storeConfigText.saved);
    onSaved();
  };

  const updateOpenClawForm = (patch: Partial<OpenClawStoreConfigForm>) => {
    setOpenClawForm((previous) => ({ ...previous, ...patch }));
    clearMessages();
  };

  const toggleOpenClawList = (
    field: 'channels' | 'hooks' | 'selectedSkills',
    value: string,
    checked: boolean,
  ) => {
    setOpenClawForm((previous) => {
      const current = previous[field];
      return {
        ...previous,
        [field]: checked ? [...current, value] : current.filter((item) => item !== value),
      };
    });
    clearMessages();
  };

  const save = async () => {
    if (saveInFlightRef.current) return;

    setSavedMessage('');
    setSaveError('');
    if (openClawForm.configAction === 'reset' && !openClawForm.resetScope) {
      setSaveError(`${storeConfigText.saveFailed}: \u8bf7\u9009\u62e9\u91cd\u7f6e\u8303\u56f4`);
      return;
    }
    if (openClawForm.configAction === 'keep') {
      handleSaved();
      return;
    }

    saveInFlightRef.current = true;
    setSavingConfig(true);
    try {
      if (openClawForm.configAction === 'reset') {
        await systemAPI.configReset(openClawForm.resetScope, openClawForm.workspace);
      }

      const methods = selectedAuthProvider?.methods || [];
      const effectiveProvider = openClawForm.authMethod
        || (methods.length === 1 ? methods[0].id : '')
        || openClawForm.authProvider;

      await systemAPI.onboardConfig({
        platform: 'openclaw',
        mode: openClawForm.mode,
        provider: effectiveProvider,
        api_key: openClawForm.apiKey,
        model_id: openClawForm.modelId,
        gateway_port: openClawForm.gatewayPort,
        gateway_bind: openClawForm.gatewayBind,
        gateway_auth_mode: openClawForm.gatewayAuthMode,
        gateway_token: openClawForm.gatewayToken,
        channels: openClawForm.channels,
        hooks: openClawForm.hooks,
        workspace: openClawForm.workspace,
        install_daemon: openClawForm.installDaemon,
        tailscale_mode: openClawForm.tailscaleMode,
        search_provider: openClawForm.searchProvider,
        search_api_key: openClawForm.searchApiKey,
        remote_url: openClawForm.remoteUrl,
        remote_token: openClawForm.remoteToken,
        selected_skills: openClawForm.selectedSkills,
        feishu_app_id: openClawForm.feishuAppId,
        feishu_app_secret: openClawForm.feishuAppSecret,
        feishu_connection_mode: openClawForm.feishuConnectionMode,
        feishu_domain: openClawForm.feishuDomain,
        feishu_group_policy: openClawForm.feishuGroupPolicy,
        feishu_group_allow_from: openClawForm.feishuGroupAllowFrom.split(',').map((item) => item.trim()).filter(Boolean),
        feishu_verification_token: openClawForm.feishuVerificationToken,
        feishu_webhook_path: openClawForm.feishuWebhookPath,
        cf_account_id: openClawForm.cfAccountId,
        cf_gateway_id: openClawForm.cfGatewayId,
        litellm_base_url: openClawForm.litellmBaseUrl,
        vllm_base_url: openClawForm.vllmBaseUrl,
        vllm_model_id: openClawForm.vllmModelId,
        custom_base_url: openClawForm.customBaseUrl,
        custom_model_id: openClawForm.customModelId,
        custom_provider_id: openClawForm.customProviderId,
        custom_compatibility: openClawForm.customCompatibility,
        custom_context_window: openClawForm.customContextWindow,
      });
      handleSaved();
    } catch (error) {
      setSaveError(`${storeConfigText.saveFailed}: ${errorMessage(error)}`);
    } finally {
      saveInFlightRef.current = false;
      setSavingConfig(false);
    }
  };

  const renderOpenClawChoice = (
    name: string,
    label: string,
    checked: boolean,
    onChange: () => void,
    hint?: string,
  ) => (
    <label className="store-config-choice">
      <input type="radio" name={name} aria-label={label} checked={checked} onChange={onChange} />
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </label>
  );

  const renderOpenClawModelFields = () => (
    <>
      <ConfigField label={'\u63d0\u4f9b\u5546'} htmlFor="openclaw-provider">
        <ConfigSelect
          id="openclaw-provider"
          value={openClawForm.authProvider}
          onChange={(event) => updateOpenClawForm({ authProvider: event.target.value, authMethod: '' })}
        >
          <option value="">{'\u9009\u62e9\u63d0\u4f9b\u5546'}</option>
          {providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>
          ))}
        </ConfigSelect>
      </ConfigField>
      {(selectedAuthProvider?.methods?.length || 0) > 1 ? (
        <ConfigField label={'\u8ba4\u8bc1\u65b9\u5f0f'} htmlFor="openclaw-auth-method">
          <ConfigSelect
            id="openclaw-auth-method"
            value={openClawForm.authMethod}
            onChange={(event) => updateOpenClawForm({ authMethod: event.target.value })}
          >
            <option value="">{'\u9009\u62e9\u8ba4\u8bc1\u65b9\u5f0f'}</option>
            {selectedAuthProvider?.methods?.map((method) => (
              <option key={method.id} value={method.id}>{method.label || method.id}</option>
            ))}
          </ConfigSelect>
        </ConfigField>
      ) : null}
      <ConfigField label="API Key" htmlFor="openclaw-api-key">
        <ConfigTextInput
          id="openclaw-api-key"
          type="password"
          value={openClawForm.apiKey}
          onChange={(event) => updateOpenClawForm({ apiKey: event.target.value })}
          placeholder="sk-..."
        />
      </ConfigField>
      <ConfigField label={'\u6a21\u578b'} htmlFor="openclaw-model">
        <ConfigTextInput
          id="openclaw-model"
          list="openclaw-model-options"
          value={openClawForm.modelId}
          onChange={(event) => updateOpenClawForm({ modelId: event.target.value })}
          placeholder="openai/gpt-5.1"
        />
        <datalist id="openclaw-model-options">
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>{model.name || model.id}</option>
          ))}
        </datalist>
      </ConfigField>
      {openClawForm.authProvider === 'cloudflare-ai-gateway' ? (
        <div className="store-config-form nested store-config-two-column">
          <ConfigField label="Cloudflare Account ID" htmlFor="openclaw-cf-account-id">
            <ConfigTextInput
              id="openclaw-cf-account-id"
              value={openClawForm.cfAccountId}
              onChange={(event) => updateOpenClawForm({ cfAccountId: event.target.value })}
              placeholder="account-id"
            />
          </ConfigField>
          <ConfigField label="Gateway ID" htmlFor="openclaw-cf-gateway-id">
            <ConfigTextInput
              id="openclaw-cf-gateway-id"
              value={openClawForm.cfGatewayId}
              onChange={(event) => updateOpenClawForm({ cfGatewayId: event.target.value })}
              placeholder="gateway-id"
            />
          </ConfigField>
        </div>
      ) : null}
      {openClawForm.authProvider === 'litellm' ? (
        <ConfigField label="LiteLLM Base URL" htmlFor="openclaw-litellm-base-url">
          <ConfigTextInput
            id="openclaw-litellm-base-url"
            value={openClawForm.litellmBaseUrl}
            onChange={(event) => updateOpenClawForm({ litellmBaseUrl: event.target.value })}
            placeholder="http://localhost:4000"
          />
        </ConfigField>
      ) : null}
      {openClawForm.authProvider === 'vllm' ? (
        <div className="store-config-form nested store-config-two-column">
          <ConfigField label="vLLM Base URL" htmlFor="openclaw-vllm-base-url">
            <ConfigTextInput
              id="openclaw-vllm-base-url"
              value={openClawForm.vllmBaseUrl}
              onChange={(event) => updateOpenClawForm({ vllmBaseUrl: event.target.value })}
              placeholder="http://127.0.0.1:8000/v1"
            />
          </ConfigField>
          <ConfigField label="vLLM Model ID" htmlFor="openclaw-vllm-model-id">
            <ConfigTextInput
              id="openclaw-vllm-model-id"
              value={openClawForm.vllmModelId}
              onChange={(event) => updateOpenClawForm({ vllmModelId: event.target.value })}
              placeholder="Qwen/Qwen3-Coder"
            />
          </ConfigField>
        </div>
      ) : null}
      {openClawForm.authProvider === 'custom' ? (
        <div className="store-config-form nested store-config-two-column">
          <ConfigField label="Custom Base URL" htmlFor="openclaw-custom-base-url">
            <ConfigTextInput
              id="openclaw-custom-base-url"
              value={openClawForm.customBaseUrl}
              onChange={(event) => updateOpenClawForm({ customBaseUrl: event.target.value })}
              placeholder="https://llm.example/v1"
            />
          </ConfigField>
          <ConfigField label="Custom Model ID" htmlFor="openclaw-custom-model-id">
            <ConfigTextInput
              id="openclaw-custom-model-id"
              value={openClawForm.customModelId}
              onChange={(event) => updateOpenClawForm({ customModelId: event.target.value })}
              placeholder="provider/model"
            />
          </ConfigField>
          <ConfigField label="Custom Provider ID" htmlFor="openclaw-custom-provider-id">
            <ConfigTextInput
              id="openclaw-custom-provider-id"
              value={openClawForm.customProviderId}
              onChange={(event) => updateOpenClawForm({ customProviderId: event.target.value })}
              placeholder="custom-provider"
            />
          </ConfigField>
          <ConfigField label="Compatibility" htmlFor="openclaw-custom-compatibility">
            <ConfigSelect
              id="openclaw-custom-compatibility"
              value={openClawForm.customCompatibility}
              onChange={(event) => updateOpenClawForm({ customCompatibility: event.target.value as OpenClawCustomCompatibility })}
            >
              {customCompatibilities.map((compatibility) => (
                <option key={compatibility} value={compatibility}>{compatibility}</option>
              ))}
            </ConfigSelect>
          </ConfigField>
          <ConfigField label="Context Window" htmlFor="openclaw-custom-context-window" className="store-config-span-two">
            <ConfigTextInput
              id="openclaw-custom-context-window"
              type="number"
              min={16000}
              step={1024}
              value={openClawForm.customContextWindow}
              onChange={(event) => updateOpenClawForm({ customContextWindow: Math.max(16000, Number(event.target.value) || 204800) })}
              placeholder="204800"
            />
          </ConfigField>
        </div>
      ) : null}
    </>
  );

  const renderContent = (activeStep: string) => {
    if (activeStep === '\u914d\u7f6e\u5904\u7406') {
      return (
        <div className="store-config-form">
          {openClawConfigSummary.length > 0 ? (
            <div className="store-config-summary" aria-label="OpenClaw config summary">
              {openClawConfigSummary.map((line) => <p key={line}>{line}</p>)}
            </div>
          ) : (
            <p className="store-config-placeholder">
              {openClawConfigExists ? '\u5df2\u68c0\u6d4b\u5230 OpenClaw \u914d\u7f6e\uff0c\u53ef\u9009\u62e9\u4fdd\u7559\u3001\u66f4\u65b0\u6216\u91cd\u7f6e\u3002' : '\u672a\u68c0\u6d4b\u5230\u73b0\u6709 OpenClaw \u914d\u7f6e\u3002'}
            </p>
          )}
          <div className="store-config-choice-grid" role="radiogroup" aria-label="OpenClaw config action">
            {renderOpenClawChoice('openclaw-config-action', 'Keep', openClawForm.configAction === 'keep', () => updateOpenClawForm({ configAction: 'keep', resetScope: '' }), '\u4fdd\u7559\u73b0\u6709\u914d\u7f6e')}
            {renderOpenClawChoice('openclaw-config-action', 'Update', openClawForm.configAction === 'update', () => updateOpenClawForm({ configAction: 'update', resetScope: '' }), '\u5199\u5165\u672c\u6b21\u8868\u5355\u914d\u7f6e')}
            {renderOpenClawChoice('openclaw-config-action', 'Reset', openClawForm.configAction === 'reset', () => updateOpenClawForm({ configAction: 'reset' }), '\u5148\u6267\u884c\u91cd\u7f6e\u518d\u4fdd\u5b58')}
          </div>
          {openClawForm.configAction === 'reset' ? (
            <div className="store-config-subsection">
              <p>{'\u91cd\u7f6e\u8303\u56f4'}</p>
              <div className="store-config-choice-grid" role="radiogroup" aria-label={'\u91cd\u7f6e\u8303\u56f4'}>
                {renderOpenClawChoice('openclaw-reset-scope', '\u4ec5\u914d\u7f6e', openClawForm.resetScope === 'config', () => updateOpenClawForm({ resetScope: 'config' }))}
                {renderOpenClawChoice('openclaw-reset-scope', '\u914d\u7f6e\u3001\u51ed\u636e\u548c\u4f1a\u8bdd', openClawForm.resetScope === 'config+creds+sessions', () => updateOpenClawForm({ resetScope: 'config+creds+sessions' }))}
                {renderOpenClawChoice('openclaw-reset-scope', '\u5b8c\u6574\u91cd\u7f6e', openClawForm.resetScope === 'full', () => updateOpenClawForm({ resetScope: 'full' }))}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    if (activeStep === '\u6a21\u578b\u4e0e\u5bc6\u94a5') {
      return (
        <div className="store-config-form">
          {renderOpenClawModelFields()}
        </div>
      );
    }

    if (activeStep === '\u8fd0\u884c\u4e0e\u5de5\u4f5c\u533a') {
      return (
        <div className="store-config-form">
          <ConfigField label={'\u8fd0\u884c\u6a21\u5f0f'}>
            <div className="store-config-choice-grid" role="radiogroup" aria-label={'\u8fd0\u884c\u6a21\u5f0f'}>
              {renderOpenClawChoice('openclaw-mode', 'local', openClawForm.mode === 'local', () => updateOpenClawForm({ mode: 'local' }))}
              {renderOpenClawChoice('openclaw-mode', 'remote', openClawForm.mode === 'remote', () => updateOpenClawForm({ mode: 'remote' }))}
            </div>
          </ConfigField>
          <ConfigField label={'\u5de5\u4f5c\u533a'} htmlFor="openclaw-workspace">
            <ConfigTextInput
              id="openclaw-workspace"
              value={openClawForm.workspace}
              onChange={(event) => updateOpenClawForm({ workspace: event.target.value })}
              placeholder="E:/work/project"
            />
          </ConfigField>
          {openClawForm.mode === 'remote' ? (
            <>
              <ConfigField label="Remote URL" htmlFor="openclaw-remote-url">
                <ConfigTextInput id="openclaw-remote-url" value={openClawForm.remoteUrl} onChange={(event) => updateOpenClawForm({ remoteUrl: event.target.value })} placeholder="wss://..." />
              </ConfigField>
              <ConfigField label="Remote Token" htmlFor="openclaw-remote-token">
                <ConfigTextInput id="openclaw-remote-token" type="password" value={openClawForm.remoteToken} onChange={(event) => updateOpenClawForm({ remoteToken: event.target.value })} />
              </ConfigField>
            </>
          ) : null}
        </div>
      );
    }

    if (activeStep === 'Gateway') {
      return (
        <div className="store-config-form store-config-two-column">
          <ConfigField label="Gateway Port" htmlFor="openclaw-gateway-port">
            <ConfigTextInput id="openclaw-gateway-port" type="number" value={openClawForm.gatewayPort} onChange={(event) => updateOpenClawForm({ gatewayPort: Number(event.target.value) })} />
          </ConfigField>
          <ConfigField label="Gateway Bind" htmlFor="openclaw-gateway-bind">
            <ConfigSelect id="openclaw-gateway-bind" value={openClawForm.gatewayBind} onChange={(event) => updateOpenClawForm({ gatewayBind: event.target.value as OpenClawGatewayBind })}>
              {gatewayBinds.map((bind) => <option key={bind} value={bind}>{bind}</option>)}
            </ConfigSelect>
          </ConfigField>
          <ConfigField label="Gateway Auth" htmlFor="openclaw-gateway-auth">
            <ConfigSelect id="openclaw-gateway-auth" value={openClawForm.gatewayAuthMode} onChange={(event) => updateOpenClawForm({ gatewayAuthMode: event.target.value as OpenClawGatewayAuthMode })}>
              {gatewayAuthModes.map((authMode) => <option key={authMode} value={authMode}>{authMode}</option>)}
            </ConfigSelect>
          </ConfigField>
          <ConfigField label="Tailscale" htmlFor="openclaw-tailscale">
            <ConfigSelect id="openclaw-tailscale" value={openClawForm.tailscaleMode} onChange={(event) => updateOpenClawForm({ tailscaleMode: event.target.value as OpenClawTailscaleMode })}>
              {tailscaleModes.map((tailscaleMode) => <option key={tailscaleMode} value={tailscaleMode}>{tailscaleMode}</option>)}
            </ConfigSelect>
          </ConfigField>
          <ConfigField label="Gateway Token" htmlFor="openclaw-gateway-token" className="store-config-span-two">
            <ConfigTextInput id="openclaw-gateway-token" value={openClawForm.gatewayToken} onChange={(event) => updateOpenClawForm({ gatewayToken: event.target.value })} />
          </ConfigField>
        </div>
      );
    }

    if (activeStep === '\u96c6\u6210') {
      return (
        <div className="store-config-form">
          <ConfigField label="Channels">
            <div className="store-config-checkbox-list">
              {openClawScan.channels.length ? openClawScan.channels.map((channel) => (
                <label key={channel.id} className="store-config-checkbox">
                  <input type="checkbox" checked={openClawForm.channels.includes(channel.id)} onChange={(event) => toggleOpenClawList('channels', channel.id, event.target.checked)} />
                  <span>{channel.name || channel.id}{channel.configured ? ' \u5df2\u914d\u7f6e' : ''}</span>
                </label>
              )) : <p className="store-config-empty">{'\u6682\u65e0\u53ef\u7528\u6e20\u9053'}</p>}
            </div>
          </ConfigField>
          {showFeishuFields ? (
            <div className="store-config-subsection">
              <p>Feishu / Lark</p>
              <div className="store-config-form nested store-config-two-column">
                <ConfigField label="App ID" htmlFor="openclaw-feishu-app-id">
                  <ConfigTextInput
                    id="openclaw-feishu-app-id"
                    value={openClawForm.feishuAppId}
                    onChange={(event) => updateOpenClawForm({ feishuAppId: event.target.value })}
                    placeholder="cli_xxx"
                  />
                </ConfigField>
                <ConfigField label="App Secret" htmlFor="openclaw-feishu-app-secret">
                  <ConfigTextInput
                    id="openclaw-feishu-app-secret"
                    type="password"
                    value={openClawForm.feishuAppSecret}
                    onChange={(event) => updateOpenClawForm({ feishuAppSecret: event.target.value })}
                    placeholder="app secret"
                  />
                </ConfigField>
                <ConfigField label="Connection Mode" htmlFor="openclaw-feishu-connection-mode">
                  <ConfigSelect
                    id="openclaw-feishu-connection-mode"
                    value={openClawForm.feishuConnectionMode}
                    onChange={(event) => updateOpenClawForm({ feishuConnectionMode: event.target.value as OpenClawFeishuConnectionMode })}
                  >
                    {feishuConnectionModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </ConfigSelect>
                </ConfigField>
                <ConfigField label="Domain" htmlFor="openclaw-feishu-domain">
                  <ConfigSelect
                    id="openclaw-feishu-domain"
                    value={openClawForm.feishuDomain}
                    onChange={(event) => updateOpenClawForm({ feishuDomain: event.target.value as OpenClawFeishuDomain })}
                  >
                    {feishuDomains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
                  </ConfigSelect>
                </ConfigField>
                <ConfigField label="Group Policy" htmlFor="openclaw-feishu-group-policy">
                  <ConfigSelect
                    id="openclaw-feishu-group-policy"
                    value={openClawForm.feishuGroupPolicy}
                    onChange={(event) => updateOpenClawForm({ feishuGroupPolicy: event.target.value as OpenClawFeishuGroupPolicy })}
                  >
                    {feishuGroupPolicies.map((policy) => <option key={policy} value={policy}>{policy}</option>)}
                  </ConfigSelect>
                </ConfigField>
                {openClawForm.feishuGroupPolicy === 'allowlist' ? (
                  <ConfigField label="Group Allowlist" htmlFor="openclaw-feishu-group-allowlist">
                    <ConfigTextInput
                      id="openclaw-feishu-group-allowlist"
                      value={openClawForm.feishuGroupAllowFrom}
                      onChange={(event) => updateOpenClawForm({ feishuGroupAllowFrom: event.target.value })}
                      placeholder="ou_xxx, oc_xxx"
                    />
                  </ConfigField>
                ) : null}
                {openClawForm.feishuConnectionMode === 'webhook' ? (
                  <>
                    <ConfigField label="Verification Token" htmlFor="openclaw-feishu-verification-token">
                      <ConfigTextInput
                        id="openclaw-feishu-verification-token"
                        type="password"
                        value={openClawForm.feishuVerificationToken}
                        onChange={(event) => updateOpenClawForm({ feishuVerificationToken: event.target.value })}
                      />
                    </ConfigField>
                    <ConfigField label="Webhook Path" htmlFor="openclaw-feishu-webhook-path">
                      <ConfigTextInput
                        id="openclaw-feishu-webhook-path"
                        value={openClawForm.feishuWebhookPath}
                        onChange={(event) => updateOpenClawForm({ feishuWebhookPath: event.target.value })}
                        placeholder="/feishu/events"
                      />
                    </ConfigField>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          <ConfigField label={'\u641c\u7d22\u63d0\u4f9b\u5546'} htmlFor="openclaw-search-provider">
            <ConfigSelect id="openclaw-search-provider" value={openClawForm.searchProvider} onChange={(event) => updateOpenClawForm({ searchProvider: event.target.value })}>
              <option value="">{'\u4e0d\u542f\u7528'}</option>
              {openClawScan.searchProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>
              ))}
            </ConfigSelect>
          </ConfigField>
          <ConfigField label={'\u641c\u7d22 API Key'} htmlFor="openclaw-search-key">
            <ConfigTextInput id="openclaw-search-key" type="password" value={openClawForm.searchApiKey} onChange={(event) => updateOpenClawForm({ searchApiKey: event.target.value })} />
          </ConfigField>
        </div>
      );
    }

    if (activeStep === '\u5de5\u5177') {
      return (
        <div className="store-config-form store-config-two-column">
          <ConfigField label="Skills">
            <div className="store-config-checkbox-list">
              {openClawScan.skills.length ? openClawScan.skills.map((skill) => (
                <label key={skill.name} className="store-config-checkbox">
                  <input type="checkbox" checked={openClawForm.selectedSkills.includes(skill.name)} disabled={skill.disabled} onChange={(event) => toggleOpenClawList('selectedSkills', skill.name, event.target.checked)} />
                  <span>{skill.emoji ? `${skill.emoji} ` : ''}{skill.name}</span>
                </label>
              )) : <p className="store-config-empty">{'\u6682\u65e0\u53ef\u9009 Skill'}</p>}
            </div>
          </ConfigField>
          <ConfigField label="Hooks">
            <div className="store-config-checkbox-list">
              {openClawScan.hooks.length ? openClawScan.hooks.map((hook) => (
                <label key={hook.name} className="store-config-checkbox">
                  <input type="checkbox" checked={openClawForm.hooks.includes(hook.name)} onChange={(event) => toggleOpenClawList('hooks', hook.name, event.target.checked)} />
                  <span>{hook.emoji ? `${hook.emoji} ` : ''}{hook.name}</span>
                </label>
              )) : <p className="store-config-empty">{'\u6682\u65e0\u53ef\u9009 Hook'}</p>}
            </div>
          </ConfigField>
        </div>
      );
    }

    return (
      <div className="store-config-form">
        <label className="store-config-checkbox">
          <input
            type="checkbox"
            aria-label="Install daemon"
            checked={openClawForm.installDaemon}
            onChange={(event) => updateOpenClawForm({ installDaemon: event.target.checked })}
          />
          <span>Install daemon</span>
        </label>
        <div className="store-config-summary">
          <p>Config: {openClawForm.configAction}{openClawForm.resetScope ? ` / ${openClawForm.resetScope}` : ''}</p>
          <p>Provider: {openClawForm.authProvider || '\u672a\u9009\u62e9'}</p>
          <p>Model: {openClawForm.modelId || '\u672a\u586b\u5199'}</p>
          <p>Mode: {openClawForm.mode}</p>
          <p>Gateway: {openClawForm.gatewayBind}:{openClawForm.gatewayPort}</p>
          <p>Workspace: {openClawForm.workspace || '\u672a\u586b\u5199'}</p>
          <p>Install daemon: {openClawForm.installDaemon ? 'install' : 'skip'}</p>
        </div>
      </div>
    );
  };

  return {
    clearMessages,
    loadingConfig,
    loadError,
    renderContent,
    save,
    saveError,
    savedMessage,
    savingConfig,
  };
}
