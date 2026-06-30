import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import Setup from '../src/pages/Setup.tsx';
import { I18nProvider } from '../src/i18n';
import { systemAPI } from '../src/services/api';

vi.mock('../src/services/api', () => ({
  systemAPI: {
    installStatus: vi.fn(),
    codexInstallUrl: vi.fn(() => '/api/system/codex/install'),
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-path" hidden>{location.pathname}</span>;
}

function renderSetup() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/setup']}>
        <Setup />
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('Setup Codex card', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.setItem('xsafeclaw:locale', 'en');
    vi.mocked(systemAPI.installStatus).mockReset();
    vi.mocked(systemAPI.codexInstallUrl).mockReset();
    vi.mocked(systemAPI.codexInstallUrl).mockReturnValue('/api/system/codex/install');
  });

  test('shows installed Codex CLI with the same shortcut actions as installed runtimes', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        nanobot_installed: false,
        hermes_installed: false,
        codex_installed: true,
        codex_configured: true,
        codex_status: 'ready',
        codex_version: '0.139.0',
      },
    });

    renderSetup();

    expect(await screen.findByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('v0.139.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter Town' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter Backend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install Codex' })).not.toBeInTheDocument();
  });

  test('routes the installed Codex card configure action to the Codex configure page', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        nanobot_installed: false,
        hermes_installed: false,
        codex_installed: true,
        codex_configured: true,
        codex_status: 'ready',
        codex_version: '0.139.0',
      },
    });

    renderSetup();

    expect(await screen.findByText('Codex CLI')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Configure' }));

    expect(screen.getByTestId('location-path').textContent).toBe('/codex_configure');
  });

  test('shows an Install Codex button when the CLI is missing', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        nanobot_installed: false,
        hermes_installed: false,
        codex_installed: false,
      },
    });

    renderSetup();

    expect(await screen.findByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Install Codex/ })).toBeInTheDocument();
    expect(screen.queryByText(/Backend detection and setup will be connected later/i)).not.toBeInTheDocument();
  });

  test('runs the Codex CLI installer stream instead of opening external docs', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        nanobot_installed: false,
        hermes_installed: false,
        codex_installed: false,
      },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"output","text":"Installing Codex CLI"}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"type":"done","success":true,"version":"0.139.0"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: stream,
    });

    renderSetup();

    fireEvent.click(await screen.findByRole('button', { name: /Install Codex/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/system/codex/install', { method: 'POST' });
    });
    expect(openSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('Installing Codex CLI')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location-path').textContent).toBe('/codex_configure');
    }, { timeout: 2000 });
  });
});
