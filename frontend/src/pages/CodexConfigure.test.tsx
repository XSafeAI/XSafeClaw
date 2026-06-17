import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { assetsAPI, systemAPI } from '../services/api';
import CodexConfigure, { CODEX_CONFIG_STORAGE_KEY } from './CodexConfigure';

vi.mock('../services/api', () => ({
  assetsAPI: {
    browseDirectories: vi.fn(),
  },
  systemAPI: {
    getCodexAuthStatus: vi.fn(),
    getCodexRuntimeStatus: vi.fn(),
    loginCodexAuth: vi.fn(),
    logoutCodexAuth: vi.fn(),
  },
}));

function renderCodexConfigure() {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <CodexConfigure />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('CodexConfigure', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('xsafeclaw:locale', 'en');
    vi.mocked(systemAPI.getCodexAuthStatus).mockReset();
    vi.mocked(systemAPI.getCodexRuntimeStatus).mockReset();
    vi.mocked(systemAPI.loginCodexAuth).mockReset();
    vi.mocked(systemAPI.logoutCodexAuth).mockReset();
    vi.mocked(assetsAPI.browseDirectories).mockReset();
    vi.mocked(systemAPI.getCodexAuthStatus).mockResolvedValue({
      data: {
        installed: true,
        logged_in: false,
        auth_mode: null,
        status: 'logged_out',
        codex_path: 'codex',
        message: 'Not logged in',
        error: null,
      },
    } as any);
    vi.mocked(systemAPI.getCodexRuntimeStatus).mockResolvedValue({
      data: {
        installed: true,
        configured: true,
        status: 'ready',
        version: '0.139.0',
        path: 'C:\\Tools\\codex.exe',
        entry_path: 'C:\\Users\\heng\\AppData\\Roaming\\npm\\codex.cmd',
        install_context: 'npm',
        warnings: [],
        error: null,
      },
    } as any);
    vi.mocked(assetsAPI.browseDirectories).mockResolvedValue({
      data: {
        current_path: 'E:\\Projects',
        parent_path: 'E:\\',
        root_path: 'E:\\',
        entries: [
          { name: 'Demo', path: 'E:\\Projects\\Demo', is_hidden: false },
        ],
      },
    } as any);
  });

  it('renders the required Codex-only configuration sections', () => {
    renderCodexConfigure();

    expect(screen.getByRole('heading', { name: 'Configure Codex' })).toBeTruthy();
    expect(screen.getByText('ChatGPT account')).toBeTruthy();
    expect(screen.getByText('Runtime environment')).toBeTruthy();
    expect(screen.getByText('Workspace directory')).toBeTruthy();
    expect(screen.getByText('Default permission mode')).toBeTruthy();
    expect(screen.getByText('New session defaults')).toBeTruthy();
    expect(screen.getByLabelText('Default workspace directory')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Restore default' })).toBeNull();
    expect(screen.queryByText('0.14.0')).toBeNull();
    expect(screen.queryByText('API Key')).toBeNull();
    expect(screen.queryByText('Provider')).toBeNull();
  });

  it('loads Codex runtime status from backend diagnostics', async () => {
    renderCodexConfigure();

    expect(systemAPI.getCodexRuntimeStatus).toHaveBeenCalledWith();
    expect(await screen.findByText('0.139.0')).toBeTruthy();
    expect(screen.getByText('C:\\Tools\\codex.exe')).toBeTruthy();
    expect(screen.queryByText(/PATH entry:/)).toBeNull();
    expect(screen.queryByText(/Install context:/)).toBeNull();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.queryByText('Codex CLI detection is shown as frontend mock data until the backend integration lands.')).toBeNull();
  });

  it('refreshes Codex runtime status with the refresh flag', async () => {
    renderCodexConfigure();
    await screen.findByText('0.139.0');

    vi.mocked(systemAPI.getCodexRuntimeStatus).mockResolvedValueOnce({
      data: {
        installed: true,
        configured: true,
        status: 'warning',
        version: '0.140.0',
        path: 'C:\\Tools\\codex.exe',
        entry_path: 'C:\\Tools\\codex.exe',
        install_context: null,
        warnings: ['updates: update check unavailable'],
        error: null,
      },
    } as any);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh detection' }));

    await waitFor(() => expect(systemAPI.getCodexRuntimeStatus).toHaveBeenCalledWith(true));
    expect(await screen.findByText('0.140.0')).toBeTruthy();
    expect(screen.getByText('Warning')).toBeTruthy();
    expect(screen.getByText('updates: update check unavailable')).toBeTruthy();
  });

  it('shows missing Codex runtime status without blocking local settings', async () => {
    vi.mocked(systemAPI.getCodexRuntimeStatus).mockResolvedValueOnce({
      data: {
        installed: false,
        configured: false,
        status: 'missing',
        version: null,
        path: null,
        entry_path: null,
        install_context: null,
        warnings: [],
        error: 'codex executable not found',
      },
    } as any);

    renderCodexConfigure();

    expect(await screen.findByText('Not detected')).toBeTruthy();
    expect(screen.getByText('codex executable not found')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Default workspace directory'), {
      target: { value: 'E:\\Projects\\StillLocal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(JSON.parse(window.localStorage.getItem(CODEX_CONFIG_STORAGE_KEY) ?? '{}')).toMatchObject({
      workspaceDir: 'E:\\Projects\\StillLocal',
    });
  });

  it('loads Codex CLI auth status and toggles login/logout through backend actions', async () => {
    renderCodexConfigure();

    expect(await screen.findByText('Not signed in')).toBeTruthy();
    expect(systemAPI.getCodexAuthStatus).toHaveBeenCalledTimes(1);

    vi.mocked(systemAPI.loginCodexAuth).mockResolvedValueOnce({
      data: {
        installed: true,
        logged_in: true,
        auth_mode: 'chatgpt',
        status: 'logged_in',
        codex_path: 'codex',
        message: 'Logged in using ChatGPT',
        error: null,
      },
    } as any);
    fireEvent.click(screen.getByRole('button', { name: 'Log in to ChatGPT' }));

    await waitFor(() => expect(systemAPI.loginCodexAuth).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Signed in')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Re-login' })).toBeNull();

    vi.mocked(systemAPI.logoutCodexAuth).mockResolvedValueOnce({
      data: {
        installed: true,
        logged_in: false,
        auth_mode: null,
        status: 'logged_out',
        codex_path: 'codex',
        message: 'Not logged in',
        error: null,
      },
    } as any);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(systemAPI.logoutCodexAuth).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Not signed in')).toBeTruthy();
  });

  it('saves local configuration and restores it on remount', async () => {
    const { unmount } = renderCodexConfigure();
    await screen.findByText('Not signed in');

    fireEvent.click(screen.getByRole('button', { name: 'Manual path' }));
    fireEvent.change(screen.getByLabelText('Default workspace directory'), {
      target: { value: 'E:\\Projects\\Demo' },
    });
    fireEvent.change(screen.getByLabelText('Codex CLI path'), {
      target: { value: 'C:\\Tools\\codex.exe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Full access' }));
    fireEvent.change(screen.getByLabelText('Default model'), {
      target: { value: 'GPT-5.4-Mini' },
    });
    fireEvent.change(screen.getByLabelText('Default reasoning'), {
      target: { value: 'high' },
    });
    fireEvent.change(screen.getByLabelText('Default speed'), {
      target: { value: 'fast' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(JSON.parse(window.localStorage.getItem(CODEX_CONFIG_STORAGE_KEY) ?? '{}')).toMatchObject({
      workspaceDir: 'E:\\Projects\\Demo',
      cliPathMode: 'manual',
      cliPath: 'C:\\Tools\\codex.exe',
      permissionMode: 'full_access',
      defaultModel: 'GPT-5.4-Mini',
      defaultReasoning: 'high',
      defaultSpeed: 'fast',
    });
    expect(screen.getByText('Codex configuration saved locally.')).toBeTruthy();

    unmount();
    renderCodexConfigure();

    expect(screen.getByLabelText('Default workspace directory')).toHaveValue('E:\\Projects\\Demo');
    expect(screen.getByLabelText('Codex CLI path')).toHaveValue('C:\\Tools\\codex.exe');
    expect(screen.getByRole('button', { name: 'Full access' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Default model')).toHaveValue('GPT-5.4-Mini');
    expect(screen.getByLabelText('Default reasoning')).toHaveValue('high');
    expect(screen.getByLabelText('Default speed')).toHaveValue('fast');
  });

  it('shows backend auth errors without blocking local configuration saves', async () => {
    vi.mocked(systemAPI.getCodexAuthStatus).mockRejectedValueOnce({
      response: { data: { detail: 'codex executable not found' } },
    });

    renderCodexConfigure();

    expect(await screen.findByText('codex executable not found')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Default workspace directory'), {
      target: { value: 'E:\\Projects\\StillLocal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(JSON.parse(window.localStorage.getItem(CODEX_CONFIG_STORAGE_KEY) ?? '{}')).toMatchObject({
      workspaceDir: 'E:\\Projects\\StillLocal',
    });
    expect(screen.getByText('Codex configuration saved locally.')).toBeTruthy();
  });

  it('selects a workspace directory with the visual folder picker', async () => {
    renderCodexConfigure();
    await screen.findByText('Not signed in');

    fireEvent.click(screen.getByRole('button', { name: 'Browse folders' }));

    await waitFor(() => expect(assetsAPI.browseDirectories).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText('Select workspace directory')).toBeTruthy();
    expect(screen.getByText('Demo')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }));

    expect(screen.getByLabelText('Default workspace directory')).toHaveValue('E:\\Projects');
  });

  it('migrates the old implicit workspace default to an empty value', async () => {
    window.localStorage.setItem(CODEX_CONFIG_STORAGE_KEY, JSON.stringify({
      workspaceDir: '~/workspace',
    }));

    renderCodexConfigure();
    await screen.findByText('Not signed in');

    expect(screen.getByLabelText('Default workspace directory')).toHaveValue('');
  });
});
