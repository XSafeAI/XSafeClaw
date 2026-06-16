import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { systemAPI } from '../services/api';
import CodexConfigure, { CODEX_CONFIG_STORAGE_KEY } from './CodexConfigure';

vi.mock('../services/api', () => ({
  systemAPI: {
    getCodexAuthStatus: vi.fn(),
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
    vi.mocked(systemAPI.loginCodexAuth).mockReset();
    vi.mocked(systemAPI.logoutCodexAuth).mockReset();
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
  });

  it('renders the required Codex-only configuration sections', () => {
    renderCodexConfigure();

    expect(screen.getByRole('heading', { name: 'Configure Codex' })).toBeTruthy();
    expect(screen.getByText('ChatGPT account')).toBeTruthy();
    expect(screen.getByText('Runtime environment')).toBeTruthy();
    expect(screen.getByText('Default workspace')).toBeTruthy();
    expect(screen.getByText('Default permission mode')).toBeTruthy();
    expect(screen.getByText('New session defaults')).toBeTruthy();
    expect(screen.queryByText('API Key')).toBeNull();
    expect(screen.queryByText('Provider')).toBeNull();
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
});
