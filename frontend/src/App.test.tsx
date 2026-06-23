import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { I18nProvider } from './i18n';

const text = {
  edit: '\u7f16\u8f91(E)',
  window: '\u7a97\u53e3(W)',
  help: '\u5e2e\u52a9(H)',
  subtitle: '\u4f60\u7684\u804c\u573a\u8d85\u80fd\u529b',
  newTask: '\u65b0\u5efa\u4efb\u52a1',
  assistant: '\u52a9\u7406',
  project: '\u9879\u76ee',
  expert: '\u4e13\u5bb6',
  automation: '\u81ea\u52a8\u5316',
  more: '\u66f4\u591a',
  guide: '\u9879\u76ee\u65b0\u624b\u6307\u5f15',
  office: '\u65e5\u5e38\u529e\u516c',
  code: '\u4ee3\u7801\u5f00\u53d1',
  design: '\u8bbe\u8ba1\u521b\u610f',
  docs: '\u6587\u6863\u5904\u7406',
  finance: '\u91d1\u878d\u670d\u52a1',
  helpMe: '\u9ad8\u624b\u5e2e\u5e2e\u4f60',
  prompt: '\u4eca\u5929\u5e2e\u4f60\u505a\u4e9b\u4ec0\u4e48\uff1f @ \u5f15\u7528\u5bf9\u8bdd\u6587\u4ef6\uff0c/ \u8c03\u7528\u6280\u80fd\u4e0e\u6307\u4ee4',
};

function renderApp() {
  window.history.pushState({}, '', '/');

  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe('XSafeClaw desktop home screen', () => {
  it('renders the WorkBuddy-style static desktop shell', () => {
    renderApp();

    expect(screen.getAllByText('XSafeClaw').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(text.edit)).toBeTruthy();
    expect(screen.getByText(text.window)).toBeTruthy();
    expect(screen.getByText(text.help)).toBeTruthy();
    expect(screen.getByText(text.subtitle)).toBeTruthy();
    expect(screen.getByText(text.newTask)).toBeTruthy();
    expect(screen.getByText(text.assistant)).toBeTruthy();
    expect(screen.getByText(text.project)).toBeTruthy();
    expect(screen.getByText(text.expert)).toBeTruthy();
    expect(screen.getByText(text.automation)).toBeTruthy();
    expect(screen.getAllByText(text.more).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(text.guide)).toBeTruthy();
    expect(screen.getByText(text.office)).toBeTruthy();
    expect(screen.getByText(text.code)).toBeTruthy();
    expect(screen.getByText(text.design)).toBeTruthy();
    expect(screen.getByText(text.docs)).toBeTruthy();
    expect(screen.getByText(text.finance)).toBeTruthy();
    expect(screen.getByText(text.helpMe)).toBeTruthy();
    expect(screen.getByPlaceholderText(text.prompt)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'XSafeClaw assistant mascot' })).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(2);
    expect(screen.queryByRole('button', { name: 'Monitor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Store' })).toBeNull();
  });
});
