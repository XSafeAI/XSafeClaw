import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { systemAPI } from '../services/api';
import Setup from './Setup';

vi.mock('../services/api', () => ({
  systemAPI: {
    installStatus: vi.fn(),
  },
}));

function renderSetup() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/setup']}>
        <Setup />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('Setup agent cards', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('xsafeclaw:locale', 'en');
    vi.mocked(systemAPI.installStatus).mockReset();
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: false,
        openclaw_version: null,
        openclaw_path: null,
        hermes_installed: false,
        nanobot_installed: false,
        nanobot_version: null,
        nanobot_path: null,
        nanobot_config_exists: false,
        nanobot_model_configured: false,
        codex_installed: false,
        codex_version: null,
        codex_path: null,
        codex_configured: false,
        config_exists: false,
        requires_setup: true,
        requires_configure: true,
        requires_nanobot_setup: true,
        requires_nanobot_configure: true,
        node_version: '',
      },
    } as any);
  });

  it('shows Codex CLI, OpenClaw, and Hermes in order while hiding Nanobot', async () => {
    renderSetup();

    const codex = await screen.findByRole('heading', { name: 'Codex CLI' });
    const openclaw = screen.getByRole('heading', { name: 'OpenClaw' });
    const hermes = screen.getByRole('heading', { name: 'Hermes Agent' });

    expect(screen.queryByRole('heading', { name: 'Nanobot' })).toBeNull();
    expect(codex.compareDocumentPosition(openclaw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(openclaw.compareDocumentPosition(hermes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await waitFor(() => {
      expect(systemAPI.installStatus).toHaveBeenCalledTimes(1);
    });
  });
});
