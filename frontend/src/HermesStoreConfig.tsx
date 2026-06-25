import { useEffect, useMemo, useRef, useState } from 'react';
import { systemAPI } from './services/api';
import { ConfigField, ConfigSelect, ConfigTextInput } from './StoreConfigFields';
import {
  defaultHermesStoreConfigForm,
  type HermesBotPlatform,
  type HermesModelProvider,
  type HermesProviderEndpointBundle,
  type HermesStoreConfigForm,
  storeConfigText,
} from './storeConfigTypes';

type HermesStoreConfigOptions = {
  enabled: boolean;
  onSaved: () => void;
};

type HermesStatusSnapshot = Record<string, unknown> & {
  hermes_installed?: boolean;
  hermes_path?: string | null;
  hermes_config_path?: string | null;
  hermes_home?: string | null;
  hermes_api_key_configured?: boolean;
  hermes_api_server_enabled?: boolean;
  hermes_api_port?: number;
  api_reachable?: boolean;
};

type HermesScanState = {
  modelProviders: HermesModelProvider[];
  providerEndpoints: Record<string, HermesProviderEndpointBundle>;
  recommendedBaseUrls: Record<string, string>;
  defaultModel: string;
};

const emptyHermesScanState: HermesScanState = {
  modelProviders: [],
  providerEndpoints: {},
  recommendedBaseUrls: {},
  defaultModel: '',
};

const HERMES_CUSTOM_PROVIDER_ID = 'custom';

function isSelectableHermesModelProvider(provider: HermesModelProvider) {
  return provider.id !== HERMES_CUSTOM_PROVIDER_ID;
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === 'string') return response.data.detail;
  }
  return error instanceof Error ? error.message : String(error);
}

function statusText(value: boolean | undefined, yes: string, no: string) {
  if (typeof value !== 'boolean') return '\u672a\u77e5';
  return value ? yes : no;
}

function getEndpointDefault(providerId: string, scan: HermesScanState) {
  const endpointBundle = scan.providerEndpoints[providerId];
  const current = endpointBundle?.current?.trim();
  if (current) return current;
  const preset = endpointBundle?.presets?.find((item) => item.base_url)?.base_url;
  if (preset) return preset;
  return scan.recommendedBaseUrls[providerId] || '';
}

function applyHermesScanDefaults(
  previous: HermesStoreConfigForm,
  scan: HermesScanState,
): HermesStoreConfigForm {
  if (previous.modelProvider || previous.modelId || !scan.defaultModel) return previous;

  const providerId = scan.defaultModel.includes('/') ? scan.defaultModel.split('/')[0] : '';
  const provider = scan.modelProviders.find((item) => item.id === providerId);
  if (!provider) return previous;

  return {
    ...previous,
    modelProvider: provider.id,
    modelId: scan.defaultModel,
    baseUrl: getEndpointDefault(provider.id, scan),
  };
}

export function useHermesStoreConfig({ enabled, onSaved }: HermesStoreConfigOptions) {
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [hermesStatus, setHermesStatus] = useState<HermesStatusSnapshot>({});
  const [hermesScan, setHermesScan] = useState<HermesScanState>(emptyHermesScanState);
  const [botPlatforms, setBotPlatforms] = useState<HermesBotPlatform[]>([]);
  const [botEnvPath, setBotEnvPath] = useState('');
  const [anyBotConfigured, setAnyBotConfigured] = useState(false);
  const [hermesForm, setHermesForm] = useState<HermesStoreConfigForm>(defaultHermesStoreConfigForm);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoadingConfig(true);
    setLoadError('');

    Promise.allSettled([
      systemAPI.status('hermes'),
      systemAPI.onboardScan('hermes'),
      systemAPI.hermesBotPlatforms(),
    ])
      .then((results) => {
        if (cancelled) return;
        const errors: string[] = [];
        const [statusResult, scanResult, botResult] = results;

        if (statusResult.status === 'fulfilled') {
          setHermesStatus(statusResult.value.data as unknown as HermesStatusSnapshot);
        } else {
          errors.push(errorMessage(statusResult.reason));
        }

        if (scanResult.status === 'fulfilled') {
          const data = scanResult.value.data as Record<string, unknown>;
          const nextScan: HermesScanState = {
            modelProviders: Array.isArray(data.model_providers)
              ? (data.model_providers as HermesModelProvider[]).filter(isSelectableHermesModelProvider)
              : [],
            providerEndpoints: data.provider_endpoints && typeof data.provider_endpoints === 'object'
              ? data.provider_endpoints as Record<string, HermesProviderEndpointBundle>
              : {},
            recommendedBaseUrls: data.provider_recommended_base_urls && typeof data.provider_recommended_base_urls === 'object'
              ? data.provider_recommended_base_urls as Record<string, string>
              : {},
            defaultModel: typeof data.default_model === 'string' ? data.default_model : '',
          };
          setHermesScan(nextScan);
          setHermesForm((previous) => applyHermesScanDefaults(
            previous.modelProvider === HERMES_CUSTOM_PROVIDER_ID
              ? { ...previous, modelProvider: '', modelId: '', baseUrl: '' }
              : previous,
            nextScan,
          ));
        } else {
          errors.push(errorMessage(scanResult.reason));
        }

        if (botResult.status === 'fulfilled') {
          const data = botResult.value.data as Record<string, unknown>;
          setBotPlatforms(Array.isArray(data.platforms) ? data.platforms as HermesBotPlatform[] : []);
          setBotEnvPath(typeof data.env_path === 'string' ? data.env_path : '');
          setAnyBotConfigured(Boolean(data.any_configured));
        } else {
          errors.push(errorMessage(botResult.reason));
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

  const selectedModelProvider = useMemo(
    () => hermesScan.modelProviders.find((provider) => provider.id === hermesForm.modelProvider),
    [hermesForm.modelProvider, hermesScan.modelProviders],
  );
  const modelOptions = useMemo(() => {
    if (selectedModelProvider?.models?.length) return selectedModelProvider.models;
    return hermesScan.modelProviders.flatMap((provider) => provider.models || []);
  }, [hermesScan.modelProviders, selectedModelProvider]);
  const selectedEndpointBundle = hermesForm.modelProvider
    ? hermesScan.providerEndpoints[hermesForm.modelProvider]
    : undefined;
  const selectedBotPlatform = useMemo(
    () => botPlatforms.find((platform) => platform.id === hermesForm.botPlatform),
    [botPlatforms, hermesForm.botPlatform],
  );

  const clearMessages = () => {
    setSavedMessage('');
    setSaveError('');
  };

  const updateHermesForm = (patch: Partial<HermesStoreConfigForm>) => {
    setHermesForm((previous) => ({ ...previous, ...patch }));
    clearMessages();
  };

  const pickModelProvider = (providerId: string) => {
    setHermesForm((previous) => ({
      ...previous,
      modelProvider: providerId,
      modelId: '',
      baseUrl: providerId ? getEndpointDefault(providerId, hermesScan) : '',
    }));
    clearMessages();
  };

  const pickBotPlatform = (platformId: string) => {
    const platform = botPlatforms.find((item) => item.id === platformId);
    const fields: Record<string, string> = {};
    for (const field of platform?.fields || []) fields[field.key] = '';
    updateHermesForm({ botPlatform: platformId, botFields: fields });
  };

  const updateBotField = (key: string, value: string) => {
    setHermesForm((previous) => ({
      ...previous,
      botFields: { ...previous.botFields, [key]: value },
    }));
    clearMessages();
  };

  const handleSaved = () => {
    setSavedMessage(storeConfigText.saved);
    onSaved();
  };

  const save = async () => {
    if (saveInFlightRef.current) return;

    setSavedMessage('');
    setSaveError('');
    saveInFlightRef.current = true;
    setSavingConfig(true);
    try {
      if (hermesForm.modelProvider === HERMES_CUSTOM_PROVIDER_ID) {
        throw new Error('Hermes Store-native custom provider is not supported yet');
      }

      const apiKey = hermesForm.apiKey.trim();
      if (apiKey) {
        await systemAPI.saveHermesApiKey(apiKey);
        setHermesStatus((previous) => ({ ...previous, hermes_api_key_configured: true }));
      }

      if (hermesForm.modelProvider && hermesForm.modelId) {
        const baseUrl = hermesForm.baseUrl.trim();
        await systemAPI.quickModelConfig({
          platform: 'hermes',
          provider: hermesForm.modelProvider,
          model_id: hermesForm.modelId,
          base_url: baseUrl || undefined,
        });
      }

      if (hermesStatus.hermes_api_server_enabled === false) {
        const response = await systemAPI.hermesEnableApiServer();
        setHermesStatus((previous) => ({
          ...previous,
          hermes_api_server_enabled: Boolean(response.data.hermes_api_server_enabled),
          api_reachable: Boolean(response.data.api_reachable),
          hermes_api_port: response.data.hermes_api_port || previous.hermes_api_port,
        }));
      }

      if (hermesForm.botPlatform) {
        await systemAPI.hermesBotConfig({
          platform: hermesForm.botPlatform,
          fields: Object.fromEntries(
            Object.entries(hermesForm.botFields).map(([key, value]) => [key, value.trim()]),
          ),
        });
      }

      handleSaved();
    } catch (error) {
      setSaveError(`${storeConfigText.saveFailed}: ${errorMessage(error)}`);
    } finally {
      saveInFlightRef.current = false;
      setSavingConfig(false);
    }
  };

  const renderStatusSummary = () => (
    <div className="store-config-summary" aria-label="Hermes status summary">
      <p>{`\u5b89\u88c5: ${statusText(hermesStatus.hermes_installed, '\u5df2\u5b89\u88c5', '\u672a\u5b89\u88c5')}`}</p>
      <p>{`Path: ${hermesStatus.hermes_path || '\u672a\u68c0\u6d4b\u5230'}`}</p>
      <p>{`Home: ${hermesStatus.hermes_home || '\u672a\u68c0\u6d4b\u5230'}`}</p>
      <p>{`Config: ${hermesStatus.hermes_config_path || '\u672a\u68c0\u6d4b\u5230'}`}</p>
      <p>{`API Key: ${statusText(hermesStatus.hermes_api_key_configured, '\u5df2\u914d\u7f6e', '\u672a\u914d\u7f6e')}`}</p>
      <p>{`API Server: ${statusText(hermesStatus.hermes_api_server_enabled, '\u5df2\u542f\u7528', '\u672a\u542f\u7528')}`}</p>
      <p>{`Reachable: ${statusText(hermesStatus.api_reachable, '\u53ef\u8fbe', '\u4e0d\u53ef\u8fbe')}`}</p>
      <p>{`Port: ${hermesStatus.hermes_api_port || '\u672a\u77e5'}`}</p>
    </div>
  );

  const renderApiKeyField = () => (
    <ConfigField
      label="Hermes API Key"
      htmlFor="hermes-api-key"
      hint={statusText(hermesStatus.hermes_api_key_configured, '\u5df2\u68c0\u6d4b\u5230\u73b0\u6709 Key', '\u672a\u68c0\u6d4b\u5230 Key')}
    >
      <ConfigTextInput
        id="hermes-api-key"
        type="password"
        value={hermesForm.apiKey}
        onChange={(event) => updateHermesForm({ apiKey: event.target.value })}
        placeholder="hsk-..."
      />
    </ConfigField>
  );

  const renderModelAndKeyFields = () => (
    <div className="store-config-form">
      <ConfigField label={'\u6a21\u578b\u63d0\u4f9b\u5546'} htmlFor="hermes-model-provider">
        <ConfigSelect
          id="hermes-model-provider"
          value={hermesForm.modelProvider}
          onChange={(event) => pickModelProvider(event.target.value)}
        >
          <option value="">{'\u9009\u62e9\u63d0\u4f9b\u5546'}</option>
          {hermesScan.modelProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name || provider.id}
            </option>
          ))}
        </ConfigSelect>
      </ConfigField>
      <ConfigField label={'\u6a21\u578b ID'} htmlFor="hermes-model-id">
        <ConfigTextInput
          id="hermes-model-id"
          list="hermes-model-options"
          value={hermesForm.modelId}
          onChange={(event) => updateHermesForm({ modelId: event.target.value })}
          placeholder="openai/gpt-5.1"
        />
        <datalist id="hermes-model-options">
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>{model.name || model.id}</option>
          ))}
        </datalist>
      </ConfigField>
      <ConfigField label="Base URL" htmlFor="hermes-base-url">
        <ConfigTextInput
          id="hermes-base-url"
          list="hermes-base-url-options"
          value={hermesForm.baseUrl}
          onChange={(event) => updateHermesForm({ baseUrl: event.target.value })}
          placeholder={hermesForm.modelProvider ? getEndpointDefault(hermesForm.modelProvider, hermesScan) || 'https://api.example/v1' : 'https://api.example/v1'}
        />
        <datalist id="hermes-base-url-options">
          {selectedEndpointBundle?.presets?.map((preset) => (
            <option key={preset.id} value={preset.base_url}>{preset.label}</option>
          ))}
        </datalist>
      </ConfigField>
      {renderApiKeyField()}
    </div>
  );

  const renderBotFields = () => (
    <div className="store-config-form">
      <ConfigField label={'Bot \u5e73\u53f0'} htmlFor="hermes-bot-platform">
        <ConfigSelect
          id="hermes-bot-platform"
          value={hermesForm.botPlatform}
          onChange={(event) => pickBotPlatform(event.target.value)}
        >
          <option value="">{'\u4e0d\u914d\u7f6e Bot \u5e73\u53f0'}</option>
          {botPlatforms.map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.name || platform.id}{platform.configured ? ' - configured' : ''}
            </option>
          ))}
        </ConfigSelect>
      </ConfigField>
      {selectedBotPlatform ? (
        <div className="store-config-form nested store-config-two-column">
          {selectedBotPlatform.fields.map((field) => (
            <ConfigField
              key={field.key}
              label={field.label || field.key}
              htmlFor={`hermes-bot-${field.key}`}
            >
              <ConfigTextInput
                id={`hermes-bot-${field.key}`}
                type={field.secret ? 'password' : 'text'}
                value={hermesForm.botFields[field.key] || ''}
                onChange={(event) => updateBotField(field.key, event.target.value)}
                placeholder={field.placeholder || (field.configured ? '\u5df2\u914d\u7f6e' : '')}
                required={field.required}
              />
            </ConfigField>
          ))}
        </div>
      ) : (
        <p className="store-config-empty">{botPlatforms.length ? '\u9009\u62e9\u5e73\u53f0\u540e\u663e\u793a\u914d\u7f6e\u9879' : '\u6682\u65e0\u53ef\u7528 Bot \u5e73\u53f0'}</p>
      )}
      {botEnvPath || anyBotConfigured ? (
        <div className="store-config-summary" aria-label="Hermes bot summary">
          <p>{`Env: ${botEnvPath || '\u672a\u68c0\u6d4b\u5230'}`}</p>
          <p>{`Bot: ${anyBotConfigured ? '\u5df2\u914d\u7f6e' : '\u672a\u914d\u7f6e'}`}</p>
        </div>
      ) : null}
    </div>
  );

  const renderReview = () => (
    <div className="store-config-form">
      <div className="store-config-summary" aria-label="Hermes review summary">
        <p>{`API Key: ${hermesForm.apiKey.trim() ? '\u5f85\u4fdd\u5b58' : statusText(hermesStatus.hermes_api_key_configured, '\u5df2\u914d\u7f6e', '\u672a\u914d\u7f6e')}`}</p>
        <p>{`Provider: ${hermesForm.modelProvider || '\u672a\u9009\u62e9'}`}</p>
        <p>{`Model: ${hermesForm.modelId || hermesScan.defaultModel || '\u672a\u586b\u5199'}`}</p>
        <p>{`Base URL: ${hermesForm.baseUrl || '\u672a\u586b\u5199'}`}</p>
        <p>{`API Server: ${statusText(hermesStatus.hermes_api_server_enabled, '\u5df2\u542f\u7528', '\u5c06\u542f\u7528')}`}</p>
        <p>{`Bot: ${selectedBotPlatform?.name || hermesForm.botPlatform || '\u672a\u9009\u62e9'}`}</p>
      </div>
    </div>
  );

  const renderContent = (activeStep: string) => {
    if (activeStep === '\u72b6\u6001') {
      return <div className="store-config-form">{renderStatusSummary()}</div>;
    }

    if (activeStep === 'API Key') return <div className="store-config-form">{renderApiKeyField()}</div>;

    if (activeStep === '\u6a21\u578b\u4e0e\u5bc6\u94a5' || activeStep === '\u6a21\u578b') return renderModelAndKeyFields();

    if (activeStep === 'API Server') {
      return <div className="store-config-form">{renderStatusSummary()}</div>;
    }

    if (activeStep === 'Bot \u5e73\u53f0') return renderBotFields();

    return renderReview();
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
