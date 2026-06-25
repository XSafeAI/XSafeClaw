import { Bot, Feather, PawPrint, type LucideIcon } from 'lucide-react';

export type ConfigurableAgentId = 'openclaw' | 'hermes' | 'nanobot';
export type StoreAgentId = ConfigurableAgentId | 'codex';
export type StoreConfigMode = 'quick' | 'full';
export type OpenClawMode = 'local' | 'remote';
export type OpenClawConfigAction = 'keep' | 'update' | 'reset';
export type OpenClawResetScope = '' | 'config' | 'config+creds+sessions' | 'full';
export type OpenClawGatewayBind = 'loopback' | 'lan' | 'auto' | 'custom' | 'tailnet';
export type OpenClawGatewayAuthMode = 'token' | 'password';
export type OpenClawTailscaleMode = 'off' | 'serve' | 'funnel';
export type OpenClawFeishuConnectionMode = 'websocket' | 'webhook';
export type OpenClawFeishuDomain = 'feishu' | 'lark';
export type OpenClawFeishuGroupPolicy = 'open' | 'allowlist' | 'disabled';
export type OpenClawCustomCompatibility = 'openai' | 'anthropic';
export type NanobotGuardMode = 'disabled' | 'observe' | 'blocking';

export type OpenClawAuthMethod = {
  id: string;
  label: string;
  hint?: string;
  modelProviders?: string[];
};

export type OpenClawAuthProvider = {
  id: string;
  name: string;
  hint?: string;
  supported?: boolean;
  methods?: OpenClawAuthMethod[];
};

export type OpenClawModel = {
  id: string;
  name?: string;
  available?: boolean;
};

export type OpenClawModelProvider = {
  id: string;
  name: string;
  models?: OpenClawModel[];
};

export type OpenClawChannel = {
  id: string;
  name: string;
  configured?: boolean;
};

export type OpenClawSkill = {
  name: string;
  description?: string;
  emoji?: string;
  eligible?: boolean;
  disabled?: boolean;
};

export type OpenClawHook = {
  name: string;
  description?: string;
  emoji?: string;
  enabled?: boolean;
};

export type OpenClawSearchProvider = {
  id: string;
  name: string;
  hint?: string;
  placeholder?: string;
};

export type HermesModel = {
  id: string;
  name?: string;
  available?: boolean;
};

export type HermesModelProvider = {
  id: string;
  name: string;
  available?: boolean;
  requiresCredentials?: boolean;
  models?: HermesModel[];
};

export type HermesProviderEndpointPreset = {
  id: string;
  label: string;
  hint?: string;
  base_url: string;
};

export type HermesProviderEndpointBundle = {
  env_key?: string;
  current?: string;
  presets?: HermesProviderEndpointPreset[];
};

export type HermesBotField = {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  configured?: boolean;
};

export type HermesBotPlatform = {
  id: string;
  name: string;
  hint?: string;
  docUrl?: string;
  configured?: boolean;
  fields: HermesBotField[];
};

export type HermesStoreConfigForm = {
  apiKey: string;
  modelProvider: string;
  modelId: string;
  baseUrl: string;
  botPlatform: string;
  botFields: Record<string, string>;
};

export const defaultHermesStoreConfigForm: HermesStoreConfigForm = {
  apiKey: '',
  modelProvider: '',
  modelId: '',
  baseUrl: '',
  botPlatform: '',
  botFields: {},
};

export type NanobotStoreConfigForm = {
  provider: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
  apiBase: string;
  workspace: string;
  gatewayHost: string;
  gatewayPort: number;
  websocketEnabled: boolean;
  websocketHost: string;
  websocketPort: number;
  websocketPath: string;
  websocketRequiresToken: boolean;
  websocketToken: string;
  guardMode: NanobotGuardMode;
  guardBaseUrl: string;
  guardTimeoutS: number;
};

export const defaultNanobotStoreConfigForm: NanobotStoreConfigForm = {
  provider: '',
  model: '',
  apiKey: '',
  clearApiKey: false,
  apiBase: '',
  workspace: '~/.nanobot/workspace',
  gatewayHost: '127.0.0.1',
  gatewayPort: 18790,
  websocketEnabled: true,
  websocketHost: '127.0.0.1',
  websocketPort: 8765,
  websocketPath: '/',
  websocketRequiresToken: false,
  websocketToken: '',
  guardMode: 'blocking',
  guardBaseUrl: 'http://127.0.0.1:6874',
  guardTimeoutS: 305,
};

export type OpenClawStoreConfigForm = {
  mode: OpenClawMode;
  configAction: OpenClawConfigAction;
  resetScope: OpenClawResetScope;
  authProvider: string;
  authMethod: string;
  apiKey: string;
  modelId: string;
  gatewayPort: number;
  gatewayBind: OpenClawGatewayBind;
  gatewayAuthMode: OpenClawGatewayAuthMode;
  gatewayToken: string;
  workspace: string;
  channels: string[];
  hooks: string[];
  searchProvider: string;
  searchApiKey: string;
  selectedSkills: string[];
  installDaemon: boolean;
  tailscaleMode: OpenClawTailscaleMode;
  remoteUrl: string;
  remoteToken: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuConnectionMode: OpenClawFeishuConnectionMode;
  feishuDomain: OpenClawFeishuDomain;
  feishuGroupPolicy: OpenClawFeishuGroupPolicy;
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
  customCompatibility: OpenClawCustomCompatibility;
  customContextWindow: number;
};

export const defaultOpenClawStoreConfigForm: OpenClawStoreConfigForm = {
  mode: 'local',
  configAction: 'update',
  resetScope: '',
  authProvider: '',
  authMethod: '',
  apiKey: '',
  modelId: '',
  gatewayPort: 18789,
  gatewayBind: 'loopback',
  gatewayAuthMode: 'token',
  gatewayToken: '',
  workspace: '',
  channels: [],
  hooks: [],
  searchProvider: '',
  searchApiKey: '',
  selectedSkills: [],
  installDaemon: true,
  tailscaleMode: 'off',
  remoteUrl: '',
  remoteToken: '',
  feishuAppId: '',
  feishuAppSecret: '',
  feishuConnectionMode: 'websocket',
  feishuDomain: 'feishu',
  feishuGroupPolicy: 'open',
  feishuGroupAllowFrom: '',
  feishuVerificationToken: '',
  feishuWebhookPath: '/feishu/events',
  cfAccountId: '',
  cfGatewayId: '',
  litellmBaseUrl: 'http://localhost:4000',
  vllmBaseUrl: 'http://127.0.0.1:8000/v1',
  vllmModelId: '',
  customBaseUrl: '',
  customModelId: '',
  customProviderId: '',
  customCompatibility: 'openai',
  customContextWindow: 204800,
};

export const storeConfigText = {
  backToStore: 'Agent Store',
  quickConfig: '\u5feb\u901f\u914d\u7f6e',
  fullConfig: '\u5b8c\u5168\u914d\u7f6e',
  previous: '\u4e0a\u4e00\u6b65',
  next: '\u4e0b\u4e00\u6b65',
  saveConfig: '\u4fdd\u5b58\u914d\u7f6e',
  applyConfig: '\u5e94\u7528\u914d\u7f6e',
  loading: '\u6b63\u5728\u8bfb\u53d6\u914d\u7f6e',
  loadFailed: '\u914d\u7f6e\u8bfb\u53d6\u5931\u8d25',
  saveFailed: '\u914d\u7f6e\u4fdd\u5b58\u5931\u8d25',
  saved: '\u914d\u7f6e\u5df2\u4fdd\u5b58',
} as const;

type StoreConfigAgentMetadata = {
  id: ConfigurableAgentId;
  name: string;
  icon: LucideIcon;
  tone: 'teal' | 'purple' | 'yellow';
  steps: Record<StoreConfigMode, string[]>;
};

export const STORE_CONFIG_AGENTS: Record<ConfigurableAgentId, StoreConfigAgentMetadata> = {
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw',
    icon: PawPrint,
    tone: 'teal',
    steps: {
      quick: ['\u914d\u7f6e\u5904\u7406', '\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u68c0\u67e5\u4e0e\u5e94\u7528'],
      full: [
        '\u914d\u7f6e\u5904\u7406',
        '\u6a21\u578b\u4e0e\u5bc6\u94a5',
        '\u8fd0\u884c\u4e0e\u5de5\u4f5c\u533a',
        'Gateway',
        '\u96c6\u6210',
        '\u5de5\u5177',
        '\u68c0\u67e5\u4e0e\u5e94\u7528',
      ],
    },
  },
  hermes: {
    id: 'hermes',
    name: 'Hermes',
    icon: Feather,
    tone: 'purple',
    steps: {
      quick: ['\u6a21\u578b\u4e0e\u5bc6\u94a5', 'API Server', '\u68c0\u67e5\u4e0e\u5e94\u7528'],
      full: ['\u72b6\u6001', '\u6a21\u578b\u4e0e\u5bc6\u94a5', 'API Server', 'Bot \u5e73\u53f0', '\u68c0\u67e5\u4e0e\u5e94\u7528'],
    },
  },
  nanobot: {
    id: 'nanobot',
    name: 'Nanobot',
    icon: Bot,
    tone: 'yellow',
    steps: {
      quick: ['\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u68c0\u67e5\u4e0e\u5e94\u7528'],
      full: ['\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u5de5\u4f5c\u533a', 'Gateway', 'WebSocket', 'Guard', '\u68c0\u67e5\u4e0e\u5e94\u7528'],
    },
  },
};

export function isConfigurableStoreAgentId(agentId: StoreAgentId): agentId is ConfigurableAgentId {
  return Object.prototype.hasOwnProperty.call(STORE_CONFIG_AGENTS, agentId);
}
