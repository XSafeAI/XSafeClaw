import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type NanobotConfigPayload,
  type NanobotConfigResponse,
  type NanobotModelCatalogProvider,
  type NanobotModelCatalogResponse,
  type NanobotProviderOption,
  systemAPI,
} from './services/api';
import { ConfigField, ConfigSelect, ConfigTextInput } from './StoreConfigFields';
import {
  defaultNanobotStoreConfigForm,
  type NanobotGuardMode,
  type NanobotStoreConfigForm,
  storeConfigText,
} from './storeConfigTypes';

type NanobotStoreConfigOptions = {
  enabled: boolean;
  onSaved: () => void;
};

type NanobotCatalogState = {
  providerOptions: NanobotProviderOption[];
  modelProviders: NanobotModelCatalogProvider[];
  defaultModel: string;
};

const emptyNanobotCatalog: NanobotCatalogState = {
  providerOptions: [],
  modelProviders: [],
  defaultModel: '',
};

const nanobotGuardModes: NanobotGuardMode[] = ['disabled', 'observe', 'blocking'];
const gatewayRestartSuccessStatuses = new Set<string>(['', 'started', 'already_running', 'skipped', 'success', 'ok']);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isGatewayRestartFailed(status: string) {
  const normalizedStatus = normalizeText(status).toLowerCase();
  return Boolean(normalizedStatus) && !gatewayRestartSuccessStatuses.has(normalizedStatus);
}

function resolveProviderDefaultModel(
  providerId: string,
  catalog: NanobotCatalogState,
): string {
  if (!providerId) return '';

  const fromProviderOption = catalog.providerOptions.find((option) => option.id === providerId)?.default_model;
  if (fromProviderOption) return fromProviderOption;

  const providerModels = catalog.modelProviders.find((provider) => provider.id === providerId)?.models;
  if (providerModels?.length) return providerModels[0].id;

  return catalog.defaultModel || '';
}

function formatSaveMessageForRestartStatus(
  response: NanobotConfigResponse,
): string {
  const restartStatus = normalizeText(response.restart_status);
  const restartDetail = normalizeText(response.restart_detail);
  const normalizedRestartStatus = restartStatus.toLowerCase();

  if (isGatewayRestartFailed(normalizedRestartStatus)) {
    const detailSuffix = restartDetail ? `重启详情：${restartDetail}` : '';
    return `配置已保存，但 gateway 重启失败，需要重试。${detailSuffix}`;
  }

  const detailSuffix = restartDetail ? ` 重启详情：${restartDetail}` : '';
  if (normalizedRestartStatus === 'skipped') {
    return `配置已保存，当前未检测到运行中的 gateway，配置将于下一次启动生效。${detailSuffix}`;
  }

  return `配置已保存，gateway 已重启且生效。${detailSuffix}`;
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === 'string') return response.data.detail;
  }
  return error instanceof Error ? error.message : String(error);
}

function dedupeProviderOptions(options: NanobotProviderOption[], modelProviders: NanobotModelCatalogProvider[]) {
  const seen = new Set<string>();
  const merged: NanobotProviderOption[] = [];

  for (const option of options) {
    if (!option.id || seen.has(option.id)) continue;
    seen.add(option.id);
    merged.push(option);
  }

  for (const provider of modelProviders) {
    if (!provider.id || seen.has(provider.id)) continue;
    seen.add(provider.id);
    merged.push({
      id: provider.id,
      name: provider.name || provider.id,
      default_model: provider.models?.[0]?.id || '',
    });
  }

  return merged;
}

function numberOrFallback(value: unknown, fallback: number) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function formFromConfig(config: NanobotConfigResponse): NanobotStoreConfigForm {
  return {
    ...defaultNanobotStoreConfigForm,
    provider: config.provider || '',
    model: config.model || '',
    apiKey: '',
    clearApiKey: false,
    apiBase: config.api_base || '',
    workspace: config.workspace || defaultNanobotStoreConfigForm.workspace,
    gatewayHost: config.gateway?.host || defaultNanobotStoreConfigForm.gatewayHost,
    gatewayPort: numberOrFallback(config.gateway?.port, defaultNanobotStoreConfigForm.gatewayPort),
    websocketEnabled: Boolean(config.websocket?.enabled),
    websocketHost: config.websocket?.host || defaultNanobotStoreConfigForm.websocketHost,
    websocketPort: numberOrFallback(config.websocket?.port, defaultNanobotStoreConfigForm.websocketPort),
    websocketPath: config.websocket?.path || defaultNanobotStoreConfigForm.websocketPath,
    websocketRequiresToken: Boolean(config.websocket?.requires_token),
    websocketToken: '',
    guardMode: config.guard?.mode || defaultNanobotStoreConfigForm.guardMode,
    guardBaseUrl: config.guard?.base_url || defaultNanobotStoreConfigForm.guardBaseUrl,
    guardTimeoutS: numberOrFallback(config.guard?.timeout_s, defaultNanobotStoreConfigForm.guardTimeoutS),
  };
}

function catalogFromResponse(catalog: NanobotModelCatalogResponse): NanobotCatalogState {
  const modelProviders = Array.isArray(catalog.model_providers) ? catalog.model_providers : [];
  return {
    providerOptions: dedupeProviderOptions(
      Array.isArray(catalog.provider_options) ? catalog.provider_options : [],
      modelProviders,
    ),
    modelProviders,
    defaultModel: typeof catalog.default_model === 'string' ? catalog.default_model : '',
  };
}

function buildNanobotPayload(form: NanobotStoreConfigForm): NanobotConfigPayload {
  const apiKey = form.apiKey.trim();
  const apiBase = form.apiBase.trim();
  const websocketToken = form.websocketToken.trim();

  return {
    provider: form.provider.trim() || null,
    model: form.model.trim() || null,
    api_key: apiKey || null,
    clear_api_key: form.clearApiKey,
    api_base: apiBase || null,
    workspace: form.workspace.trim(),
    gateway_host: form.gatewayHost.trim(),
    gateway_port: form.gatewayPort,
    websocket_enabled: form.websocketEnabled,
    websocket_host: form.websocketHost.trim(),
    websocket_port: form.websocketPort,
    websocket_path: form.websocketPath.trim() || '/',
    websocket_requires_token: form.websocketRequiresToken,
    websocket_token: websocketToken || null,
    guard_mode: form.guardMode,
    guard_base_url: form.guardBaseUrl.trim(),
    guard_timeout_s: form.guardTimeoutS,
  };
}

export function useNanobotStoreConfig({ enabled, onSaved }: NanobotStoreConfigOptions) {
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [warningMessage, setWarningMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [nanobotForm, setNanobotForm] = useState<NanobotStoreConfigForm>(defaultNanobotStoreConfigForm);
  const [nanobotCatalog, setNanobotCatalog] = useState<NanobotCatalogState>(emptyNanobotCatalog);
  const [configProviderOptions, setConfigProviderOptions] = useState<NanobotProviderOption[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<NanobotConfigResponse['provider_configs']>({});
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoadingConfig(true);
    setLoadError('');

    Promise.allSettled([
      systemAPI.getNanobotConfig(),
      systemAPI.getNanobotModelCatalog(),
    ])
      .then((results) => {
        if (cancelled) return;
        const errors: string[] = [];
        const [configResult, catalogResult] = results;

        if (configResult.status === 'fulfilled') {
          const config = configResult.value.data;
          setNanobotForm(formFromConfig(config));
          setConfigProviderOptions(Array.isArray(config.provider_options) ? config.provider_options : []);
          setProviderConfigs(config.provider_configs || {});
        } else {
          errors.push(errorMessage(configResult.reason));
        }

        if (catalogResult.status === 'fulfilled') {
          setNanobotCatalog(catalogFromResponse(catalogResult.value.data));
        } else {
          errors.push(errorMessage(catalogResult.reason));
        }

        if (errors.length) setLoadError(`${storeConfigText.loadFailed}: ${errors.join('; ')}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const providerOptions = useMemo(
    () => dedupeProviderOptions(
      [...nanobotCatalog.providerOptions, ...configProviderOptions],
      nanobotCatalog.modelProviders,
    ),
    [configProviderOptions, nanobotCatalog.modelProviders, nanobotCatalog.providerOptions],
  );
  const selectedProviderConfig = nanobotForm.provider ? providerConfigs[nanobotForm.provider] : undefined;
  const modelOptions = useMemo(() => {
    const selectedProvider = nanobotCatalog.modelProviders.find((provider) => provider.id === nanobotForm.provider);
    return selectedProvider?.models?.length
      ? selectedProvider.models
      : nanobotCatalog.modelProviders.flatMap((provider) => provider.models || []);
  }, [nanobotCatalog.modelProviders, nanobotForm.provider]);

  const clearMessages = () => {
    setSavedMessage('');
    setSaveError('');
    setWarningMessage('');
  };

  const updateNanobotForm = (patch: Partial<NanobotStoreConfigForm>) => {
    setNanobotForm((previous) => ({ ...previous, ...patch }));
    clearMessages();
  };

  const pickProvider = (providerId: string) => {
    const nextModel = resolveProviderDefaultModel(providerId, nanobotCatalog);
    const nextApiBase = providerId ? normalizeText(providerConfigs[providerId]?.api_base) : '';
    setNanobotForm((previous) => ({
      ...previous,
      provider: providerId,
      model: providerId === previous.provider ? previous.model : (nextModel || ''),
      apiBase: providerId === previous.provider ? previous.apiBase : nextApiBase,
      apiKey: providerId === previous.provider ? previous.apiKey : '',
      clearApiKey: providerId === previous.provider ? previous.clearApiKey : false,
    }));
    clearMessages();
  };

  const save = async () => {
    if (saveInFlightRef.current) return;

    setSavedMessage('');
    setSaveError('');
    setWarningMessage('');
    saveInFlightRef.current = true;
    setSavingConfig(true);
    try {
      const response = await systemAPI.setNanobotConfig(buildNanobotPayload(nanobotForm));
      const responseConfig = response.data as NanobotConfigResponse;

      if (responseConfig.success === false) {
        setSaveError(`${storeConfigText.saveFailed}: ${responseConfig.restart_detail || '请求处理失败'}`);
        return;
      }

      const restartFailed = isGatewayRestartFailed(normalizeText(responseConfig.restart_status));
      const message = formatSaveMessageForRestartStatus(responseConfig);
      if (restartFailed) {
        setWarningMessage(message);
        return;
      }

      setSavedMessage(message);
      onSaved();
    } catch (error) {
      setSaveError(`${storeConfigText.saveFailed}: ${errorMessage(error)}`);
    } finally {
      saveInFlightRef.current = false;
      setSavingConfig(false);
    }
  };

  const renderModelFields = () => (
    <div className="store-config-form">
      <ConfigField label="Provider" htmlFor="nanobot-provider">
        <ConfigSelect
          id="nanobot-provider"
          value={nanobotForm.provider}
          onChange={(event) => pickProvider(event.target.value)}
        >
          <option value="">{'\u9009\u62e9\u63d0\u4f9b\u5546'}</option>
          {providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name || provider.id}
            </option>
          ))}
        </ConfigSelect>
      </ConfigField>
      <ConfigField label="Model ID" htmlFor="nanobot-model">
        <ConfigTextInput
          id="nanobot-model"
          list="nanobot-model-options"
          value={nanobotForm.model}
          onChange={(event) => updateNanobotForm({ model: event.target.value })}
          placeholder={nanobotCatalog.defaultModel || 'gpt-5.1'}
        />
        <datalist id="nanobot-model-options">
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>{model.name || model.id}</option>
          ))}
        </datalist>
      </ConfigField>
      <ConfigField
        label="API Key"
        htmlFor="nanobot-api-key"
        hint={selectedProviderConfig?.has_api_key ? '\u5df2\u68c0\u6d4b\u5230\u73b0\u6709 Key' : undefined}
      >
        <ConfigTextInput
          id="nanobot-api-key"
          type="password"
          value={nanobotForm.apiKey}
          onChange={(event) => updateNanobotForm({ apiKey: event.target.value })}
          placeholder="sk-..."
        />
      </ConfigField>
      <label className="store-config-checkbox">
        <input
          type="checkbox"
          checked={nanobotForm.clearApiKey}
          onChange={(event) => updateNanobotForm({ clearApiKey: event.target.checked })}
        />
        <span>Clear API Key</span>
      </label>
      <ConfigField label="API Base" htmlFor="nanobot-api-base">
        <ConfigTextInput
          id="nanobot-api-base"
          value={nanobotForm.apiBase}
          onChange={(event) => updateNanobotForm({ apiBase: event.target.value })}
          placeholder="https://api.example/v1"
        />
      </ConfigField>
    </div>
  );

  const renderWorkspace = () => (
    <div className="store-config-form">
      <ConfigField label="Workspace" htmlFor="nanobot-workspace">
        <ConfigTextInput
          id="nanobot-workspace"
          value={nanobotForm.workspace}
          onChange={(event) => updateNanobotForm({ workspace: event.target.value })}
          placeholder="~/.nanobot/workspace"
        />
      </ConfigField>
    </div>
  );

  const renderGateway = () => (
    <div className="store-config-form store-config-two-column">
      <ConfigField label="Gateway Host" htmlFor="nanobot-gateway-host">
        <ConfigTextInput
          id="nanobot-gateway-host"
          value={nanobotForm.gatewayHost}
          onChange={(event) => updateNanobotForm({ gatewayHost: event.target.value })}
          placeholder="127.0.0.1"
        />
      </ConfigField>
      <ConfigField label="Gateway Port" htmlFor="nanobot-gateway-port">
        <ConfigTextInput
          id="nanobot-gateway-port"
          type="number"
          value={nanobotForm.gatewayPort}
          onChange={(event) => updateNanobotForm({ gatewayPort: numberOrFallback(event.target.value, defaultNanobotStoreConfigForm.gatewayPort) })}
        />
      </ConfigField>
    </div>
  );

  const renderWebSocket = () => (
    <div className="store-config-form store-config-two-column">
      <label className="store-config-checkbox store-config-span-two">
        <input
          type="checkbox"
          checked={nanobotForm.websocketEnabled}
          onChange={(event) => updateNanobotForm({ websocketEnabled: event.target.checked })}
        />
        <span>WebSocket Enabled</span>
      </label>
      <ConfigField label="WebSocket Host" htmlFor="nanobot-websocket-host">
        <ConfigTextInput
          id="nanobot-websocket-host"
          value={nanobotForm.websocketHost}
          onChange={(event) => updateNanobotForm({ websocketHost: event.target.value })}
          placeholder="127.0.0.1"
        />
      </ConfigField>
      <ConfigField label="WebSocket Port" htmlFor="nanobot-websocket-port">
        <ConfigTextInput
          id="nanobot-websocket-port"
          type="number"
          value={nanobotForm.websocketPort}
          onChange={(event) => updateNanobotForm({ websocketPort: numberOrFallback(event.target.value, defaultNanobotStoreConfigForm.websocketPort) })}
        />
      </ConfigField>
      <ConfigField label="WebSocket Path" htmlFor="nanobot-websocket-path">
        <ConfigTextInput
          id="nanobot-websocket-path"
          value={nanobotForm.websocketPath}
          onChange={(event) => updateNanobotForm({ websocketPath: event.target.value })}
          placeholder="/"
        />
      </ConfigField>
      <ConfigField label="WebSocket Token" htmlFor="nanobot-websocket-token">
        <ConfigTextInput
          id="nanobot-websocket-token"
          type="password"
          value={nanobotForm.websocketToken}
          onChange={(event) => updateNanobotForm({ websocketToken: event.target.value })}
        />
      </ConfigField>
      <label className="store-config-checkbox store-config-span-two">
        <input
          type="checkbox"
          checked={nanobotForm.websocketRequiresToken}
          onChange={(event) => updateNanobotForm({ websocketRequiresToken: event.target.checked })}
        />
        <span>Requires Token</span>
      </label>
    </div>
  );

  const renderGuard = () => (
    <div className="store-config-form store-config-two-column">
      <ConfigField label="Guard Mode" htmlFor="nanobot-guard-mode">
        <ConfigSelect
          id="nanobot-guard-mode"
          value={nanobotForm.guardMode}
          onChange={(event) => updateNanobotForm({ guardMode: event.target.value as NanobotGuardMode })}
        >
          {nanobotGuardModes.map((mode) => (
            <option key={mode} value={mode}>{mode}</option>
          ))}
        </ConfigSelect>
      </ConfigField>
      <ConfigField label="Guard Timeout" htmlFor="nanobot-guard-timeout">
        <ConfigTextInput
          id="nanobot-guard-timeout"
          type="number"
          min={1}
          value={nanobotForm.guardTimeoutS}
          onChange={(event) => updateNanobotForm({ guardTimeoutS: numberOrFallback(event.target.value, defaultNanobotStoreConfigForm.guardTimeoutS) })}
        />
      </ConfigField>
      <ConfigField label="Guard Base URL" htmlFor="nanobot-guard-base-url" className="store-config-span-two">
        <ConfigTextInput
          id="nanobot-guard-base-url"
          value={nanobotForm.guardBaseUrl}
          onChange={(event) => updateNanobotForm({ guardBaseUrl: event.target.value })}
          placeholder="http://127.0.0.1:6874"
        />
      </ConfigField>
    </div>
  );

  const renderReview = () => (
    <div className="store-config-form">
      <div className="store-config-summary" aria-label="Nanobot review summary">
        <p>{`Provider: ${nanobotForm.provider || '\u672a\u9009\u62e9'}`}</p>
        <p>{`Model: ${nanobotForm.model || '\u672a\u586b\u5199'}`}</p>
        <p>{`API Key: ${nanobotForm.clearApiKey ? '\u5c06\u6e05\u9664' : nanobotForm.apiKey.trim() ? '\u5f85\u4fdd\u5b58' : selectedProviderConfig?.has_api_key ? '\u5df2\u914d\u7f6e' : '\u672a\u586b\u5199'}`}</p>
        <p>{`API Base: ${nanobotForm.apiBase || '\u672a\u586b\u5199'}`}</p>
        <p>{`Workspace: ${nanobotForm.workspace || '\u672a\u586b\u5199'}`}</p>
        <p>{`Gateway: ${nanobotForm.gatewayHost}:${nanobotForm.gatewayPort}`}</p>
        <p>{`WebSocket: ${nanobotForm.websocketEnabled ? 'enabled' : 'disabled'} ${nanobotForm.websocketHost}:${nanobotForm.websocketPort}${nanobotForm.websocketPath || '/'}`}</p>
        <p>{`Guard: ${nanobotForm.guardMode} ${nanobotForm.guardBaseUrl} (${nanobotForm.guardTimeoutS}s)`}</p>
      </div>
    </div>
  );

  const renderContent = (activeStep: string) => {
    if (activeStep === '\u6a21\u578b\u4e0e\u5bc6\u94a5') return renderModelFields();
    if (activeStep === '\u5de5\u4f5c\u533a') return renderWorkspace();
    if (activeStep === 'Gateway') return renderGateway();
    if (activeStep === 'WebSocket') return renderWebSocket();
    if (activeStep === 'Guard') return renderGuard();
    return renderReview();
  };

  return {
    clearMessages,
    loadingConfig,
    loadError,
    renderContent,
    save,
    warningMessage,
    saveError,
    savedMessage,
    savingConfig,
  };
}

