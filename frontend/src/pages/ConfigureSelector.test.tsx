import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { systemAPI } from '../services/api';
import ConfigureSelector from './ConfigureSelector';

vi.mock('../services/api', () => ({
  systemAPI: {
    installStatus: vi.fn(),
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-path" hidden>{location.pathname}</span>;
}

function renderConfigureSelector() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/configure_select']}>
        <ConfigureSelector />
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('ConfigureSelector Codex entry', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('xsafeclaw:locale', 'en');
    vi.mocked(systemAPI.installStatus).mockReset();
  });

  it('shows Codex alongside other runtimes and routes installed Codex to its configure page', async () => {
    vi.mocked(systemAPI.installStatus).mockResolvedValue({
      data: {
        openclaw_installed: true,
        hermes_installed: true,
        nanobot_installed: true,
        codex_installed: true,
        config_exists: true,
        codex_configured: false,
      },
    } as any);

    renderConfigureSelector();

    const codexCardTitle = await screen.findByText('Codex Configure');
    const codexCard = codexCardTitle.closest('button') as HTMLElement;
    expect(codexCard).toBeTruthy();
    expect(codexCard).toHaveTextContent('Needs config');

    fireEvent.click(codexCard);

    await waitFor(() => {
      expect(screen.getByTestId('location-path').textContent).toBe('/codex_configure');
    });
  });
});
