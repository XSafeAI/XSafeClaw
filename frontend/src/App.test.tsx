import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { I18nProvider } from './i18n';

function renderApp() {
  window.history.pushState({}, '', '/');

  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe('XSafeClaw desktop home screen', () => {
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

  it('switches the right-side placeholder card when a sidebar card is clicked', () => {
    renderApp();

    const mainPanel = screen.getByLabelText('XSafeClaw workspace');
    const primaryNav = screen.getByLabelText('Primary navigation');

    expect(within(mainPanel).getByRole('heading', { name: 'Monitor' })).toBeTruthy();
    expect(within(mainPanel).getByText('Monitor placeholder')).toBeTruthy();

    fireEvent.click(within(primaryNav).getByRole('button', { name: 'Store' }));
    expect(within(mainPanel).getByRole('heading', { name: 'Store' })).toBeTruthy();
    expect(within(mainPanel).getByText('Store placeholder')).toBeTruthy();

    fireEvent.click(within(primaryNav).getByRole('button', { name: 'Setting' }));
    expect(within(mainPanel).getByRole('heading', { name: 'Setting' })).toBeTruthy();
    expect(within(mainPanel).getByText('Setting placeholder')).toBeTruthy();
  });
});
