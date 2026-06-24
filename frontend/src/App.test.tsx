import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { I18nProvider } from './i18n';
import { systemAPI } from './services/api';

vi.mock('./services/api', () => ({
  systemAPI: {
    agentStoreCatalog: vi.fn(),
  },
}));

const storeText = {
  subtitle: '\u53d1\u73b0\u3001\u5b89\u88c5\u5e76\u7ba1\u7406\u53ef\u7531 XSafeClaw \u76d1\u63a7\u7684 Agent',
  browse: '\u6d4f\u89c8',
  installed: '\u5df2\u5b89\u88c5',
  updates: '\u66f4\u65b0',
  search: '\u641c\u7d22 Agent',
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
};

function renderApp() {
  window.history.pushState({}, '', '/');

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
  const heading = screen.getByRole('heading', { name: agentName });
  const card = heading.closest('article');
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

function clickInstall(agentName: string) {
  fireEvent.click(within(getAgentCard(agentName)).getByRole('button', { name: storeText.install }));
}

describe('XSafeClaw desktop home screen', () => {
  beforeEach(() => {
    vi.mocked(systemAPI.agentStoreCatalog).mockReset();
    vi.mocked(systemAPI.agentStoreCatalog).mockRejectedValue(new Error('catalog unavailable'));
  });

  it('renders only Monitor, Store, and Setting in the primary sidebar cards', () => {
    renderApp();

    const primaryNav = screen.getByLabelText('Primary navigation');
    const navButtons = within(primaryNav).getAllByRole('button');

    expect(navButtons).toHaveLength(3);
    expect(within(primaryNav).getByRole('button', { name: 'Monitor' })).toBeTruthy();
    expect(within(primaryNav).getByRole('button', { name: 'Store' })).toBeTruthy();
    expect(within(primaryNav).getByRole('button', { name: 'Setting' })).toBeTruthy();

    expect(within(primaryNav).queryByRole('button', { name: /新建任务|助理|项目|专家|自动化|更多/u })).toBeNull();
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
    expect(within(mainPanel).getByRole('button', { name: storeText.updates })).toBeTruthy();
    expect(within(mainPanel).getByPlaceholderText(storeText.search)).toBeTruthy();

    for (const agentName of ['OpenClaw', 'Hermes', 'Nanobot', 'Codex']) {
      expect(within(mainPanel).getByRole('heading', { name: agentName })).toBeTruthy();
      const card = getAgentCard(agentName);
      expect(within(card).getByText('0')).toBeTruthy();
      expect(within(card).getByText('0.0')).toBeTruthy();
    }

    expect(within(mainPanel).getAllByRole('button', { name: storeText.details })).toHaveLength(4);
    expect(within(mainPanel).getAllByRole('button', { name: storeText.install })).toHaveLength(4);
    expect(within(mainPanel).getAllByText(storeText.sizeUnknown)).toHaveLength(4);
    expect(within(mainPanel).getAllByText(storeText.versionUnknown)).toHaveLength(4);

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

    const dialog = screen.getByRole('dialog', { name: '安装 OpenClaw' });
    expect(within(dialog).getByRole('heading', { name: '安装 OpenClaw' })).toBeTruthy();
    expect(within(dialog).getByText('即将下载并安装 OpenClaw。')).toBeTruthy();
    expect(within(dialog).getByText(storeText.downloadSize)).toBeTruthy();
    expect(within(dialog).getByText('86.6 MB')).toBeTruthy();
    expect(within(dialog).getByText(storeText.currentDevice)).toBeTruthy();
    expect(within(dialog).getByText(storeText.canInstall)).toBeTruthy();
    expect(within(dialog).getByText(storeText.possibleUse)).toBeTruthy();
    for (const permission of ['网络访问', '工作目录', '本地命令执行']) {
      expect(within(dialog).getByText(permission)).toBeTruthy();
    }

    fireEvent.click(within(dialog).getByRole('button', { name: storeText.startInstall }));
    expect(screen.getByRole('dialog', { name: '安装 OpenClaw' })).toBeTruthy();
    expect(systemAPI.agentStoreCatalog).toHaveBeenCalledTimes(1);
  });

  it('uses unknown size in the install dialog when catalog size is unavailable', async () => {
    vi.mocked(systemAPI.agentStoreCatalog).mockRejectedValueOnce(new Error('registry offline'));
    renderApp();
    openStore();

    await waitFor(() => expect(systemAPI.agentStoreCatalog).toHaveBeenCalledTimes(1));
    clickInstall('OpenClaw');

    const dialog = screen.getByRole('dialog', { name: '安装 OpenClaw' });
    expect(within(dialog).getByText(storeText.sizeUnknown)).toBeTruthy();
  });

  it('switches install dialog permissions for each agent', async () => {
    renderApp();
    openStore();

    clickInstall('Hermes');
    let dialog = screen.getByRole('dialog', { name: '安装 Hermes' });
    expect(within(dialog).getByText('即将下载并安装 Hermes。')).toBeTruthy();
    for (const permission of ['网络访问', '终端执行', '消息网关']) {
      expect(within(dialog).getByText(permission)).toBeTruthy();
    }
    fireEvent.click(within(dialog).getByLabelText('关闭安装弹窗'));

    clickInstall('Nanobot');
    dialog = screen.getByRole('dialog', { name: '安装 Nanobot' });
    for (const permission of ['网络访问', '工作目录', '后台网关']) {
      expect(within(dialog).getByText(permission)).toBeTruthy();
    }
    fireEvent.click(within(dialog).getByLabelText('关闭安装弹窗'));

    clickInstall('Codex');
    dialog = screen.getByRole('dialog', { name: '安装 Codex' });
    for (const permission of ['代码目录', '本地命令执行', '联网需确认']) {
      expect(within(dialog).getByText(permission)).toBeTruthy();
    }
  });

  it('closes the install dialog from cancel, close button, Escape, and backdrop', () => {
    renderApp();
    openStore();

    clickInstall('OpenClaw');
    fireEvent.click(within(screen.getByRole('dialog', { name: '安装 OpenClaw' })).getByRole('button', { name: storeText.cancel }));
    expect(screen.queryByRole('dialog', { name: '安装 OpenClaw' })).toBeNull();

    clickInstall('Hermes');
    fireEvent.click(within(screen.getByRole('dialog', { name: '安装 Hermes' })).getByLabelText('关闭安装弹窗'));
    expect(screen.queryByRole('dialog', { name: '安装 Hermes' })).toBeNull();

    clickInstall('Nanobot');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '安装 Nanobot' })).toBeNull();

    clickInstall('Codex');
    fireEvent.click(screen.getByLabelText('关闭安装确认遮罩'));
    expect(screen.queryByRole('dialog', { name: '安装 Codex' })).toBeNull();
  });
});
