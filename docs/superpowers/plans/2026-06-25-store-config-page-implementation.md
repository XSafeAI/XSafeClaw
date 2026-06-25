# Store-Native Agent Configuration Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace old-route configuration entry with a Store-native configuration detail page for OpenClaw, Hermes, and Nanobot, with Quick configuration and Full configuration modes, while reusing existing backend APIs.

**Architecture:** Keep the Store page as the owner of Agent selection and install/config state. Add a focused `StoreConfigPage` component for the right-side detail view and keep the old configuration pages out of the Store flow. Reuse existing `systemAPI` methods for loading metadata and saving OpenClaw, Hermes, and Nanobot configuration.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, existing `systemAPI` Axios client, lucide-react icons, existing `frontend/src/App.css` visual system.

---

## File Structure

- Modify `frontend/src/App.tsx`
  - Remove the temporary old-page route flow from the Store configuration action.
  - Keep Store card install/config state.
  - Add `configAgentId` state inside `StorePage`.
  - Render the Store card grid or the Store-native config detail page in the right-side main area.

- Create `frontend/src/StoreConfigPage.tsx`
  - Own the Store-native configuration page layout.
  - Render Agent header, Quick/Full mode switch, step navigation, form content, and bottom navigation.
  - Dispatch to OpenClaw, Hermes, or Nanobot field groups based on Agent id.
  - Use existing backend APIs through `systemAPI`.

- Create `frontend/src/storeConfigTypes.ts`
  - Shared types and constants for Agent ids, mode ids, step definitions, default form state, and field labels.
  - Keep this file UI-framework-light so tests and components can import it without pulling large page components.

- Modify `frontend/src/App.css`
  - Add Store-native configuration layout styles.
  - Match Store page light style: white panels, subtle borders, compact tabs, dense form rows.

- Modify `frontend/src/App.test.tsx`
  - Replace tests that assert old route rendering.
  - Add tests for internal Store configuration detail page.
  - Add tests for Quick/Full mode per Agent.
  - Add tests for API calls and error handling.

- Keep `frontend/src/pages/Configure.tsx` and `frontend/src/pages/NanobotConfigure.tsx`
  - Do not delete old pages.
  - Use them as field/API references only.

---

### Task 1: Replace Old Route Entry With Store-Native Detail Entry

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/App.css`
- Create: `frontend/src/StoreConfigPage.tsx`
- Create: `frontend/src/storeConfigTypes.ts`

- [ ] **Step 1: Write failing tests for internal Store config navigation**

In `frontend/src/App.test.tsx`, remove the test that expects `/openclaw_configure`, `/hermes_configure`, and `/nanobot_configure` to render mocked old pages. Replace it with this behavior-focused test:

```tsx
it('opens Store-native configuration detail instead of routing to old configure pages', async () => {
  vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
    data: {
      openclaw_installed: true,
      hermes_installed: true,
      nanobot_installed: true,
      codex_installed: true,
      config_exists: false,
      requires_hermes_configure: true,
      requires_nanobot_configure: true,
    },
  } as any);

  renderApp();
  const mainPanel = openStore();

  await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
  fireEvent.click(within(getAgentCard('OpenClaw')).getByRole('button', { name: storeText.goConfigure }));

  expect(window.location.pathname).toBe('/');
  expect(within(mainPanel).getByRole('heading', { name: /OpenClaw/ })).toBeTruthy();
  expect(within(mainPanel).getByRole('button', { name: 'Agent Store' })).toBeTruthy();
  expect(within(mainPanel).getByRole('button', { name: storeText.quickConfig })).toBeTruthy();
  expect(within(mainPanel).getByRole('button', { name: storeText.fullConfig })).toBeTruthy();
  expect(within(mainPanel).queryByTestId('configure-page')).toBeNull();
  expect(within(mainPanel).queryByTestId('nanobot-configure-page')).toBeNull();
});
```

Extend `storeText` in the test file:

```ts
quickConfig: '\u5feb\u901f\u914d\u7f6e',
fullConfig: '\u5b8c\u5168\u914d\u7f6e',
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: FAIL because Store still routes to old pages or has no Store-native config detail.

- [ ] **Step 3: Create shared config types**

Create `frontend/src/storeConfigTypes.ts`:

```ts
import type { LucideIcon } from 'lucide-react';
import { Bot, Code2, Feather, PawPrint } from 'lucide-react';

export type ConfigurableAgentId = 'openclaw' | 'hermes' | 'nanobot';
export type StoreAgentId = ConfigurableAgentId | 'codex';
export type StoreConfigMode = 'quick' | 'full';

export type StoreConfigStep = {
  id: string;
  label: string;
  quick: boolean;
  full: boolean;
};

export type StoreConfigAgentMeta = {
  id: ConfigurableAgentId;
  name: string;
  tone: 'teal' | 'purple' | 'yellow';
  Icon: LucideIcon;
  steps: StoreConfigStep[];
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
};

export const STORE_CONFIG_AGENTS: Record<ConfigurableAgentId, StoreConfigAgentMeta> = {
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw',
    tone: 'teal',
    Icon: PawPrint,
    steps: [
      { id: 'config', label: '\u914d\u7f6e\u5904\u7406', quick: true, full: true },
      { id: 'model', label: '\u6a21\u578b\u4e0e\u5bc6\u94a5', quick: true, full: true },
      { id: 'runtime', label: '\u8fd0\u884c\u4e0e\u5de5\u4f5c\u533a', quick: false, full: true },
      { id: 'gateway', label: 'Gateway', quick: false, full: true },
      { id: 'integrations', label: '\u96c6\u6210', quick: false, full: true },
      { id: 'tools', label: '\u5de5\u5177', quick: false, full: true },
      { id: 'review', label: '\u68c0\u67e5\u4e0e\u5e94\u7528', quick: true, full: true },
    ],
  },
  hermes: {
    id: 'hermes',
    name: 'Hermes',
    tone: 'purple',
    Icon: Feather,
    steps: [
      { id: 'status', label: '\u72b6\u6001', quick: false, full: true },
      { id: 'api-key', label: 'API Key', quick: true, full: true },
      { id: 'model', label: '\u6a21\u578b', quick: true, full: true },
      { id: 'api-server', label: 'API Server', quick: true, full: true },
      { id: 'bots', label: 'Bot \u5e73\u53f0', quick: false, full: true },
      { id: 'review', label: '\u68c0\u67e5\u4e0e\u5e94\u7528', quick: true, full: true },
    ],
  },
  nanobot: {
    id: 'nanobot',
    name: 'Nanobot',
    tone: 'yellow',
    Icon: Bot,
    steps: [
      { id: 'model', label: '\u6a21\u578b\u4e0e\u5bc6\u94a5', quick: true, full: true },
      { id: 'workspace', label: '\u5de5\u4f5c\u533a', quick: false, full: true },
      { id: 'gateway', label: 'Gateway', quick: false, full: true },
      { id: 'websocket', label: 'WebSocket', quick: false, full: true },
      { id: 'guard', label: 'Guard', quick: false, full: true },
      { id: 'review', label: '\u68c0\u67e5\u4e0e\u5e94\u7528', quick: true, full: true },
    ],
  },
};

export const STORE_AGENT_ICONS = {
  openclaw: PawPrint,
  hermes: Feather,
  nanobot: Bot,
  codex: Code2,
};
```

- [ ] **Step 4: Create a minimal Store-native detail component**

Create `frontend/src/StoreConfigPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import {
  STORE_CONFIG_AGENTS,
  storeConfigText,
  type ConfigurableAgentId,
  type StoreConfigMode,
} from './storeConfigTypes';

type StoreConfigPageProps = {
  agentId: ConfigurableAgentId;
  installed: boolean;
  configured: boolean;
  onBack: () => void;
  onSaved: () => void;
};

export default function StoreConfigPage({
  agentId,
  installed,
  configured,
  onBack,
}: StoreConfigPageProps) {
  const agent = STORE_CONFIG_AGENTS[agentId];
  const AgentIcon = agent.Icon;
  const [mode, setMode] = useState<StoreConfigMode>('quick');
  const visibleSteps = useMemo(
    () => agent.steps.filter((step) => (mode === 'quick' ? step.quick : step.full)),
    [agent.steps, mode],
  );
  const [activeStepId, setActiveStepId] = useState(visibleSteps[0]?.id ?? 'review');
  const activeStep = visibleSteps.find((step) => step.id === activeStepId) ?? visibleSteps[0];

  return (
    <section className="store-config-page" aria-label={`${agent.name} configuration`}>
      <header className="store-config-header">
        <button type="button" className="store-config-back" onClick={onBack}>
          <ChevronLeft size={17} strokeWidth={2} />
          {storeConfigText.backToStore}
        </button>
        <div className="store-config-title-row">
          <div className={`agent-logo agent-logo-${agent.tone}`}>
            <AgentIcon size={36} strokeWidth={2.2} />
          </div>
          <div>
            <h1>{`${agent.name} \u914d\u7f6e`}</h1>
            <div className="store-config-badges">
              <span className={`agent-badge ${installed ? 'installed' : 'not-installed'}`}>
                {installed ? '\u5df2\u5b89\u88c5' : '\u672a\u5b89\u88c5'}
              </span>
              <span className={`agent-badge ${configured ? 'configured' : 'needs-configure'}`}>
                {configured ? '\u5df2\u914d\u7f6e' : '\u5f85\u914d\u7f6e'}
              </span>
            </div>
          </div>
        </div>
        <div className="store-config-mode-switch" role="group" aria-label="Configuration mode">
          <button type="button" className={mode === 'quick' ? 'active' : undefined} onClick={() => setMode('quick')}>
            {storeConfigText.quickConfig}
          </button>
          <button type="button" className={mode === 'full' ? 'active' : undefined} onClick={() => setMode('full')}>
            {storeConfigText.fullConfig}
          </button>
        </div>
      </header>

      <div className="store-config-layout">
        <nav className="store-config-steps" aria-label="Configuration steps">
          {visibleSteps.map((step) => (
            <button
              key={step.id}
              type="button"
              className={step.id === activeStep?.id ? 'active' : undefined}
              onClick={() => setActiveStepId(step.id)}
            >
              {step.label}
            </button>
          ))}
        </nav>
        <div className="store-config-panel">
          <h2>{activeStep?.label}</h2>
          <p className="store-config-muted">{`${agent.name} ${mode === 'quick' ? storeConfigText.quickConfig : storeConfigText.fullConfig}`}</p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Wire StorePage to render the detail component**

In `frontend/src/App.tsx`:

- Remove `BrowserRouter`, `Route`, and `Routes` imports.
- Remove imports for old pages added only for route rendering.
- Import `StoreConfigPage` and `ConfigurableAgentId`.
- Add `configAgentId` state in `StorePage`.
- Change `onConfigure` from `navigate(targetAgent.configureRoute)` to `setConfigAgentId(targetAgent.id as ConfigurableAgentId)`.
- Render `StoreConfigPage` before the grid when `configAgentId` is set.

The resulting StorePage render branch should look like:

```tsx
const configAgent = configAgentId
  ? displayAgents.find((agent) => agent.id === configAgentId)
  : null;

if (configAgentId && configAgent) {
  return (
    <StoreConfigPage
      agentId={configAgentId}
      installed={Boolean(configAgent.installed)}
      configured={configAgent.configStatus === 'configured'}
      onBack={() => setConfigAgentId(null)}
      onSaved={refreshInstallStatus}
    />
  );
}
```

Then keep the existing Store grid render.

The `App` export should return the desktop shell directly:

```tsx
function App() {
  return <DesktopHome />;
}
```

- [ ] **Step 6: Add minimum Store-native config CSS**

Append to `frontend/src/App.css`:

```css
.store-config-page {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 28px 38px 56px;
}

.store-config-header {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 18px;
  align-items: start;
  margin-bottom: 24px;
}

.store-config-back {
  width: fit-content;
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #3d4352;
  border: 1px solid #dfe3ea;
  border-radius: 7px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
}

.store-config-title-row {
  display: flex;
  align-items: center;
  gap: 16px;
  grid-column: 1 / 2;
}

.store-config-title-row h1 {
  margin: 0;
  color: #070b18;
  font-size: 28px;
  line-height: 1.1;
}

.store-config-badges {
  display: flex;
  gap: 8px;
  margin-top: 9px;
}

.store-config-mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid #dfe3ea;
  border-radius: 8px;
  background: #f7f8fa;
  padding: 4px;
}

.store-config-mode-switch button {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: #596070;
}

.store-config-mode-switch button.active {
  color: #0f61ee;
  background: #fff;
  box-shadow: 0 1px 4px rgba(25, 31, 45, 0.08);
}

.store-config-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 22px;
}

.store-config-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.store-config-steps button {
  min-height: 38px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  padding: 0 13px;
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  color: #4a5060;
}

.store-config-steps button.active {
  color: #0f61ee;
  border-color: #d8e6ff;
  background: #eef5ff;
}

.store-config-panel {
  min-height: 420px;
  border: 1px solid #dde1e8;
  border-radius: 12px;
  background: #fff;
  padding: 24px;
}

.store-config-panel h2 {
  margin: 0 0 8px;
  color: #080c18;
  font-size: 22px;
}

.store-config-muted {
  color: #687082;
  font-size: 14px;
}
```

- [ ] **Step 7: Run test to verify Task 1 passes**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: PASS for the new internal navigation test and existing Store tests.

- [ ] **Step 8: Commit Task 1**

Run when commits are desired:

```powershell
git add frontend/src/App.tsx frontend/src/App.css frontend/src/App.test.tsx frontend/src/StoreConfigPage.tsx frontend/src/storeConfigTypes.ts
git commit -m "feat: add store-native config detail shell"
```

---

### Task 2: Add Shared Store-Native Form Components and Mode Step Behavior

**Files:**
- Modify: `frontend/src/StoreConfigPage.tsx`
- Modify: `frontend/src/storeConfigTypes.ts`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write failing tests for Quick/Full mode step behavior**

Add tests to `frontend/src/App.test.tsx`:

```tsx
it.each([
  ['OpenClaw', 'goConfigure', ['\u914d\u7f6e\u5904\u7406', '\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u68c0\u67e5\u4e0e\u5e94\u7528'], ['Gateway', '\u96c6\u6210', '\u5de5\u5177']],
  ['Hermes', 'goConfigure', ['API Key', '\u6a21\u578b', 'API Server', '\u68c0\u67e5\u4e0e\u5e94\u7528'], ['Bot \u5e73\u53f0', '\u72b6\u6001']],
  ['Nanobot', 'goConfigure', ['\u6a21\u578b\u4e0e\u5bc6\u94a5', '\u68c0\u67e5\u4e0e\u5e94\u7528'], ['Gateway', 'WebSocket', 'Guard']],
] as const)('shows quick and full steps for %s', async (agentName, _buttonKind, quickSteps, fullOnlySteps) => {
  vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
    data: {
      openclaw_installed: true,
      hermes_installed: true,
      nanobot_installed: true,
      codex_installed: false,
      config_exists: false,
      requires_hermes_configure: true,
      requires_nanobot_configure: true,
    },
  } as any);

  renderApp();
  const mainPanel = openStore();
  await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));

  fireEvent.click(within(getAgentCard(agentName)).getByRole('button', { name: storeText.goConfigure }));

  for (const label of quickSteps) {
    expect(within(mainPanel).getByRole('button', { name: label })).toBeTruthy();
  }
  for (const label of fullOnlySteps) {
    expect(within(mainPanel).queryByRole('button', { name: label })).toBeNull();
  }

  fireEvent.click(within(mainPanel).getByRole('button', { name: storeText.fullConfig }));

  for (const label of fullOnlySteps) {
    expect(within(mainPanel).getByRole('button', { name: label })).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: FAIL if mode switching does not reset active step or steps are incomplete.

- [ ] **Step 3: Make mode switching reset active step**

In `frontend/src/StoreConfigPage.tsx`, replace direct mode setters with this function:

```tsx
const switchMode = (nextMode: StoreConfigMode) => {
  const nextSteps = agent.steps.filter((step) => (nextMode === 'quick' ? step.quick : step.full));
  setMode(nextMode);
  setActiveStepId(nextSteps[0]?.id ?? 'review');
};
```

Use it in the buttons:

```tsx
onClick={() => switchMode('quick')}
onClick={() => switchMode('full')}
```

- [ ] **Step 4: Add reusable form primitives**

In `frontend/src/StoreConfigPage.tsx`, add local primitives below imports:

```tsx
function ConfigField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="store-config-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ConfigTextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="store-config-input" {...props} />;
}

function ConfigSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="store-config-input" {...props} />;
}
```

- [ ] **Step 5: Add form primitive styles**

Append to `frontend/src/App.css`:

```css
.store-config-form {
  display: grid;
  gap: 16px;
}

.store-config-field {
  display: grid;
  gap: 7px;
}

.store-config-field > span {
  color: #202637;
  font-size: 13px;
  font-weight: 750;
}

.store-config-field small {
  color: #778092;
  font-size: 12px;
  line-height: 1.5;
}

.store-config-input {
  min-height: 38px;
  width: 100%;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #fff;
  padding: 0 11px;
  color: #151a27;
  font: inherit;
  font-size: 14px;
}

.store-config-input:focus {
  outline: 2px solid rgba(15, 97, 238, 0.16);
  border-color: #8eb7ff;
}
```

- [ ] **Step 6: Run test to verify Task 2 passes**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run when commits are desired:

```powershell
git add frontend/src/StoreConfigPage.tsx frontend/src/storeConfigTypes.ts frontend/src/App.css frontend/src/App.test.tsx
git commit -m "feat: add store config modes and form primitives"
```

---

### Task 3: Implement OpenClaw Store-Native Configuration

**Files:**
- Modify: `frontend/src/StoreConfigPage.tsx`
- Modify: `frontend/src/storeConfigTypes.ts`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write failing tests for OpenClaw metadata load and save**

Add test:

```tsx
it('loads and saves OpenClaw quick configuration with existing backend APIs', async () => {
  vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
    data: {
      openclaw_installed: true,
      hermes_installed: false,
      nanobot_installed: false,
      codex_installed: false,
      config_exists: false,
    },
  } as any);
  vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
    data: {
      auth_providers: [
        { id: 'openai', name: 'OpenAI', hint: 'OpenAI API', supported: true, methods: [{ id: 'api-key', label: 'API Key' }] },
      ],
      model_providers: [
        { id: 'openai', name: 'OpenAI', models: [{ id: 'openai/gpt-5.1', name: 'GPT-5.1', contextWindow: 128000, reasoning: true, available: true, input: 'token' }] },
      ],
      defaults: {
        gateway_port: 18789,
        gateway_bind: 'loopback',
        gateway_auth_mode: 'token',
        gateway_token: 'dev-token',
        workspace: 'C:/xsafeclaw/workspace',
      },
      channels: [],
      skills: [],
      hooks: [],
      search_providers: [],
    },
  } as any);
  vi.mocked(systemAPI.onboardConfig).mockResolvedValueOnce({ data: { success: true } } as any);

  renderApp();
  const mainPanel = openStore();
  await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
  fireEvent.click(within(getAgentCard('OpenClaw')).getByRole('button', { name: storeText.goConfigure }));

  await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('openclaw'));
  fireEvent.change(within(mainPanel).getByLabelText('Auth Provider'), { target: { value: 'openai' } });
  fireEvent.change(within(mainPanel).getByLabelText('API Key'), { target: { value: 'sk-test' } });
  fireEvent.change(within(mainPanel).getByLabelText('Model ID'), { target: { value: 'openai/gpt-5.1' } });
  fireEvent.click(within(mainPanel).getByRole('button', { name: storeText.saveConfig }));

  await waitFor(() => expect(systemAPI.onboardConfig).toHaveBeenCalledWith(expect.objectContaining({
    platform: 'openclaw',
    provider: 'api-key',
    api_key: 'sk-test',
    model_id: 'openai/gpt-5.1',
  })));
});
```

Add `onboardScan` and `onboardConfig` to the `systemAPI` mock if missing:

```ts
onboardScan: vi.fn(),
onboardConfig: vi.fn(),
providerHasKey: vi.fn(),
configReset: vi.fn(),
feishuTest: vi.fn(),
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: FAIL because OpenClaw form fields are not implemented.

- [ ] **Step 3: Add OpenClaw form state**

In `frontend/src/storeConfigTypes.ts`, add:

```ts
export type OpenClawStoreConfigForm = {
  configAction: string;
  resetScope: string;
  mode: string;
  remoteUrl: string;
  remoteToken: string;
  workspace: string;
  authProvider: string;
  authMethod: string;
  apiKey: string;
  modelId: string;
  gatewayPort: number;
  gatewayBind: string;
  gatewayAuthMode: string;
  gatewayToken: string;
  tailscaleMode: string;
  channels: string[];
  feishuAppId: string;
  feishuAppSecret: string;
  feishuConnectionMode: string;
  feishuDomain: string;
  feishuGroupPolicy: string;
  feishuGroupAllowFrom: string;
  feishuVerificationToken: string;
  feishuWebhookPath: string;
  searchProvider: string;
  searchApiKey: string;
  selectedSkills: string[];
  hooks: string[];
  installDaemon: boolean;
};

export const defaultOpenClawStoreConfigForm: OpenClawStoreConfigForm = {
  configAction: 'update',
  resetScope: '',
  mode: 'local',
  remoteUrl: '',
  remoteToken: '',
  workspace: '',
  authProvider: '',
  authMethod: '',
  apiKey: '',
  modelId: '',
  gatewayPort: 18789,
  gatewayBind: 'loopback',
  gatewayAuthMode: 'token',
  gatewayToken: '',
  tailscaleMode: 'off',
  channels: [],
  feishuAppId: '',
  feishuAppSecret: '',
  feishuConnectionMode: 'websocket',
  feishuDomain: 'feishu',
  feishuGroupPolicy: 'open',
  feishuGroupAllowFrom: '',
  feishuVerificationToken: '',
  feishuWebhookPath: '/feishu/events',
  searchProvider: '',
  searchApiKey: '',
  selectedSkills: [],
  hooks: [],
  installDaemon: true,
};
```

- [ ] **Step 4: Implement OpenClaw load and save**

In `StoreConfigPage.tsx`, add OpenClaw state and loading effect when `agentId === 'openclaw'`:

```tsx
const [openClawForm, setOpenClawForm] = useState(defaultOpenClawStoreConfigForm);
const [openClawScan, setOpenClawScan] = useState<any>(null);
const [loadError, setLoadError] = useState('');
const [saveError, setSaveError] = useState('');
const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

useEffect(() => {
  if (agentId !== 'openclaw') return;
  let alive = true;
  setLoadError('');
  systemAPI.onboardScan('openclaw')
    .then((res) => {
      if (!alive) return;
      const defaults = res.data?.defaults ?? {};
      setOpenClawScan(res.data);
      setOpenClawForm((prev) => ({
        ...prev,
        gatewayPort: defaults.gateway_port || prev.gatewayPort,
        gatewayBind: defaults.gateway_bind || prev.gatewayBind,
        gatewayAuthMode: defaults.gateway_auth_mode || prev.gatewayAuthMode,
        gatewayToken: defaults.gateway_token || prev.gatewayToken,
        workspace: defaults.workspace || prev.workspace,
        hooks: defaults.enabled_hooks?.length ? defaults.enabled_hooks : prev.hooks,
      }));
    })
    .catch((error) => {
      if (alive) setLoadError(error instanceof Error ? error.message : String(error));
    });
  return () => {
    alive = false;
  };
}, [agentId]);
```

Add save handler:

```tsx
const saveOpenClaw = async () => {
  setSaveError('');
  setSaveState('saving');
  try {
    const selectedProvider = openClawScan?.auth_providers?.find((provider: any) => provider.id === openClawForm.authProvider);
    const provider = openClawForm.authMethod || selectedProvider?.methods?.[0]?.id || openClawForm.authProvider;
    await systemAPI.onboardConfig({
      platform: 'openclaw',
      mode: openClawForm.mode,
      provider,
      api_key: openClawForm.apiKey,
      model_id: openClawForm.modelId,
      gateway_port: openClawForm.gatewayPort,
      gateway_bind: openClawForm.gatewayBind,
      gateway_auth_mode: openClawForm.gatewayAuthMode,
      gateway_token: openClawForm.gatewayToken,
      workspace: openClawForm.workspace,
      install_daemon: openClawForm.installDaemon,
      tailscale_mode: openClawForm.tailscaleMode,
      channels: openClawForm.channels,
      hooks: openClawForm.hooks,
      search_provider: openClawForm.searchProvider,
      search_api_key: openClawForm.searchApiKey,
      remote_url: openClawForm.remoteUrl,
      remote_token: openClawForm.remoteToken,
      selected_skills: openClawForm.selectedSkills,
      feishu_app_id: openClawForm.feishuAppId,
      feishu_app_secret: openClawForm.feishuAppSecret,
      feishu_connection_mode: openClawForm.feishuConnectionMode,
      feishu_domain: openClawForm.feishuDomain,
      feishu_group_policy: openClawForm.feishuGroupPolicy,
      feishu_group_allow_from: openClawForm.feishuGroupAllowFrom.split(',').map((item) => item.trim()).filter(Boolean),
      feishu_verification_token: openClawForm.feishuVerificationToken,
      feishu_webhook_path: openClawForm.feishuWebhookPath,
    });
    setSaveState('saved');
    onSaved();
  } catch (error) {
    setSaveState('idle');
    setSaveError(error instanceof Error ? error.message : String(error));
  }
};
```

- [ ] **Step 5: Render OpenClaw fields**

Add a render branch in `StoreConfigPage.tsx` when `agentId === 'openclaw'`. The model step must include labels exactly used by tests:

```tsx
function renderOpenClawStep() {
  if (activeStep?.id === 'model') {
    const authProviders = openClawScan?.auth_providers ?? [];
    const modelProviders = openClawScan?.model_providers ?? [];
    const selectedProvider = authProviders.find((provider: any) => provider.id === openClawForm.authProvider);
    const models = modelProviders.flatMap((provider: any) => provider.models ?? []);
    return (
      <div className="store-config-form">
        <ConfigField label="Auth Provider">
          <ConfigSelect
            aria-label="Auth Provider"
            value={openClawForm.authProvider}
            onChange={(event) => setOpenClawForm((form) => ({
              ...form,
              authProvider: event.target.value,
              authMethod: '',
              modelId: '',
            }))}
          >
            <option value="">Select provider</option>
            {authProviders.map((provider: any) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </ConfigSelect>
        </ConfigField>
        <ConfigField label="API Key">
          <ConfigTextInput
            aria-label="API Key"
            type="password"
            value={openClawForm.apiKey}
            onChange={(event) => setOpenClawForm((form) => ({ ...form, apiKey: event.target.value }))}
          />
        </ConfigField>
        <ConfigField label="Model ID">
          <ConfigTextInput
            aria-label="Model ID"
            list="openclaw-models"
            value={openClawForm.modelId}
            onChange={(event) => setOpenClawForm((form) => ({ ...form, modelId: event.target.value }))}
          />
          <datalist id="openclaw-models">
            {models.map((model: any) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </datalist>
        </ConfigField>
        {selectedProvider?.methods?.length > 1 ? (
          <ConfigField label="Auth Method">
            <ConfigSelect
              aria-label="Auth Method"
              value={openClawForm.authMethod}
              onChange={(event) => setOpenClawForm((form) => ({ ...form, authMethod: event.target.value }))}
            >
              <option value="">Select method</option>
              {selectedProvider.methods.map((method: any) => (
                <option key={method.id} value={method.id}>{method.label}</option>
              ))}
            </ConfigSelect>
          </ConfigField>
        ) : null}
      </div>
    );
  }

  if (activeStep?.id === 'config') {
    return (
      <div className="store-config-form">
        <ConfigField label="Config Action">
          <ConfigSelect
            aria-label="Config Action"
            value={openClawForm.configAction}
            onChange={(event) => setOpenClawForm((form) => ({ ...form, configAction: event.target.value }))}
          >
            <option value="update">Update existing config</option>
            <option value="reset">Reset config</option>
          </ConfigSelect>
        </ConfigField>
      </div>
    );
  }

  return <OpenClawFullStepPlaceholder activeStepId={activeStep?.id ?? 'review'} />;
}
```

For full-only sections, render the field labels from the old page in the first implementation even if some controls are minimal. Later tasks can improve individual controls.

- [ ] **Step 6: Wire save button to OpenClaw save handler**

In the common footer button:

```tsx
const saveCurrentAgent = () => {
  if (agentId === 'openclaw') return void saveOpenClaw();
  if (agentId === 'hermes') return void saveHermes();
  if (agentId === 'nanobot') return void saveNanobot();
};
```

Use:

```tsx
<button type="button" className="primary-action" onClick={saveCurrentAgent} disabled={saveState === 'saving'}>
  {saveState === 'saving' ? '\u4fdd\u5b58\u4e2d' : storeConfigText.saveConfig}
</button>
```

- [ ] **Step 7: Run test to verify Task 3 passes**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: PASS for OpenClaw load/save tests.

- [ ] **Step 8: Commit Task 3**

Run when commits are desired:

```powershell
git add frontend/src/StoreConfigPage.tsx frontend/src/storeConfigTypes.ts frontend/src/App.test.tsx
git commit -m "feat: wire openclaw store configuration"
```

---

### Task 4: Implement Hermes Store-Native Configuration

**Files:**
- Modify: `frontend/src/StoreConfigPage.tsx`
- Modify: `frontend/src/storeConfigTypes.ts`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write failing tests for Hermes backend reuse**

Add test:

```tsx
it('loads and saves Hermes quick configuration with existing backend APIs', async () => {
  vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
    data: {
      openclaw_installed: false,
      hermes_installed: true,
      nanobot_installed: false,
      codex_installed: false,
      requires_hermes_configure: true,
    },
  } as any);
  vi.mocked(systemAPI.status).mockResolvedValueOnce({
    data: {
      hermes_installed: true,
      hermes_api_key_configured: false,
      hermes_api_server_enabled: false,
    },
  } as any);
  vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
    data: {
      model_providers: [
        { id: 'alibaba', name: 'Alibaba', models: [{ id: 'alibaba/qwen-coder', name: 'Qwen Coder', contextWindow: 128000, reasoning: true, available: true, input: 'token' }] },
      ],
      provider_endpoints: {
        alibaba: { current: '', presets: [{ label: 'DashScope China', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }] },
      },
    },
  } as any);
  vi.mocked(systemAPI.saveHermesApiKey).mockResolvedValueOnce({ data: { success: true, configured: true } } as any);
  vi.mocked(systemAPI.quickModelConfig).mockResolvedValueOnce({ data: { success: true, fast_path: true, applied: true, model_ready: true } } as any);
  vi.mocked(systemAPI.hermesEnableApiServer).mockResolvedValueOnce({ data: { success: true, hermes_api_server_enabled: true, api_reachable: true, hermes_api_port: 18790 } } as any);

  renderApp();
  const mainPanel = openStore();
  await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
  fireEvent.click(within(getAgentCard('Hermes')).getByRole('button', { name: storeText.goConfigure }));

  await waitFor(() => expect(systemAPI.status).toHaveBeenCalledWith('hermes'));
  fireEvent.change(within(mainPanel).getByLabelText('Hermes API Key'), { target: { value: 'hermes-key' } });
  fireEvent.change(within(mainPanel).getByLabelText('Model Provider'), { target: { value: 'alibaba' } });
  fireEvent.change(within(mainPanel).getByLabelText('Model ID'), { target: { value: 'alibaba/qwen-coder' } });
  fireEvent.click(within(mainPanel).getByRole('button', { name: storeText.saveConfig }));

  await waitFor(() => expect(systemAPI.saveHermesApiKey).toHaveBeenCalledWith('hermes-key'));
  expect(systemAPI.quickModelConfig).toHaveBeenCalledWith(expect.objectContaining({
    platform: 'hermes',
    provider: 'alibaba',
    model_id: 'alibaba/qwen-coder',
  }));
});
```

Add missing API mocks:

```ts
status: vi.fn(),
quickModelConfig: vi.fn(),
saveHermesApiKey: vi.fn(),
generateHermesApiKey: vi.fn(),
revealHermesApiKey: vi.fn(),
hermesEnableApiServer: vi.fn(),
hermesApply: vi.fn(),
hermesBotPlatforms: vi.fn(),
hermesBotConfig: vi.fn(),
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: FAIL because Hermes fields and save are not implemented.

- [ ] **Step 3: Add Hermes form state**

In `storeConfigTypes.ts`:

```ts
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
```

- [ ] **Step 4: Load Hermes status, scan, and bot schema**

In `StoreConfigPage.tsx`, when `agentId === 'hermes'`, call:

```tsx
await Promise.all([
  systemAPI.status('hermes'),
  systemAPI.onboardScan('hermes'),
  systemAPI.hermesBotPlatforms(),
]);
```

Store responses in local state:

```tsx
const [hermesStatus, setHermesStatus] = useState<any>(null);
const [hermesScan, setHermesScan] = useState<any>(null);
const [hermesBotSchema, setHermesBotSchema] = useState<any>(null);
```

- [ ] **Step 5: Render Hermes fields**

For Quick mode, render:

- `Hermes API Key`
- `Model Provider`
- `Model ID`
- `Base URL`
- `API Server`
- Review

Use labels exactly:

```tsx
<ConfigField label="Hermes API Key">
  <ConfigTextInput aria-label="Hermes API Key" type="password" value={hermesForm.apiKey} onChange={...} />
</ConfigField>
<ConfigField label="Model Provider">
  <ConfigSelect aria-label="Model Provider" value={hermesForm.modelProvider} onChange={...} />
</ConfigField>
<ConfigField label="Model ID">
  <ConfigTextInput aria-label="Model ID" value={hermesForm.modelId} onChange={...} />
</ConfigField>
```

For Full mode, add Bot platform fields from `hermesBotSchema.platforms`.

- [ ] **Step 6: Save Hermes**

Implement:

```tsx
const saveHermes = async () => {
  setSaveError('');
  setSaveState('saving');
  try {
    if (hermesForm.apiKey.trim()) {
      await systemAPI.saveHermesApiKey(hermesForm.apiKey.trim());
    }
    if (hermesForm.modelProvider && hermesForm.modelId) {
      await systemAPI.quickModelConfig({
        platform: 'hermes',
        provider: hermesForm.modelProvider,
        model_id: hermesForm.modelId,
        base_url: hermesForm.baseUrl.trim() || undefined,
      });
    }
    if (!hermesStatus?.hermes_api_server_enabled) {
      await systemAPI.hermesEnableApiServer();
    }
    if (hermesForm.botPlatform) {
      await systemAPI.hermesBotConfig({
        platform: hermesForm.botPlatform,
        fields: hermesForm.botFields,
      });
    }
    setSaveState('saved');
    onSaved();
  } catch (error) {
    setSaveState('idle');
    setSaveError(error instanceof Error ? error.message : String(error));
  }
};
```

- [ ] **Step 7: Run tests**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: PASS for Hermes tests.

- [ ] **Step 8: Commit Task 4**

Run when commits are desired:

```powershell
git add frontend/src/StoreConfigPage.tsx frontend/src/storeConfigTypes.ts frontend/src/App.test.tsx
git commit -m "feat: wire hermes store configuration"
```

---

### Task 5: Implement Nanobot Store-Native Configuration

**Files:**
- Modify: `frontend/src/StoreConfigPage.tsx`
- Modify: `frontend/src/storeConfigTypes.ts`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write failing tests for Nanobot backend reuse**

Add test:

```tsx
it('loads and saves Nanobot quick configuration with existing backend APIs', async () => {
  vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
    data: {
      openclaw_installed: false,
      hermes_installed: false,
      nanobot_installed: true,
      codex_installed: false,
      requires_nanobot_configure: true,
    },
  } as any);
  vi.mocked(systemAPI.getNanobotConfig).mockResolvedValueOnce({
    data: {
      workspace: '~/.nanobot/workspace',
      provider: '',
      model: '',
      api_base: '',
      provider_configs: {},
      provider_options: [{ id: 'openai', name: 'OpenAI', default_model: 'openai/gpt-5.1' }],
      gateway: { host: '127.0.0.1', port: 18790 },
      websocket: { enabled: true, host: '127.0.0.1', port: 8765, path: '/', requires_token: false, has_token: false },
      guard: { mode: 'blocking', base_url: 'http://127.0.0.1:6874', timeout_s: 305 },
      model_configured: false,
    },
  } as any);
  vi.mocked(systemAPI.getNanobotModelCatalog).mockResolvedValueOnce({
    data: {
      provider_options: [{ id: 'openai', name: 'OpenAI', default_model: 'openai/gpt-5.1' }],
      model_providers: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'openai/gpt-5.1', name: 'GPT-5.1', contextWindow: 128000, reasoning: true, available: true, input: 'token' }] }],
    },
  } as any);
  vi.mocked(systemAPI.setNanobotConfig).mockResolvedValueOnce({
    data: { model_configured: true },
  } as any);

  renderApp();
  const mainPanel = openStore();
  await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
  fireEvent.click(within(getAgentCard('Nanobot')).getByRole('button', { name: storeText.goConfigure }));

  await waitFor(() => expect(systemAPI.getNanobotConfig).toHaveBeenCalledTimes(1));
  fireEvent.change(within(mainPanel).getByLabelText('Provider'), { target: { value: 'openai' } });
  fireEvent.change(within(mainPanel).getByLabelText('Model ID'), { target: { value: 'openai/gpt-5.1' } });
  fireEvent.change(within(mainPanel).getByLabelText('API Key'), { target: { value: 'sk-nano' } });
  fireEvent.click(within(mainPanel).getByRole('button', { name: storeText.saveConfig }));

  await waitFor(() => expect(systemAPI.setNanobotConfig).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'openai',
    model: 'openai/gpt-5.1',
    api_key: 'sk-nano',
  })));
});
```

Add mocks:

```ts
getNanobotConfig: vi.fn(),
getNanobotModelCatalog: vi.fn(),
setNanobotConfig: vi.fn(),
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: FAIL because Nanobot fields and save are not implemented.

- [ ] **Step 3: Add Nanobot form state**

In `storeConfigTypes.ts`:

```ts
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
  guardMode: string;
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
```

- [ ] **Step 4: Load Nanobot config and model catalog**

In `StoreConfigPage.tsx`, when `agentId === 'nanobot'`, call:

```tsx
const [nanobotConfig, setNanobotConfig] = useState<any>(null);
const [nanobotCatalog, setNanobotCatalog] = useState<any>(null);

useEffect(() => {
  if (agentId !== 'nanobot') return;
  let alive = true;
  Promise.all([
    systemAPI.getNanobotConfig(),
    systemAPI.getNanobotModelCatalog(),
  ])
    .then(([configRes, catalogRes]) => {
      if (!alive) return;
      const config = configRes.data;
      setNanobotConfig(config);
      setNanobotCatalog(catalogRes.data);
      setNanobotForm({
        provider: config.provider || '',
        model: config.model || '',
        apiKey: '',
        clearApiKey: false,
        apiBase: config.api_base || '',
        workspace: config.workspace || '~/.nanobot/workspace',
        gatewayHost: config.gateway?.host || '127.0.0.1',
        gatewayPort: config.gateway?.port || 18790,
        websocketEnabled: Boolean(config.websocket?.enabled),
        websocketHost: config.websocket?.host || '127.0.0.1',
        websocketPort: config.websocket?.port || 8765,
        websocketPath: config.websocket?.path || '/',
        websocketRequiresToken: Boolean(config.websocket?.requires_token),
        websocketToken: '',
        guardMode: config.guard?.mode || 'blocking',
        guardBaseUrl: config.guard?.base_url || 'http://127.0.0.1:6874',
        guardTimeoutS: config.guard?.timeout_s || 305,
      });
    })
    .catch((error) => {
      if (alive) setLoadError(error instanceof Error ? error.message : String(error));
    });
  return () => {
    alive = false;
  };
}, [agentId]);
```

- [ ] **Step 5: Render Nanobot fields**

Quick step `model` must render:

- `Provider`
- `Model ID`
- `API Key`
- `API Base`

Full mode adds workspace, gateway, websocket, guard sections.

- [ ] **Step 6: Save Nanobot**

Implement:

```tsx
const saveNanobot = async () => {
  setSaveError('');
  setSaveState('saving');
  try {
    await systemAPI.setNanobotConfig({
      provider: nanobotForm.provider.trim(),
      model: nanobotForm.model.trim(),
      api_key: nanobotForm.apiKey.trim() || null,
      clear_api_key: nanobotForm.clearApiKey,
      api_base: nanobotForm.apiBase.trim() || null,
      workspace: nanobotForm.workspace,
      gateway_host: nanobotForm.gatewayHost,
      gateway_port: nanobotForm.gatewayPort,
      websocket_enabled: nanobotForm.websocketEnabled,
      websocket_host: nanobotForm.websocketHost,
      websocket_port: nanobotForm.websocketPort,
      websocket_path: nanobotForm.websocketPath,
      websocket_requires_token: nanobotForm.websocketRequiresToken,
      websocket_token: nanobotForm.websocketToken.trim() || null,
      guard_mode: nanobotForm.guardMode as any,
      guard_base_url: nanobotForm.guardBaseUrl,
      guard_timeout_s: nanobotForm.guardTimeoutS,
    });
    setSaveState('saved');
    onSaved();
  } catch (error) {
    setSaveState('idle');
    setSaveError(error instanceof Error ? error.message : String(error));
  }
};
```

- [ ] **Step 7: Run tests**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: PASS for Nanobot tests.

- [ ] **Step 8: Commit Task 5**

Run when commits are desired:

```powershell
git add frontend/src/StoreConfigPage.tsx frontend/src/storeConfigTypes.ts frontend/src/App.test.tsx
git commit -m "feat: wire nanobot store configuration"
```

---

### Task 6: Error Handling, Polish, and Verification

**Files:**
- Modify: `frontend/src/StoreConfigPage.tsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write failing tests for load failure, save failure, and back behavior**

Add:

```tsx
it('keeps the Store-native config page open and preserves form values when save fails', async () => {
  vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
    data: { openclaw_installed: true, hermes_installed: false, nanobot_installed: false, codex_installed: false, config_exists: false },
  } as any);
  vi.mocked(systemAPI.onboardScan).mockResolvedValueOnce({
    data: { auth_providers: [{ id: 'openai', name: 'OpenAI', methods: [{ id: 'api-key', label: 'API Key' }] }], model_providers: [], defaults: {}, channels: [], skills: [], hooks: [] },
  } as any);
  vi.mocked(systemAPI.onboardConfig).mockRejectedValueOnce(new Error('save exploded'));

  renderApp();
  const mainPanel = openStore();
  await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
  fireEvent.click(within(getAgentCard('OpenClaw')).getByRole('button', { name: storeText.goConfigure }));
  await waitFor(() => expect(systemAPI.onboardScan).toHaveBeenCalledWith('openclaw'));

  fireEvent.click(within(mainPanel).getByRole('button', { name: '\u6a21\u578b\u4e0e\u5bc6\u94a5' }));
  fireEvent.change(within(mainPanel).getByLabelText('API Key'), { target: { value: 'sk-keep-me' } });
  fireEvent.click(within(mainPanel).getByRole('button', { name: storeText.saveConfig }));

  await waitFor(() => expect(within(mainPanel).getByText(/save exploded/)).toBeTruthy());
  expect(within(mainPanel).getByDisplayValue('sk-keep-me')).toBeTruthy();
  expect(within(mainPanel).getByRole('heading', { name: /OpenClaw/ })).toBeTruthy();
});

it('returns from Store-native config page to Agent Store grid', async () => {
  vi.mocked(systemAPI.installStatus).mockResolvedValueOnce({
    data: { openclaw_installed: true, hermes_installed: false, nanobot_installed: false, codex_installed: false, config_exists: true },
  } as any);

  renderApp();
  const mainPanel = openStore();
  await waitFor(() => expect(systemAPI.installStatus).toHaveBeenCalledTimes(1));
  fireEvent.click(within(getAgentCard('OpenClaw')).getByRole('button', { name: storeText.configure }));
  fireEvent.click(within(mainPanel).getByRole('button', { name: 'Agent Store' }));

  expect(within(mainPanel).getByRole('heading', { name: 'Agent Store' })).toBeTruthy();
  expect(within(mainPanel).getByRole('heading', { name: 'OpenClaw' })).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: FAIL if error banners/back behavior are missing.

- [ ] **Step 3: Add error and success banners**

In `StoreConfigPage.tsx`, inside `.store-config-panel`, render:

```tsx
{loadError ? <div className="store-config-alert error">{storeConfigText.loadFailed}: {loadError}</div> : null}
{saveError ? <div className="store-config-alert error">{storeConfigText.saveFailed}: {saveError}</div> : null}
{saveState === 'saved' ? <div className="store-config-alert success">{storeConfigText.saved}</div> : null}
```

- [ ] **Step 4: Add alert styles and responsive layout**

Append:

```css
.store-config-alert {
  margin-bottom: 16px;
  border-radius: 8px;
  padding: 11px 13px;
  font-size: 13px;
  font-weight: 650;
}

.store-config-alert.error {
  color: #9e2424;
  border: 1px solid #f0c6c6;
  background: #fff5f5;
}

.store-config-alert.success {
  color: #16734d;
  border: 1px solid #c9ead8;
  background: #f1faf4;
}

.store-config-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 22px;
}

@media (max-width: 860px) {
  .store-config-header {
    grid-template-columns: 1fr;
  }

  .store-config-layout {
    grid-template-columns: 1fr;
  }

  .store-config-steps {
    flex-direction: row;
    overflow-x: auto;
  }

  .store-config-steps button {
    white-space: nowrap;
  }
}
```

- [ ] **Step 5: Run focused frontend tests**

Run:

```powershell
cd frontend
npm run test -- App.test.tsx --run
```

Expected: PASS, all App tests.

- [ ] **Step 6: Run production build**

Run:

```powershell
cd frontend
npm run build
```

Expected: exit code 0. Existing Vite chunk-size warnings are acceptable if no TypeScript/build errors occur.

- [ ] **Step 7: Check git diff scope**

Run:

```powershell
git diff -- frontend/src/App.tsx frontend/src/App.css frontend/src/App.test.tsx frontend/src/StoreConfigPage.tsx frontend/src/storeConfigTypes.ts docs/superpowers/specs/2026-06-25-store-config-page-design.md docs/superpowers/plans/2026-06-25-store-config-page-implementation.md --stat
```

Expected: changes are limited to Store UI/config frontend, tests, and planning docs.

- [ ] **Step 8: Commit Task 6**

Run when commits are desired:

```powershell
git add frontend/src/App.tsx frontend/src/App.css frontend/src/App.test.tsx frontend/src/StoreConfigPage.tsx frontend/src/storeConfigTypes.ts docs/superpowers/specs/2026-06-25-store-config-page-design.md docs/superpowers/plans/2026-06-25-store-config-page-implementation.md
git commit -m "feat: complete store-native agent configuration"
```

---

## Self-Review Checklist

- Spec coverage:
  - Store-internal configuration detail page is covered in Task 1.
  - Quick/Full modes are covered in Task 2.
  - OpenClaw old field coverage and backend API reuse are covered in Task 3.
  - Hermes old field coverage and backend API reuse are covered in Task 4.
  - Nanobot old field coverage and backend API reuse are covered in Task 5.
  - Error handling and verification are covered in Task 6.
  - Codex exclusion is covered in Task 1 and tests.

- Placeholder scan:
  - This plan avoids incomplete placeholder sections and gives concrete file paths, commands, tests, and code snippets for each task.

- Type consistency:
  - `ConfigurableAgentId`, `StoreConfigMode`, and form-state types are defined in `storeConfigTypes.ts`.
  - `StoreConfigPage` receives a `ConfigurableAgentId` and is opened by Store state, not by old configure routes.
  - Existing backend method names match `frontend/src/services/api.ts`.
