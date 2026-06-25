import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ConfigField, ConfigSelect, ConfigTextInput } from './StoreConfigPage';
import { I18nProvider } from './i18n';
import { systemAPI } from './services/api';

vi.mock('./services/api', () => ({
  systemAPI: {
    agentStoreCatalog: vi.fn(),
    installStatus: vi.fn(),
    installUrl: vi.fn(),
    nanobotInstallUrl: vi.fn(),
    installHermesUrl: vi.fn(),
    agentStoreInstallUrl: vi.fn(),
    status: vi.fn(),
    onboardScan: vi.fn(),
    onboardConfig: vi.fn(),
    configReset: vi.fn(),
    quickModelConfig: vi.fn(),
    saveHermesApiKey: vi.fn(),
    hermesEnableApiServer: vi.fn(),
    hermesBotPlatforms: vi.fn(),
    hermesBotConfig: vi.fn(),
    getNanobotConfig: vi.fn(),
    getNanobotModelCatalog: vi.fn(),
    setNanobotConfig: vi.fn(),
  },
}));

vi.mock('./pages/Configure', () => ({
  default: () => <div data-testid="configure-page">Configure page</div>,
}));

vi.mock('./pages/NanobotConfigure', () => ({
  default: () => <div data-testid="nanobot-configure-page">Nanobot configure page</div>,
}));

vi.mock('./pages/Setup', () => ({
  default: () => <div data-testid="setup-page">Setup page</div>,
}));

vi.mock('./pages/ConfigureSelector', () => ({
  default: () => <div data-testid="configure-selector-page">Configure selector page</div>,
}));

vi.mock('./pages/CodexConfigure', () => ({
  default: () => <div data-testid="codex-configure-page">Codex configure page</div>,
}));

vi.mock('./pages/RuntimeGuardConsole', () => ({
  default: () => <div data-testid="runtime-guard-page">Runtime Guard page</div>,
}));

const storeText = {
  subtitle: '\u53d1\u73b0\u3001\u5b89\u88c5\u5e76\u7ba1\u7406\u53ef\u7531 XSafeClaw \u76d1\u63a7\u7684 Agent',
  browse: '\u6d4f\u89c8',
  installed: '\u5df2\u5b89\u88c5',
  notInstalled: '\u672a\u5b89\u88c5',
  configured: '\u5df2\u914d\u7f6e',
  needsConfigure: '\u5f85\u914d\u7f6e',
  configure: '\u914d\u7f6e',
  goConfigure: '\u53bb\u914d\u7f6e',
  quickConfig: '\u5feb\u901f\u914d\u7f6e',
  fullConfig: '\u5b8c\u5168\u914d\u7f6e',
  next: '\u4e0b\u4e00\u6b65',
  saveConfig: '\u4fdd\u5b58\u914d\u7f6e',
  applyConfig: '\u5e94\u7528\u914d\u7f6e',
  updates: '\u66f4\u65b0',
  search: '\u641c\u7d22 Agent',
  official: '\u5b98\u65b9',
  verified: '\u5df2\u9a8c\u8bc1',
  experimental: '\u5b9e\u9a8c\u6027',
  details: '\u67e5\u770b\u8be6\u60c5',
  install: '\u5b89\u88c5',
  cancel: '\u53d6\u6d88',
  startInstall: '\u5f00\u59cb\u5b89\u88c5',
  canInstall: '\u53ef\u4ee5\u5b89\u88c5',
  currentDevice: '\u5f53\u524d\u8bbe\u5907',
  downloadSize: '\u4e0b\u8f7d\u5927\u5c0f',
  possibleUse: '\u53ef\u80fd\u4f7f\u7528\uff1a',
  sizeUnknown: '\u5927\u5c0f\u672a\u77e5',
  versionUnknown: '\u7248\u672c\u672a\u77e5',
  installComplete: '\u5b89\u88c5\u5b8c\u6210',
  installFailed: '\u5b89\u88c5\u5931\u8d25',
  compatible: '\u5f53\u524d\u8bbe\u5907\u517c\u5bb9',
};

function renderApp() {
  window.history.pushState({}, '', '/');

  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

function renderAppAt(pathname: string) {
  window.history.pushState({}, '', pathname);

  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

function openStore() {
  const mainPanel = screen.getByLabelText('XSafeClaw workspace');
  const primaryNav = screen.getByLabelText('Primary navigation');

  fireEvent.click(within(primaryNav).getByRole('button', { name: 'Store' }));

  return mainPanel;
}

function getAgentCard(agentName: string) {
  const heading = screen.getAllByRole('heading', { name: agentName }).find((candidate) => candidate.closest('article'));
  if (!heading) {
    throw new Error(`Agent card not found: ${agentName}`);
  }
  const card = heading.closest('article');
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

function clickInstall(agentName: string) {
  fireEvent.click(within(getAgentCard(agentName)).getByRole('button', { name: storeText.install }));
}

function openStoreConfig(agentName: string, installStatusData: Record<string, unknown>) {
  vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({ data: installStatusData } as any);
  renderApp();
  openStore();
  return waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1)).then(() => {
    fireEvent.click(within(getAgentCard(agentName)).getByRole('button', { name: storeText.configure }));
  });
}

function expectVisibleStepButtons(visibleSteps: string[]) {
  const steps = screen.getByLabelText(/configuration steps/);
  for (const step of visibleSteps) {
    expect(within(steps).getByText(step)).toBeTruthy();
  }
}

function expectHiddenStepButtons(hiddenSteps: string[]) {
  const steps = screen.getByLabelText(/configuration steps/);
  for (const step of hiddenSteps) {
    expect(within(steps).queryByText(step)).toBeNull();
  }
}

function goToStepWithNext(stepName: string | RegExp, maxClicks = 10) {
  for (let index = 0; index < maxClicks; index += 1) {
    if (screen.queryByRole('heading', { name: stepName })) return;
    const nextButton = screen.getByRole('button', { name: storeText.next });
    expect(nextButton).not.toBeDisabled();
    fireEvent.click(nextButton);
  }

  expect(screen.getByRole('heading', { name: stepName })).toBeTruthy();
}

const storeConfigFlowCases = [
  {
    agentName: 'OpenClaw',
    installStatusData: {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    },
    quickSteps: ['\u914d\u7f6e\u5904\u7406', '\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u68c0\u67e5\u4e0e\u5e94\u7528'],
  },
  {
    agentName: 'Hermes',
    installStatusData: {
      openclaw_installed: false,
      hermes_installed: true,
      nanobot_installed: false,
      codex_installed: false,
      hermes_config_exists: true,
      hermes_model_configured: true,
      hermes_api_key_configured: true,
      hermes_api_server_enabled: true,
      requires_hermes_configure: false,
    },
    quickSteps: ['\u6a21\u578b\u4e0e\u5bc6\u94a5', 'API Server', '\u68c0\u67e5\u4e0e\u5e94\u7528'],
  },
  {
    agentName: 'Nanobot',
    installStatusData: {
      openclaw_installed: false,
      hermes_installed: false,
      nanobot_installed: true,
      codex_installed: false,
      requires_nanobot_configure: false,
    },
    quickSteps: ['\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u68c0\u67e5\u4e0e\u5e94\u7528'],
  },
] as const;

function mockSseFetch(events: Array<Record<string, unknown>>) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: stream,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockNanobotConfig(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    config_exists: true,
    config_path: 'C:/Users/test/.nanobot/config.json',
    workspace: 'C:/Users/test/.nanobot/workspace',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    model_configured: true,
    api_base: null,
    provider_options: [
      { id: 'anthropic', name: 'Anthropic', default_model: 'claude-3-5-sonnet-latest' },
      { id: 'openai', name: 'OpenAI', default_model: 'gpt-5.1' },
    ],
    provider_configs: {
      anthropic: { has_api_key: true, api_base: null },
      openai: { has_api_key: false, api_base: null },
    },
    gateway: {
      host: '127.0.0.1',
      port: 18790,
      health_url: 'http://127.0.0.1:18790/health',
    },
    websocket: {
      enabled: true,
      host: '127.0.0.1',
      port: 8765,
      path: '/',
      url: 'ws://127.0.0.1:8765/',
      requires_token: false,
      has_token: false,
    },
    guard: {
      mode: 'blocking',
      enabled: true,
      hook_present: true,
      hook_valid: true,
      base_url: 'http://127.0.0.1:6874',
      timeout_s: 305,
      configured_instance_id: null,
    },
    ...overrides,
  };
}

function mockNanobotCatalog() {
  return {
    provider_options: [
      { id: 'anthropic', name: 'Anthropic', default_model: 'claude-3-5-sonnet-latest' },
      { id: 'openai', name: 'OpenAI', default_model: 'gpt-5.1' },
    ],
    model_providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: [{ id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', available: true }],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        models: [{ id: 'gpt-5.1', name: 'GPT-5.1', available: true }],
      },
    ],
    default_model: 'gpt-5.1',
  };
}

describe('XSafeClaw desktop home screen', () => {
  beforeEach(() => {
    vi.mocked(systemAPI.agentStoreCatalog).mockReset();
    vi.mocked(systemAPI.agentStoreCatalog).mockRejectedValue(new Error('catalog unavailable'));
    vi.mocked(systemAPI.installStatus).mockReset();
    vi.mocked(systemAPI.installStatus).mockRejectedValue(new Error('install status unavailable'));
    vi.mocked(systemAPI.installUrl).mockReset();
    vi.mocked(systemAPI.installUrl).mockReturnValue('/api/system/install');
    vi.mocked(systemAPI.nanobotInstallUrl).mockReset();
    vi.mocked(systemAPI.nanobotInstallUrl).mockReturnValue('/api/system/nanobot/install');
    vi.mocked(systemAPI.installHermesUrl).mockReset();
    vi.mocked(systemAPI.installHermesUrl).mockReturnValue('/api/system/install-hermes');
    vi.mocked(systemAPI.agentStoreInstallUrl).mockReset();
    vi.mocked(systemAPI.agentStoreInstallUrl).mockImplementation((agentId: string) => `/api/system/agent-store/${agentId}/install`);
    vi.mocked(systemAPI.status).mockReset();
    vi.mocked(systemAPI.status).mockResolvedValue({ data: {} } as any);
    vi.mocked(systemAPI.onboardScan).mockReset();
    vi.mocked(systemAPI.onboardScan).mockResolvedValue({ data: {} } as any);
    vi.mocked(systemAPI.onboardConfig).mockReset();
    vi.mocked(systemAPI.onboardConfig).mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(systemAPI.configReset).mockReset();
    vi.mocked(systemAPI.configReset).mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(systemAPI.quickModelConfig).mockReset();
    vi.mocked(systemAPI.quickModelConfig).mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(systemAPI.saveHermesApiKey).mockReset();
    vi.mocked(systemAPI.saveHermesApiKey).mockResolvedValue({ data: { success: true, configured: true } } as any);
    vi.mocked(systemAPI.hermesEnableApiServer).mockReset();
    vi.mocked(systemAPI.hermesEnableApiServer).mockResolvedValue({ data: { success: true, hermes_api_server_enabled: true, api_reachable: true } } as any);
    vi.mocked(systemAPI.hermesBotPlatforms).mockReset();
    vi.mocked(systemAPI.hermesBotPlatforms).mockResolvedValue({ data: { platforms: [], env_path: '', any_configured: false } } as any);
    vi.mocked(systemAPI.hermesBotConfig).mockReset();
    vi.mocked(systemAPI.hermesBotConfig).mockResolvedValue({ data: { success: true, platform: 'telegram', written_keys: [], applied: true } } as any);
    vi.mocked(systemAPI.getNanobotConfig).mockReset();
    vi.mocked(systemAPI.getNanobotConfig).mockResolvedValue({ data: mockNanobotConfig() } as any);
    vi.mocked(systemAPI.getNanobotModelCatalog).mockReset();
    vi.mocked(systemAPI.getNanobotModelCatalog).mockResolvedValue({ data: mockNanobotCatalog() } as any);
    vi.mocked(systemAPI.setNanobotConfig).mockReset();
    vi.mocked(systemAPI.setNanobotConfig).mockResolvedValue({ data: mockNanobotConfig() } as any);
    vi.unstubAllGlobals();
  });

  it('does not render the titlebar application menu buttons', () => {
    renderApp();

    expect(screen.queryByRole('navigation', { name: 'Application menu' })).toBeNull();
    expect(screen.queryByRole('button', { name: '\u7f16\u8f91(E)' })).toBeNull();
    expect(screen.queryByRole('button', { name: '\u7a97\u53e3(W)' })).toBeNull();
    expect(screen.queryByRole('button', { name: '\u5e2e\u52a9(H)' })).toBeNull();

    expect(screen.getByRole('button', { name: 'Minimize window' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Maximize window' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close window' })).toBeTruthy();
  });

  it('routes desktop configure paths to the existing configure pages', () => {
    const { unmount } = renderAppAt('/openclaw_configure');
    expect(screen.getByTestId('configure-page')).toBeTruthy();
    unmount();

    const { unmount: unmountHermes } = renderAppAt('/hermes_configure');
    expect(screen.getByTestId('configure-page')).toBeTruthy();
    unmountHermes();

    renderAppAt('/nanobot_configure');
    expect(screen.getByTestId('nanobot-configure-page')).toBeTruthy();
  });

  it('renders only Monitor, Store, and Setting in the primary sidebar cards', () => {
    renderApp();

    const primaryNav = screen.getByLabelText('Primary navigation');
    const navButtons = within(primaryNav).getAllByRole('button');

    expect(navButtons).toHaveLength(3);
    expect(within(primaryNav).getByRole('button', { name: 'Monitor' })).toBeTruthy();
    expect(within(primaryNav).getByRole('button', { name: 'Store' })).toBeTruthy();
    expect(within(primaryNav).getByRole('button', { name: 'Setting' })).toBeTruthy();

    expect(screen.queryByLabelText('Spaces')).toBeNull();
    expect(screen.queryByText('\u7a7a\u95f4 (1)')).toBeNull();
    expect(screen.queryByText('\u9879\u76ee\u65b0\u624b\u6307\u5f15')).toBeNull();
    expect(screen.queryByText('\u751f\u6210\u9879\u76ee\u529f\u80fd\u4ecb\u7ecd')).toBeNull();
    expect(screen.queryByText('2\u5c0f\u65f6\u524d')).toBeNull();

    expect(within(primaryNav).queryByRole('button', { name: /鏂板缓浠诲姟|鍔╃悊|椤圭洰|涓撳|鑷姩鍖東鏇村/u })).toBeNull();
  });

  it('keeps Monitor and Setting as placeholder cards while Store opens the store page', () => {
    renderApp();

    const mainPanel = screen.getByLabelText('XSafeClaw workspace');
    const primaryNav = screen.getByLabelText('Primary navigation');

    expect(within(mainPanel).getByRole('heading', { name: 'Monitor' })).toBeTruthy();
    expect(within(mainPanel).getByText('Monitor placeholder')).toBeTruthy();

    fireEvent.click(within(primaryNav).getByRole('button', { name: 'Store' }));
    expect(within(mainPanel).getByRole('heading', { name: 'Agent Store' })).toBeTruthy();

    fireEvent.click(within(primaryNav).getByRole('button', { name: 'Setting' }));
    expect(within(mainPanel).getByRole('heading', { name: 'Setting' })).toBeTruthy();
    expect(within(mainPanel).getByText('Setting placeholder')).toBeTruthy();
  });

  it('renders the static Agent Store page after Store is selected', () => {
    renderApp();

    const mainPanel = openStore();

    expect(within(mainPanel).getByRole('heading', { name: 'Agent Store' })).toBeTruthy();
    expect(within(mainPanel).getByText(storeText.subtitle)).toBeTruthy();
    expect(within(mainPanel).getByRole('button', { name: storeText.browse })).toBeTruthy();
    expect(within(mainPanel).getByRole('button', { name: storeText.installed })).toBeTruthy();
    expect(within(mainPanel).getByRole('button', { name: storeText.notInstalled })).toBeTruthy();
    expect(within(mainPanel).queryByRole('button', { name: storeText.updates })).toBeNull();
    expect(within(mainPanel).getByPlaceholderText(storeText.search)).toBeTruthy();

    for (const agentName of ['OpenClaw', 'Hermes', 'Nanobot', 'Codex']) {
      expect(within(mainPanel).getByRole('heading', { name: agentName })).toBeTruthy();
      const card = getAgentCard(agentName);
      expect(within(card).getByText(storeText.notInstalled)).toBeTruthy();
      expect(within(card).queryByText(storeText.official)).toBeNull();
      expect(within(card).queryByText(storeText.verified)).toBeNull();
      expect(within(card).queryByText(storeText.experimental)).toBeNull();
      expect(within(card).getByText('0')).toBeTruthy();
      expect(within(card).getByText('0.0')).toBeTruthy();
    }

    const expectedCapabilities = {
      OpenClaw: ['Windows \u5b89\u88c5\u5668', 'CLI', storeText.compatible],
      Hermes: ['Windows \u5b89\u88c5\u5668', 'CLI \u670d\u52a1', storeText.compatible],
      Nanobot: ['uv tool', 'Python \u5305', storeText.compatible],
      Codex: ['Windows \u5b89\u88c5\u5668', 'CLI', storeText.compatible],
    };
    for (const [agentName, capabilityLabels] of Object.entries(expectedCapabilities)) {
      const card = getAgentCard(agentName);
      for (const label of capabilityLabels) {
        expect(within(card).getByText(label)).toBeTruthy();
      }
    }

    const expectedTags = {
      OpenClaw: ['\u81ea\u6258\u7ba1', '\u591a\u6e20\u9053', '\u7f51\u5173'],
      Hermes: ['\u81ea\u8fdb\u5316', '\u957f\u671f\u8bb0\u5fc6', '\u591a\u5e73\u53f0'],
      Nanobot: ['\u8f7b\u91cf\u5185\u6838', '\u53ef\u8bfb\u6e90\u7801', '\u4e2a\u4eba Agent'],
      Codex: ['\u4ee3\u7801\u4ee3\u7406', '\u672c\u5730\u7ec8\u7aef', '\u4ed3\u5e93\u7f16\u8f91'],
    };
    for (const [agentName, tagLabels] of Object.entries(expectedTags)) {
      const card = getAgentCard(agentName);
      for (const label of tagLabels) {
        expect(within(card).getByText(label)).toBeTruthy();
      }
    }

    for (const outdatedTag of ['\u901a\u7528', '\u81ea\u52a8\u5316', '\u5f00\u53d1', '\u534f\u540c', '\u901a\u4fe1', '\u6548\u7387', '\u5b9e\u9a8c', '\u5b66\u4e60', '\u7f16\u7a0b', '\u5f00\u53d1\u8005\u5de5\u5177', 'AI \u52a9\u624b']) {
      expect(within(mainPanel).queryByText(outdatedTag)).toBeNull();
    }

    for (const outdatedCapability of ['\u9700 API Key', '\u9700 Docker', 'Docker', '\u684c\u9762\u5e94\u7528']) {
      expect(within(mainPanel).queryByText(outdatedCapability)).toBeNull();
    }

    expect(within(mainPanel).getAllByRole('button', { name: storeText.details })).toHaveLength(4);
    expect(within(mainPanel).getAllByRole('button', { name: storeText.install })).toHaveLength(4);
    expect(within(mainPanel).getAllByText(storeText.sizeUnknown)).toHaveLength(4);
    expect(within(mainPanel).getAllByText(storeText.versionUnknown)).toHaveLength(4);

    for (const subtitle of [
      '\u901a\u7528\u578b Agent\uff0c\u9002\u7528\u4e8e\u591a\u79cd\u4efb\u52a1\u573a\u666f\uff0c\u7075\u6d3b\u6269\u5c55\uff0c\u6613\u4e8e\u96c6\u6210\u3002',
      '\u8f7b\u91cf\u534f\u540c\u578b Agent\uff0c\u4e13\u6ce8\u4e8e\u9ad8\u6548\u901a\u4fe1\u4e0e\u534f\u540c\u3002',
      '\u81ea\u6211\u8fdb\u5316\u5b9e\u9a8c\u6027 Agent\uff0c\u64c5\u957f\u63a2\u7d22\u3001\u5b66\u4e60\u4e0e\u81ea\u52a8\u5316\u6267\u884c\u3002',
      '\u9762\u5411\u5f00\u53d1\u8005\u7684\u7f16\u7a0b Agent\uff0c\u7406\u89e3\u4ee3\u7801\u3001\u751f\u6210\u4ee3\u7801\u3001\u8f85\u52a9\u8c03\u8bd5\u3002',
    ]) {
      expect(within(mainPanel).queryByText(subtitle)).toBeNull();
    }

    for (const fakeValue of [
      '128.6K',
      '85.3K',
      '32.1K',
      '210.7K',
      '4.7',
      '4.5',
      '4.2',
      '4.8',
      '124 MB',
      '98 MB',
      '256 MB',
      '152 MB',
      'v1.4.2',
      'v2.1.0',
      'v0.9.3',
      'v3.0.1',
    ]) {
      expect(within(mainPanel).queryByText(fakeValue)).toBeNull();
    }
  });

  it('renders Agent Store card install state from the install-status endpoint', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: true,
      },
    } as any);
    renderApp();

    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));

    expect(within(getAgentCard('OpenClaw')).getByText(storeText.installed)).toBeTruthy();
    expect(within(getAgentCard('Hermes')).getByText(storeText.notInstalled)).toBeTruthy();
    expect(within(getAgentCard('Nanobot')).getByText(storeText.installed)).toBeTruthy();
    expect(within(getAgentCard('Codex')).getByText(storeText.installed)).toBeTruthy();
  });

  it('shows configure state and opens Hermes Store-native configuration without changing routes', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: true,
        nanobot_installed: true,
        codex_installed: true,
        config_exists: true,
        requires_hermes_configure: true,
        requires_nanobot_configure: false,
      },
    } as any);
    renderApp();

    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));

    expect(within(getAgentCard('OpenClaw')).getByText(storeText.configured)).toBeTruthy();
    expect(within(getAgentCard('OpenClaw')).getByRole('button', { name: storeText.configure })).toBeTruthy();
    expect(within(getAgentCard('Hermes')).getByText(storeText.needsConfigure)).toBeTruthy();
    expect(within(getAgentCard('Hermes')).getByRole('button', { name: storeText.goConfigure })).toBeTruthy();
    expect(within(getAgentCard('Nanobot')).getByText(storeText.configured)).toBeTruthy();
    expect(within(getAgentCard('Nanobot')).getByRole('button', { name: storeText.configure })).toBeTruthy();
    expect(within(getAgentCard('Codex')).queryByText(storeText.configured)).toBeNull();
    expect(within(getAgentCard('Codex')).queryByText(storeText.needsConfigure)).toBeNull();
    expect(within(getAgentCard('Codex')).queryByRole('button', { name: storeText.configure })).toBeNull();
    expect(within(getAgentCard('Codex')).queryByRole('button', { name: storeText.goConfigure })).toBeNull();

    fireEvent.click(within(getAgentCard('Hermes')).getByRole('button', { name: storeText.goConfigure }));

    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: 'Hermes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agent Store' })).toBeTruthy();
    expect(screen.getByRole('button', { name: storeText.quickConfig })).toBeTruthy();
    expect(screen.getByRole('button', { name: storeText.fullConfig })).toBeTruthy();
    expect(screen.queryByTestId('configure-page')).toBeNull();
    expect(screen.queryByTestId('nanobot-configure-page')).toBeNull();
  });

  it('shows configure for installed configurable agents with unknown config status', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: false,
        hermes_installed: true,
        nanobot_installed: false,
        codex_installed: false,
      },
    } as any);
    renderApp();

    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));

    const hermesCard = getAgentCard('Hermes');
    expect(within(hermesCard).getByText(storeText.installed)).toBeTruthy();
    expect(within(hermesCard).queryByText(storeText.configured)).toBeNull();
    expect(within(hermesCard).queryByText(storeText.needsConfigure)).toBeNull();
    expect(within(hermesCard).queryByRole('button', { name: storeText.install })).toBeNull();

    fireEvent.click(within(hermesCard).getByRole('button', { name: storeText.configure }));

    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: 'Hermes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: storeText.quickConfig })).toBeTruthy();
    expect(screen.queryByTestId('configure-page')).toBeNull();
  });

  it.each([
    ['OpenClaw', '\u914d\u7f6e', 'configure-page'],
    ['Nanobot', '\u914d\u7f6e', 'nanobot-configure-page'],
  ] as const)('opens %s Store-native configuration without changing routes', async (agentName, buttonLabel, oldPageTestId) => {
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: false,
        config_exists: true,
        requires_nanobot_configure: false,
      },
    } as any);
    renderApp();

    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard(agentName)).getByRole('button', { name: buttonLabel }));

    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: agentName })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agent Store' })).toBeTruthy();
    expect(screen.getByRole('button', { name: storeText.quickConfig })).toBeTruthy();
    expect(screen.getByRole('button', { name: storeText.fullConfig })).toBeTruthy();
    expect(screen.queryByTestId(oldPageTestId)).toBeNull();
  });

  it.each(storeConfigFlowCases)(
    'shows $agentName configuration steps as read-only progress and only changes steps through previous and next',
    async ({ agentName, installStatusData, quickSteps }) => {
      await openStoreConfig(agentName, installStatusData);

      const steps = screen.getByLabelText(`${agentName} configuration steps`);
      expect(within(steps).queryAllByRole('button')).toHaveLength(0);
      for (const step of quickSteps) {
        expect(within(steps).getByText(step)).toBeTruthy();
      }
      expect(screen.getByRole('heading', { name: quickSteps[0] })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: storeText.next }));

      expect(screen.getByRole('heading', { name: quickSteps[1] })).toBeTruthy();
    },
  );

  it.each(storeConfigFlowCases)(
    'only enables $agentName apply configuration on the final step',
    async ({ agentName, installStatusData, quickSteps }) => {
      await openStoreConfig(agentName, installStatusData);

      const applyButton = screen.getByRole('button', { name: storeText.applyConfig });
      for (const step of quickSteps.slice(0, -1)) {
        expect(screen.getByRole('heading', { name: step })).toBeTruthy();
        expect(applyButton).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: storeText.next }));
      }

      expect(screen.getByRole('heading', { name: quickSteps[quickSteps.length - 1] })).toBeTruthy();
      expect(applyButton).toBeEnabled();
    },
  );

  it('shows OpenClaw quick steps before full-only steps and resets to the first step when mode changes', async () => {
    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    expectVisibleStepButtons(['\u914d\u7f6e\u5904\u7406', '\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u68c0\u67e5\u4e0e\u5e94\u7528']);
    expectHiddenStepButtons(['Gateway', '\u96c6\u6210', '\u5de5\u5177']);

    goToStepWithNext('\u68c0\u67e5\u4e0e\u5e94\u7528');
    expect(screen.getByRole('heading', { name: '\u68c0\u67e5\u4e0e\u5e94\u7528' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    expectVisibleStepButtons(['Gateway', '\u96c6\u6210', '\u5de5\u5177']);
    expect(screen.getByRole('heading', { name: '\u914d\u7f6e\u5904\u7406' })).toBeTruthy();

    goToStepWithNext('\u5de5\u5177');
    expect(screen.getByRole('heading', { name: '\u5de5\u5177' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: storeText.quickConfig }));
    expectHiddenStepButtons(['Gateway', '\u96c6\u6210', '\u5de5\u5177']);
    expect(screen.getByRole('heading', { name: '\u914d\u7f6e\u5904\u7406' })).toBeTruthy();
  });

  it('shows Hermes quick steps before full-only steps and resets to the first step when mode changes', async () => {
    await openStoreConfig('Hermes', {
      openclaw_installed: false,
      hermes_installed: true,
      nanobot_installed: false,
      codex_installed: false,
    });

    expectVisibleStepButtons(['\u6a21\u578b\u4e0e\u5bc6\u94a5', 'API Server', '\u68c0\u67e5\u4e0e\u5e94\u7528']);
    expectHiddenStepButtons(['API Key', '\u6a21\u578b', '\u72b6\u6001', 'Bot \u5e73\u53f0']);

    goToStepWithNext('API Server');
    expect(screen.getByRole('heading', { name: 'API Server' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    expectVisibleStepButtons(['\u72b6\u6001', '\u6a21\u578b\u4e0e\u5bc6\u94a5', 'Bot \u5e73\u53f0']);
    expectHiddenStepButtons(['API Key', '\u6a21\u578b']);
    expect(screen.getByRole('heading', { name: '\u72b6\u6001' })).toBeTruthy();

    goToStepWithNext('Bot \u5e73\u53f0');
    expect(screen.getByRole('heading', { name: 'Bot \u5e73\u53f0' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: storeText.quickConfig }));
    expectHiddenStepButtons(['\u72b6\u6001', 'Bot \u5e73\u53f0']);
    expect(screen.getByRole('heading', { name: '\u6a21\u578b\u4e0e\u5bc6\u94a5' })).toBeTruthy();
  });

  it('loads and saves Hermes quick Store-native configuration', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        hermes_installed: true,
        nanobot_installed: false,
        codex_installed: false,
        hermes_config_exists: true,
        hermes_model_configured: false,
        requires_hermes_configure: true,
      },
    } as any);
    vi.mocked(systemAPI.status).mockResolvedValueOnce({
      data: {
        hermes_installed: true,
        hermes_path: 'C:/Users/test/.local/bin/hermes',
        hermes_api_key_configured: false,
        hermes_api_server_enabled: false,
        hermes_api_port: 8642,
        api_reachable: false,
      },
    } as any);
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        model_providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            available: true,
            models: [{ id: 'openai/gpt-5.1', name: 'GPT-5.1', available: true }],
          },
        ],
        provider_endpoints: {
          openai: {
            env_key: 'OPENAI_BASE_URL',
            current: '',
            presets: [{ id: 'default', label: 'OpenAI', base_url: 'https://api.openai.com/v1' }],
          },
        },
      },
    } as any);

    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard('Hermes')).getByRole('button', { name: storeText.goConfigure }));

    await waitFor(() => expect(systemAPI.status).toHaveBeenCalledWith('hermes'));
    await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('hermes'));
    await waitFor(() => expect(systemAPI.hermesBotPlatforms).toHaveBeenCalled());

    expect(screen.getByRole('heading', { name: '\u6a21\u578b\u4e0e\u5bc6\u94a5' })).toBeTruthy();
    expect(screen.getByLabelText('\u6a21\u578b\u63d0\u4f9b\u5546')).toBeTruthy();
    expect(screen.getByLabelText('Hermes API Key')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Hermes API Key'), { target: { value: 'hermes-key' } });
    fireEvent.change(screen.getByLabelText('\u6a21\u578b\u63d0\u4f9b\u5546'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByLabelText('\u6a21\u578b ID'), { target: { value: 'openai/gpt-5.1' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.openai.com/v1' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.saveHermesApiKey).toHaveBeenCalledWith('hermes-key'));
    expect(systemAPI.quickModelConfig).toHaveBeenCalledWith({
      platform: 'hermes',
      provider: 'openai',
      model_id: 'openai/gpt-5.1',
      base_url: 'https://api.openai.com/v1',
    });
    expect(systemAPI.hermesEnableApiServer).toHaveBeenCalled();
    expect(await screen.findByText('\u914d\u7f6e\u5df2\u4fdd\u5b58')).toBeTruthy();
  });

  it('hides custom Hermes model provider from Store-native configuration and does not save it', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        hermes_installed: true,
        nanobot_installed: false,
        codex_installed: false,
        hermes_config_exists: true,
        hermes_model_configured: false,
        requires_hermes_configure: true,
      },
    } as any);
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        model_providers: [
          {
            id: 'custom',
            name: 'Custom Provider',
            available: true,
            models: [{ id: 'custom/local-model', name: 'Local Custom Model', available: true }],
          },
          {
            id: 'openai',
            name: 'OpenAI',
            available: true,
            models: [{ id: 'openai/gpt-5.1', name: 'GPT-5.1', available: true }],
          },
        ],
        provider_endpoints: {
          custom: {
            env_key: 'CUSTOM_BASE_URL',
            current: 'http://localhost:4000/v1',
            presets: [{ id: 'local', label: 'Local', base_url: 'http://localhost:4000/v1' }],
          },
          openai: {
            env_key: 'OPENAI_BASE_URL',
            current: '',
            presets: [{ id: 'default', label: 'OpenAI', base_url: 'https://api.openai.com/v1' }],
          },
        },
        default_model: 'custom/local-model',
      },
    } as any);

    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard('Hermes')).getByRole('button', { name: storeText.goConfigure }));

    await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('hermes'));
    expect(screen.getByRole('heading', { name: '\u6a21\u578b\u4e0e\u5bc6\u94a5' })).toBeTruthy();

    const providerSelect = screen.getByLabelText('\u6a21\u578b\u63d0\u4f9b\u5546') as HTMLSelectElement;
    expect(within(providerSelect).queryByRole('option', { name: 'Custom Provider' })).toBeNull();
    expect(within(providerSelect).getByRole('option', { name: 'OpenAI' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    expect(systemAPI.quickModelConfig).not.toHaveBeenCalledWith(expect.objectContaining({
      platform: 'hermes',
      provider: 'custom',
    }));
  });

  it('saves Hermes Bot platform fields from Full Store-native configuration', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        hermes_installed: true,
        nanobot_installed: false,
        codex_installed: false,
        hermes_config_exists: true,
        hermes_model_configured: true,
        requires_hermes_configure: false,
      },
    } as any);
    vi.mocked(systemAPI.status).mockResolvedValueOnce({
      data: {
        hermes_installed: true,
        hermes_api_key_configured: true,
        hermes_api_server_enabled: true,
        api_reachable: true,
      },
    } as any);
    vi.mocked(systemAPI.hermesBotPlatforms).mockResolvedValueOnce({
      data: {
        platforms: [
          {
            id: 'telegram',
            name: 'Telegram',
            hint: 'Telegram Bot API',
            docUrl: 'https://core.telegram.org/bots',
            configured: false,
            fields: [
              {
                key: 'TELEGRAM_BOT_TOKEN',
                label: 'Bot Token',
                required: true,
                secret: true,
                placeholder: '123:abc',
                configured: false,
              },
              {
                key: 'TELEGRAM_ALLOWED_CHAT_ID',
                label: 'Allowed Chat ID',
                required: false,
                secret: false,
                placeholder: '123456',
                configured: false,
              },
            ],
          },
        ],
        env_path: 'C:/Users/test/.hermes/.env',
        any_configured: false,
      },
    } as any);

    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard('Hermes')).getByRole('button', { name: storeText.configure }));
    await waitFor(() => expect(systemAPI.hermesBotPlatforms).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    goToStepWithNext('Bot \u5e73\u53f0');
    fireEvent.change(screen.getByLabelText('Bot \u5e73\u53f0'), { target: { value: 'telegram' } });
    fireEvent.change(screen.getByLabelText('Bot Token'), { target: { value: 'telegram-token' } });
    fireEvent.change(screen.getByLabelText('Allowed Chat ID'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.hermesBotConfig).toHaveBeenCalledWith({
      platform: 'telegram',
      fields: {
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        TELEGRAM_ALLOWED_CHAT_ID: '123456',
      },
    }));
  });

  it('shows Nanobot quick steps before full-only steps and resets to the first step when mode changes', async () => {
    await openStoreConfig('Nanobot', {
      openclaw_installed: false,
      hermes_installed: false,
      nanobot_installed: true,
      codex_installed: false,
      requires_nanobot_configure: false,
    });

    expectVisibleStepButtons(['\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u68c0\u67e5\u4e0e\u5e94\u7528']);
    expectHiddenStepButtons(['Gateway', 'WebSocket', 'Guard']);

    goToStepWithNext('\u68c0\u67e5\u4e0e\u5e94\u7528');
    expect(screen.getByRole('heading', { name: '\u68c0\u67e5\u4e0e\u5e94\u7528' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    expectVisibleStepButtons(['Gateway', 'WebSocket', 'Guard']);
    expect(screen.getByRole('heading', { name: '\u6a21\u578b\u4e0e\u5bc6\u94a5' })).toBeTruthy();

    goToStepWithNext('Guard');
    expect(screen.getByRole('heading', { name: 'Guard' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: storeText.quickConfig }));
    expectHiddenStepButtons(['Gateway', 'WebSocket', 'Guard']);
    expect(screen.getByRole('heading', { name: '\u6a21\u578b\u4e0e\u5bc6\u94a5' })).toBeTruthy();
  });

  it('loads and saves Nanobot quick Store-native configuration', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: false,
        nanobot_config_exists: true,
        nanobot_model_configured: false,
        requires_nanobot_configure: true,
      },
    } as any);
    vi.mocked(systemAPI.getNanobotConfig).mockResolvedValueOnce({ data: mockNanobotConfig() } as any);
    vi.mocked(systemAPI.getNanobotModelCatalog).mockResolvedValueOnce({ data: mockNanobotCatalog() } as any);

    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard('Nanobot')).getByRole('button', { name: storeText.goConfigure }));

    await waitFor(() => expect(systemAPI.getNanobotConfig).toHaveBeenCalled());
    await waitFor(() => expect(systemAPI.getNanobotModelCatalog).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'gpt-5.1' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-nanobot' } });
    fireEvent.change(screen.getByLabelText('API Base'), { target: { value: 'https://api.openai.com/v1' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.setNanobotConfig).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-5.1',
      api_key: 'sk-nanobot',
      clear_api_key: false,
      api_base: 'https://api.openai.com/v1',
      workspace: 'C:/Users/test/.nanobot/workspace',
      gateway_host: '127.0.0.1',
      gateway_port: 18790,
      websocket_enabled: true,
      websocket_host: '127.0.0.1',
      websocket_port: 8765,
      websocket_path: '/',
      websocket_requires_token: false,
      websocket_token: null,
      guard_mode: 'blocking',
      guard_base_url: 'http://127.0.0.1:6874',
      guard_timeout_s: 305,
    }));
    expect(await screen.findByText('\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0cgateway \u5df2\u91cd\u542f\u4e14\u751f\u6548\u3002')).toBeTruthy();
    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(2));
  });

  it('shows a warning channel when Nanobot save succeeds but gateway restart fails', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: false,
        nanobot_config_exists: true,
        nanobot_model_configured: false,
        requires_nanobot_configure: true,
      },
    } as any);
    vi.mocked(systemAPI.getNanobotConfig).mockResolvedValueOnce({ data: mockNanobotConfig() } as any);
    vi.mocked(systemAPI.getNanobotModelCatalog).mockResolvedValueOnce({ data: mockNanobotCatalog() } as any);
    vi.mocked(systemAPI.setNanobotConfig).mockResolvedValueOnce({
      data: {
        ...mockNanobotConfig(),
        success: true,
        restart_status: 'failed',
        restart_detail: 'Gateway auto-restart failed: test detail',
      },
    } as any);

    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard('Nanobot')).getByRole('button', { name: storeText.goConfigure }));

    await waitFor(() => expect(systemAPI.getNanobotConfig).toHaveBeenCalled());
    await waitFor(() => expect(systemAPI.getNanobotModelCatalog).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-nanobot' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    const warningMessage = await screen.findByText(/配置已保存.*重启失败.*重试/);
    const warningStatus = warningMessage.closest('p');
    expect(warningStatus).toBeTruthy();
    expect(warningStatus).toHaveClass('store-config-status');
    expect(warningStatus).toHaveClass('warning');
    expect(screen.getByText(/Gateway auto-restart failed: test detail/)).toBeTruthy();
    expect(screen.queryByText('配置已保存，gateway 已重启且生效。')).toBeNull();
    expect(screen.queryByText('配置已保存，当前未检测到运行中的 gateway，配置将于下一次启动生效。')).toBeNull();
    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
  });
  it('resets model and api_base when switching Nanobot provider', async () => {
    const catalog = mockNanobotCatalog();
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: false,
        nanobot_config_exists: true,
        nanobot_model_configured: true,
        requires_nanobot_configure: false,
      },
    } as any);
    vi.mocked(systemAPI.getNanobotConfig).mockResolvedValueOnce({
      data: {
        ...mockNanobotConfig(),
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        api_base: 'https://api.anthropic.com/v1',
        provider_configs: {
          ...mockNanobotConfig().provider_configs,
          anthropic: { has_api_key: true, api_base: 'https://api.anthropic.com/v1' },
          openai: { has_api_key: false, api_base: 'https://api.openai.com/v1' },
        },
      },
    } as any);
    vi.mocked(systemAPI.getNanobotModelCatalog).mockResolvedValueOnce({ data: catalog } as any);

    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard('Nanobot')).getByRole('button', { name: storeText.configure }));
    await waitFor(() => expect(systemAPI.getNanobotConfig).toHaveBeenCalled());
    await waitFor(() => expect(systemAPI.getNanobotModelCatalog).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'old-key-value' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clear API Key' }));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.setNanobotConfig).toHaveBeenCalled());
    const payload = vi.mocked(systemAPI.setNanobotConfig).mock.calls[0]?.[0] as Record<string, any>;
    expect(payload.provider).toBe('openai');
    expect(payload.model).toBe('gpt-5.1');
    expect(payload.api_base).toBe('https://api.openai.com/v1');
    expect(payload.api_key).toBeNull();
    expect(payload.clear_api_key).toBe(false);
    expect(payload.model).not.toBe('claude-3-5-sonnet-latest');
    expect(payload.api_base).not.toBe('https://api.anthropic.com/v1');
  });

  it('saves Nanobot Full workspace gateway websocket and guard fields', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: false,
        nanobot_config_exists: true,
        nanobot_model_configured: true,
        requires_nanobot_configure: false,
      },
    } as any);
    vi.mocked(systemAPI.getNanobotConfig).mockResolvedValueOnce({ data: mockNanobotConfig() } as any);
    vi.mocked(systemAPI.getNanobotModelCatalog).mockResolvedValueOnce({ data: mockNanobotCatalog() } as any);

    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard('Nanobot')).getByRole('button', { name: storeText.configure }));
    await waitFor(() => expect(systemAPI.getNanobotConfig).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    goToStepWithNext('\u5de5\u4f5c\u533a');
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'D:/agents/nanobot' } });

    goToStepWithNext('Gateway');
    fireEvent.change(screen.getByLabelText('Gateway Host'), { target: { value: '0.0.0.0' } });
    fireEvent.change(screen.getByLabelText('Gateway Port'), { target: { value: '19001' } });

    goToStepWithNext('WebSocket');
    fireEvent.click(screen.getByLabelText('WebSocket Enabled'));
    fireEvent.change(screen.getByLabelText('WebSocket Host'), { target: { value: '0.0.0.0' } });
    fireEvent.change(screen.getByLabelText('WebSocket Port'), { target: { value: '19002' } });
    fireEvent.change(screen.getByLabelText('WebSocket Path'), { target: { value: '/agents' } });
    fireEvent.click(screen.getByLabelText('Requires Token'));
    fireEvent.change(screen.getByLabelText('WebSocket Token'), { target: { value: 'ws-secret' } });

    goToStepWithNext('Guard');
    fireEvent.change(screen.getByLabelText('Guard Mode'), { target: { value: 'observe' } });
    fireEvent.change(screen.getByLabelText('Guard Base URL'), { target: { value: 'http://127.0.0.1:7777' } });
    fireEvent.change(screen.getByLabelText('Guard Timeout'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.setNanobotConfig).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'D:/agents/nanobot',
      gateway_host: '0.0.0.0',
      gateway_port: 19001,
      websocket_enabled: false,
      websocket_host: '0.0.0.0',
      websocket_port: 19002,
      websocket_path: '/agents',
      websocket_requires_token: true,
      websocket_token: 'ws-secret',
      guard_mode: 'observe',
      guard_base_url: 'http://127.0.0.1:7777',
      guard_timeout_s: 45,
    })));
  });

  it('renders reusable Store-native configuration form primitives', () => {
    render(
      <form className="store-config-form">
        <ConfigField label="Model" hint="Use the provider model id" htmlFor="model-input" className="model-field" data-testid="model-field">
          <ConfigTextInput id="model-input" defaultValue="gpt-4.1" className="model-input" />
        </ConfigField>
        <ConfigField label="Provider" htmlFor="provider-select">
          <ConfigSelect id="provider-select" defaultValue="openai" className="provider-select">
            <option value="openai">OpenAI</option>
          </ConfigSelect>
        </ConfigField>
        <ConfigField label="Grouped controls">
          <ConfigTextInput aria-label="First grouped value" defaultValue="alpha" />
          <ConfigTextInput aria-label="Second grouped value" defaultValue="beta" />
        </ConfigField>
      </form>,
    );

    expect(screen.getByTestId('model-field')).toHaveClass('store-config-field', 'model-field');
    expect(screen.getByText('Use the provider model id')).toHaveClass('store-config-field-hint');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-4.1');
    expect(screen.getByLabelText('Provider')).toHaveValue('openai');
    expect(screen.getByText('Grouped controls').tagName).not.toBe('LABEL');

    expect(screen.getByDisplayValue('gpt-4.1')).toHaveClass('store-config-input', 'model-input');
    expect(screen.getByDisplayValue('OpenAI')).toHaveClass('store-config-input', 'provider-select');
  });

  it('loads OpenClaw scan data and saves quick Store-native configuration', async () => {
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            hint: 'OpenAI API key',
            supported: true,
            methods: [{ id: 'openai', label: 'API Key' }],
          },
        ],
        model_providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            models: [{ id: 'openai/gpt-5.1', name: 'GPT-5.1', available: true }],
          },
        ],
        channels: [],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        config_summary: ['status: empty'],
        defaults: {
          gateway_port: 18789,
          gateway_bind: 'loopback',
          gateway_auth_mode: 'token',
          workspace: 'E:/work/openclaw',
        },
      },
    } as any);

    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    goToStepWithNext('\u6a21\u578b\u4e0e\u5bc6\u94a5');
    await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('openclaw'));
    await waitFor(() => expect(screen.getByLabelText('\u63d0\u4f9b\u5546')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('\u63d0\u4f9b\u5546'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('\u6a21\u578b'), { target: { value: 'openai/gpt-5.1' } });
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: false,
        codex_installed: false,
        config_exists: true,
      },
    } as any);
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'openclaw',
      provider: 'openai',
      api_key: 'sk-test',
      model_id: 'openai/gpt-5.1',
    })));
    expect(await screen.findByText('\u914d\u7f6e\u5df2\u4fdd\u5b58')).toBeTruthy();
    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(2));
  });

  it('saves OpenClaw Full Cloudflare AI Gateway fields from Store-native configuration', async () => {
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [
          { id: 'cloudflare-ai-gateway', name: 'Cloudflare AI Gateway', methods: [{ id: 'cloudflare-ai-gateway-api-key', label: 'API Key' }] },
        ],
        model_providers: [
          { id: 'cloudflare-ai-gateway', name: 'Cloudflare AI Gateway', models: [{ id: 'workers-ai/@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B' }] },
        ],
        channels: [],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        defaults: { config_action: 'update' },
      },
    } as any);

    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    goToStepWithNext('\u6a21\u578b\u4e0e\u5bc6\u94a5');
    await waitFor(() => expect(screen.getByLabelText('\u63d0\u4f9b\u5546')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('\u63d0\u4f9b\u5546'), { target: { value: 'cloudflare-ai-gateway' } });
    fireEvent.change(screen.getByLabelText('Cloudflare Account ID'), { target: { value: 'cf-account-123' } });
    fireEvent.change(screen.getByLabelText('Gateway ID'), { target: { value: 'xsafe-gateway' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'cf-token' } });
    fireEvent.change(screen.getByLabelText('\u6a21\u578b'), { target: { value: 'workers-ai/@cf/meta/llama-3.1-8b-instruct' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'openclaw',
      provider: 'cloudflare-ai-gateway-api-key',
      api_key: 'cf-token',
      model_id: 'workers-ai/@cf/meta/llama-3.1-8b-instruct',
      cf_account_id: 'cf-account-123',
      cf_gateway_id: 'xsafe-gateway',
    })));
  });

  it('saves OpenClaw Full LiteLLM provider fields from Store-native configuration', async () => {
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [
          { id: 'litellm', name: 'LiteLLM', methods: [{ id: 'litellm-api-key', label: 'API Key' }] },
        ],
        model_providers: [],
        channels: [],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        defaults: { config_action: 'update' },
      },
    } as any);

    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    goToStepWithNext('\u6a21\u578b\u4e0e\u5bc6\u94a5');
    await waitFor(() => expect(screen.getByLabelText('\u63d0\u4f9b\u5546')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('\u63d0\u4f9b\u5546'), { target: { value: 'litellm' } });
    fireEvent.change(screen.getByLabelText('LiteLLM Base URL'), { target: { value: 'http://localhost:4000/v1' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'openclaw',
      provider: 'litellm-api-key',
      litellm_base_url: 'http://localhost:4000/v1',
    })));
  });

  it('saves OpenClaw Full vLLM provider fields from Store-native configuration', async () => {
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [
          { id: 'vllm', name: 'vLLM / Local', methods: [{ id: 'vllm', label: 'Local endpoint' }] },
        ],
        model_providers: [],
        channels: [],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        defaults: { config_action: 'update' },
      },
    } as any);

    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    goToStepWithNext('\u6a21\u578b\u4e0e\u5bc6\u94a5');
    await waitFor(() => expect(screen.getByLabelText('\u63d0\u4f9b\u5546')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('\u63d0\u4f9b\u5546'), { target: { value: 'vllm' } });
    fireEvent.change(screen.getByLabelText('vLLM Base URL'), { target: { value: 'http://127.0.0.1:8000/v1' } });
    fireEvent.change(screen.getByLabelText('vLLM Model ID'), { target: { value: 'Qwen/Qwen3-Coder' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'openclaw',
      mode: 'local',
      provider: 'vllm',
      vllm_base_url: 'http://127.0.0.1:8000/v1',
      vllm_model_id: 'Qwen/Qwen3-Coder',
    })));
  });

  it('saves OpenClaw Full custom provider fields from Store-native configuration', async () => {
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [
          { id: 'custom', name: 'Custom Provider', methods: [{ id: 'custom-api-key', label: 'API Key' }] },
        ],
        model_providers: [],
        channels: [],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        defaults: { config_action: 'update' },
      },
    } as any);

    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    goToStepWithNext('\u6a21\u578b\u4e0e\u5bc6\u94a5');
    await waitFor(() => expect(screen.getByLabelText('\u63d0\u4f9b\u5546')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('\u63d0\u4f9b\u5546'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom Base URL'), { target: { value: 'https://llm.example/v1' } });
    fireEvent.change(screen.getByLabelText('Custom Model ID'), { target: { value: 'example/custom-large' } });
    fireEvent.change(screen.getByLabelText('Custom Provider ID'), { target: { value: 'example-provider' } });
    fireEvent.change(screen.getByLabelText('Context Window'), { target: { value: '131072' } });
    fireEvent.change(screen.getByLabelText('Compatibility'), { target: { value: 'anthropic' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'custom-key' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'openclaw',
      provider: 'custom-api-key',
      api_key: 'custom-key',
      custom_base_url: 'https://llm.example/v1',
      custom_model_id: 'example/custom-large',
      custom_provider_id: 'example-provider',
      custom_compatibility: 'anthropic',
      custom_context_window: 131072,
    })));
  });

  it('saves OpenClaw Feishu channel details from Store-native integration step', async () => {
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [],
        model_providers: [],
        channels: [{ id: 'feishu', name: 'Feishu' }],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        defaults: { config_action: 'update' },
      },
    } as any);

    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    goToStepWithNext('\u96c6\u6210');
    await waitFor(() => expect(screen.getByLabelText('Feishu')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Feishu'));
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_a123' } });
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'secret-value' } });
    fireEvent.change(screen.getByLabelText('Connection Mode'), { target: { value: 'webhook' } });
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'lark' } });
    fireEvent.change(screen.getByLabelText('Group Policy'), { target: { value: 'allowlist' } });
    fireEvent.change(screen.getByLabelText('Group Allowlist'), { target: { value: 'ou_1, ou_2' } });
    fireEvent.change(screen.getByLabelText('Verification Token'), { target: { value: 'verify-token' } });
    fireEvent.change(screen.getByLabelText('Webhook Path'), { target: { value: '/events/lark' } });
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      channels: ['feishu'],
      feishu_app_id: 'cli_a123',
      feishu_app_secret: 'secret-value',
      feishu_connection_mode: 'webhook',
      feishu_domain: 'lark',
      feishu_group_policy: 'allowlist',
      feishu_group_allow_from: ['ou_1', 'ou_2'],
      feishu_verification_token: 'verify-token',
      feishu_webhook_path: '/events/lark',
    })));
  });

  it('saves OpenClaw install daemon choice from the Store-native final step', async () => {
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [],
        model_providers: [],
        channels: [],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        defaults: { config_action: 'update', install_daemon: true },
      },
    } as any);

    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    fireEvent.click(screen.getByRole('button', { name: storeText.fullConfig }));
    goToStepWithNext('\u68c0\u67e5\u4e0e\u5e94\u7528');
    await waitFor(() => expect(screen.getByLabelText('Install daemon')).toBeChecked());
    fireEvent.click(screen.getByLabelText('Install daemon'));
    expect(screen.getByText('Install daemon: skip')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      install_daemon: false,
    })));
  });

  it('preserves OpenClaw remote defaults when saving without changing mode', async () => {
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [],
        model_providers: [],
        channels: [],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        config_summary: ['gateway.mode: remote'],
        defaults: {
          mode: 'remote',
          remote_url: 'wss://example',
          remote_token: 'tok',
          workspace: 'C:/x',
        },
      },
    } as any);

    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('openclaw'));
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: false,
        codex_installed: false,
        config_exists: true,
      },
    } as any);
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'remote',
      remote_url: 'wss://example',
      remote_token: 'tok',
      workspace: 'C:/x',
    })));
  });

  it('resets selected OpenClaw scope before saving configuration', async () => {
    const callOrder: string[] = [];
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: false,
        codex_installed: false,
        config_exists: true,
      },
    } as any);
    vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
      data: {
        auth_providers: [{ id: 'openai', name: 'OpenAI', hint: '', supported: true, methods: [{ id: 'openai', label: 'API Key' }] }],
        model_providers: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'openai/gpt-5.1', name: 'GPT-5.1', available: true }] }],
        channels: [],
        skills: [],
        hooks: [],
        search_providers: [],
        config_exists: true,
        config_summary: ['provider: openai'],
        defaults: { workspace: 'E:/work/openclaw' },
      },
    } as any);
    vi.mocked(systemAPI.configReset).mockImplementation(async () => {
      callOrder.push('reset');
      return { data: { success: true } } as any;
    });
    vi.mocked(systemAPI.onboardConfig).mockImplementation(async () => {
      callOrder.push('save');
      return { data: { success: true } } as any;
    });

    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(within(getAgentCard('OpenClaw')).getByRole('button', { name: storeText.configure }));
    await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('openclaw'));

    fireEvent.click(screen.getByLabelText('Reset'));
    fireEvent.click(screen.getByLabelText('\u4ec5\u914d\u7f6e'));
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    await waitFor(() => expect(systemAPI.configReset).toHaveBeenCalledWith('config', 'E:/work/openclaw'));
    await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalled());
    expect(callOrder).toEqual(['reset', 'save']);
  });

  it('blocks OpenClaw reset save until a reset scope is selected', async () => {
    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('openclaw'));
    fireEvent.click(screen.getByLabelText('Reset'));
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    expect(systemAPI.configReset).not.toHaveBeenCalled();
    expect(systemAPI.onboardConfig).not.toHaveBeenCalled();
    expect(await screen.findByText(/\u8bf7\u9009\u62e9\u91cd\u7f6e\u8303\u56f4/)).toBeTruthy();
  });

  it('keeps existing OpenClaw config without rewriting it', async () => {
    await openStoreConfig('OpenClaw', {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: true,
    });

    await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('openclaw'));
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: false,
        codex_installed: false,
        config_exists: true,
      },
    } as any);
    fireEvent.click(screen.getByLabelText('Keep'));
    fireEvent.click(screen.getByRole('button', { name: storeText.saveConfig }));

    expect(systemAPI.configReset).not.toHaveBeenCalled();
    expect(systemAPI.onboardConfig).not.toHaveBeenCalled();
    expect(await screen.findByText('\u914d\u7f6e\u5df2\u4fdd\u5b58')).toBeTruthy();
    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(2));
  });

  it('filters Agent Store cards by selected install state tab', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: true,
        hermes_installed: false,
        nanobot_installed: true,
        codex_installed: false,
      },
    } as any);
    renderApp();

    const mainPanel = openStore();

    await waitFor(() => expect(within(getAgentCard('OpenClaw')).getByText(storeText.installed)).toBeTruthy());
    const storeTabs = within(mainPanel).getByRole('group', { name: 'Agent Store tabs' });

    for (const agentName of ['OpenClaw', 'Hermes', 'Nanobot', 'Codex']) {
      expect(within(mainPanel).getByRole('heading', { name: agentName })).toBeTruthy();
    }

    fireEvent.click(within(storeTabs).getByRole('button', { name: storeText.installed }));
    expect(within(mainPanel).getByRole('heading', { name: 'OpenClaw' })).toBeTruthy();
    expect(within(mainPanel).getByRole('heading', { name: 'Nanobot' })).toBeTruthy();
    expect(within(mainPanel).queryByRole('heading', { name: 'Hermes' })).toBeNull();
    expect(within(mainPanel).queryByRole('heading', { name: 'Codex' })).toBeNull();

    fireEvent.click(within(storeTabs).getByRole('button', { name: storeText.notInstalled }));
    expect(within(mainPanel).getByRole('heading', { name: 'Hermes' })).toBeTruthy();
    expect(within(mainPanel).getByRole('heading', { name: 'Codex' })).toBeTruthy();
    expect(within(mainPanel).queryByRole('heading', { name: 'OpenClaw' })).toBeNull();
    expect(within(mainPanel).queryByRole('heading', { name: 'Nanobot' })).toBeNull();

    fireEvent.click(within(storeTabs).getByRole('button', { name: storeText.browse }));
    for (const agentName of ['OpenClaw', 'Hermes', 'Nanobot', 'Codex']) {
      expect(within(mainPanel).getByRole('heading', { name: agentName })).toBeTruthy();
    }
  });

  it('overrides unknown Store values with catalog metadata from the backend', async () => {
    vi.mocked(systemAPI.agentStoreCatalog).mockResolvedValueOnce({
      data: {
        agents: [
          { id: 'openclaw', version: '2026.6.9', sizeLabel: '86.6 MB', status: 'ready' },
          { id: 'hermes', version: '0.17.0', sizeLabel: '8.6 MB', status: 'ready' },
          { id: 'nanobot', version: '0.2.2', sizeLabel: '2.6 MB', status: 'ready' },
          { id: 'codex', version: '0.142.0', sizeLabel: '337.7 MB', status: 'ready' },
        ],
        generatedAt: '2026-06-23T00:00:00Z',
        stale: false,
      },
    } as any);
    renderApp();

    const mainPanel = openStore();

    await waitFor(() => expect(within(mainPanel).getByText('86.6 MB')).toBeTruthy());

    for (const catalogValue of ['2026.6.9', '86.6 MB', '0.17.0', '8.6 MB', '0.2.2', '2.6 MB', '0.142.0', '337.7 MB']) {
      expect(within(mainPanel).getByText(catalogValue)).toBeTruthy();
    }
    expect(within(mainPanel).queryByText(storeText.sizeUnknown)).toBeNull();
    expect(within(mainPanel).queryByText(storeText.versionUnknown)).toBeNull();
  });

  it('keeps Store values unknown when the backend catalog request fails', async () => {
    vi.mocked(systemAPI.agentStoreCatalog).mockRejectedValueOnce(new Error('registry offline'));
    renderApp();

    const mainPanel = openStore();

    await waitFor(() => expect(systemAPI.agentStoreCatalog).toHaveBeenCalledTimes(1));
    expect(within(mainPanel).getAllByText(storeText.sizeUnknown)).toHaveLength(4);
    expect(within(mainPanel).getAllByText(storeText.versionUnknown)).toHaveLength(4);
  });

  it('opens an install confirmation dialog with catalog size and OpenClaw permissions', async () => {
    vi.mocked(systemAPI.agentStoreCatalog).mockResolvedValueOnce({
      data: {
        agents: [
          { id: 'openclaw', version: '2026.6.9', sizeLabel: '86.6 MB', status: 'ready' },
        ],
        generatedAt: '2026-06-23T00:00:00Z',
        stale: false,
      },
    } as any);
    renderApp();
    openStore();

    await waitFor(() => expect(screen.getByText('86.6 MB')).toBeTruthy());
    clickInstall('OpenClaw');

    const dialog = screen.getByRole('dialog', { name: /安装 OpenClaw/ });
    expect(within(dialog).getByRole('heading', { name: /安装 OpenClaw/ })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'OpenClaw' })).toBeTruthy();
    expect(within(dialog).getByText(storeText.downloadSize)).toBeTruthy();
    expect(within(dialog).getByText('86.6 MB')).toBeTruthy();
    expect(within(dialog).getByText(storeText.currentDevice)).toBeTruthy();
    expect(within(dialog).getByText(storeText.canInstall)).toBeTruthy();
    expect(within(dialog).getByText(storeText.possibleUse)).toBeTruthy();
    for (const permission of ['网络访问', '工作目录', '本地命令执行']) {
      expect(within(dialog).getByText(permission)).toBeTruthy();
    }

    expect(within(dialog).getByRole('button', { name: storeText.startInstall })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /安装 OpenClaw/ })).toBeTruthy();
    expect(systemAPI.agentStoreCatalog).toHaveBeenCalledTimes(1);
  });

  it('uses unknown size in the install dialog when catalog size is unavailable', async () => {
    vi.mocked(systemAPI.agentStoreCatalog).mockRejectedValueOnce(new Error('registry offline'));
    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.agentStoreCatalog).toHaveBeenCalledTimes(1));
    clickInstall('OpenClaw');

    const dialog = screen.getByRole('dialog', { name: /安装 OpenClaw/ });
    expect(within(dialog).getByText(storeText.sizeUnknown)).toBeTruthy();
  });

  it('switches install dialog permissions for each agent', async () => {
    renderApp();
    openStore();

    clickInstall('Hermes');
    let dialog = screen.getByRole('dialog', { name: /安装 Hermes/ });
    expect(within(dialog).getByRole('heading', { name: 'Hermes' })).toBeTruthy();
    for (const permission of ['网络访问', '终端执行', '消息网关']) {
      expect(within(dialog).getByText(permission)).toBeTruthy();
    }
    fireEvent.click(within(dialog).getByLabelText('关闭安装弹窗'));

    clickInstall('Nanobot');
    dialog = screen.getByRole('dialog', { name: /安装 Nanobot/ });
    for (const permission of ['网络访问', '工作目录', '后台网关']) {
      expect(within(dialog).getByText(permission)).toBeTruthy();
    }
    fireEvent.click(within(dialog).getByLabelText('关闭安装弹窗'));

    clickInstall('Codex');
    dialog = screen.getByRole('dialog', { name: /安装 Codex/ });
    for (const permission of ['代码目录', '本地命令执行', '联网需确认']) {
      expect(within(dialog).getByText(permission)).toBeTruthy();
    }
  });

  it('starts the reusable OpenClaw install stream without downloading in tests', async () => {
    const fetchMock = mockSseFetch([
      { type: 'output', text: 'mock openclaw install started' },
      { type: 'done', success: true },
    ]);
    vi.mocked(systemAPI.installStatus)
      .mockRejectedValueOnce(new Error('initial install status unavailable'))
      .mockResolvedValueOnce({
        data: {
          openclaw_installed: true,
          hermes_installed: false,
          nanobot_installed: false,
          codex_installed: false,
        },
      } as any);
    renderApp();
    openStore();

    clickInstall('OpenClaw');
    fireEvent.click(screen.getByRole('button', { name: storeText.startInstall }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/system/agent-store/openclaw/install', { method: 'POST' }));
    expect(systemAPI.agentStoreInstallUrl).toHaveBeenCalledWith('openclaw');
    expect(systemAPI.installUrl).not.toHaveBeenCalled();
    expect(await screen.findByText('mock openclaw install started')).toBeTruthy();
    expect(await screen.findByText(storeText.installComplete)).toBeTruthy();
    expect(systemAPI.installStatus).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Hermes', 'hermes'],
    ['Nanobot', 'nanobot'],
    ['Codex', 'codex'],
  ] as const)('starts the reusable %s install stream without downloading in tests', async (agentName, agentId) => {
    const fetchMock = mockSseFetch([
      { type: 'output', text: `mock ${agentName} install started` },
      { type: 'done', success: true },
    ]);
    renderApp();
    openStore();

    clickInstall(agentName);
    fireEvent.click(screen.getByRole('button', { name: storeText.startInstall }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/system/agent-store/${agentId}/install`, { method: 'POST' }));
    expect(systemAPI.agentStoreInstallUrl).toHaveBeenCalledWith(agentId);
    expect(systemAPI.installHermesUrl).not.toHaveBeenCalled();
    expect(systemAPI.nanobotInstallUrl).not.toHaveBeenCalled();
    expect(await screen.findByText(`mock ${agentName} install started`)).toBeTruthy();
    expect(await screen.findByText(storeText.installComplete)).toBeTruthy();
  });

  it('marks Codex installed after the Codex install stream succeeds', async () => {
    const fetchMock = mockSseFetch([
      { type: 'output', text: 'mock Codex install started' },
      { type: 'done', success: true },
    ]);
    vi.mocked(systemAPI.installStatus)
      .mockResolvedValueOnce({
        data: {
          openclaw_installed: false,
          hermes_installed: false,
          nanobot_installed: false,
          codex_installed: false,
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          openclaw_installed: false,
          hermes_installed: false,
          nanobot_installed: false,
          codex_installed: true,
        },
      } as any);
    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    expect(within(getAgentCard('Codex')).getByText(storeText.notInstalled)).toBeTruthy();

    clickInstall('Codex');
    fireEvent.click(screen.getByRole('button', { name: storeText.startInstall }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/system/agent-store/codex/install', { method: 'POST' }));
    expect(systemAPI.agentStoreInstallUrl).toHaveBeenCalledWith('codex');
    expect(await screen.findByText('mock Codex install started')).toBeTruthy();
    expect(await screen.findByText(storeText.installComplete)).toBeTruthy();
    await waitFor(() => expect(within(getAgentCard('Codex')).getByText(storeText.installed)).toBeTruthy());
  });

  it('keeps Codex uninstalled when the Codex install stream fails', async () => {
    const fetchMock = mockSseFetch([
      { type: 'output', text: 'mock Codex install failed' },
      { type: 'done', success: false, exit_code: 9 },
    ]);
    vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
      data: {
        openclaw_installed: false,
        hermes_installed: false,
        nanobot_installed: false,
        codex_installed: false,
      },
    } as any);
    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
    clickInstall('Codex');
    fireEvent.click(screen.getByRole('button', { name: storeText.startInstall }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/system/agent-store/codex/install', { method: 'POST' }));
    expect(systemAPI.agentStoreInstallUrl).toHaveBeenCalledWith('codex');
    expect(await screen.findByText('mock Codex install failed')).toBeTruthy();
    expect(await screen.findByText(`${storeText.installFailed} (9)`)).toBeTruthy();
    expect(within(getAgentCard('Codex')).getByText(storeText.notInstalled)).toBeTruthy();
    expect(systemAPI.installStatus).toHaveBeenCalledTimes(1);
  });

  it('closes the install dialog from cancel, close button, Escape, and backdrop', () => {
    renderApp();
    openStore();

    clickInstall('OpenClaw');
    fireEvent.click(within(screen.getByRole('dialog', { name: /安装 OpenClaw/ })).getByRole('button', { name: storeText.cancel }));
    expect(screen.queryByRole('dialog', { name: /安装 OpenClaw/ })).toBeNull();

    clickInstall('Hermes');
    fireEvent.click(within(screen.getByRole('dialog', { name: /安装 Hermes/ })).getByLabelText('关闭安装弹窗'));
    expect(screen.queryByRole('dialog', { name: /安装 Hermes/ })).toBeNull();

    clickInstall('Nanobot');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /安装 Nanobot/ })).toBeNull();

    clickInstall('Codex');
    fireEvent.click(screen.getByLabelText('关闭安装弹窗'));
    expect(screen.queryByRole('dialog', { name: /安装 Codex/ })).toBeNull();
  });
});
