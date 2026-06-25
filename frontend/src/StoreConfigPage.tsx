import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useHermesStoreConfig } from './HermesStoreConfig';
import { useNanobotStoreConfig } from './NanobotStoreConfig';
import { useOpenClawStoreConfig } from './OpenClawStoreConfig';
import { ConfigField, ConfigSelect, ConfigTextInput } from './StoreConfigFields';
import {
  type ConfigurableAgentId,
  STORE_CONFIG_AGENTS,
  type StoreConfigMode,
  storeConfigText,
} from './storeConfigTypes';

export { ConfigField, ConfigSelect, ConfigTextInput };

type StoreConfigPageProps = {
  agentId: ConfigurableAgentId;
  installed: boolean;
  configured: boolean;
  onBack: () => void;
  onSaved: () => void;
};

const installBadgeText = {
  installed: '\u5df2\u5b89\u88c5',
  notInstalled: '\u672a\u5b89\u88c5',
  configured: '\u5df2\u914d\u7f6e',
  needsConfigure: '\u5f85\u914d\u7f6e',
};

function clampStepIndex(index: number, stepCount: number) {
  return Math.min(Math.max(index, 0), Math.max(stepCount - 1, 0));
}

export default function StoreConfigPage({
  agentId,
  installed,
  configured,
  onBack,
  onSaved,
}: StoreConfigPageProps) {
  const [mode, setMode] = useState<StoreConfigMode>('quick');
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [savedMessage, setSavedMessage] = useState('');
  const isOpenClaw = agentId === 'openclaw';
  const isHermes = agentId === 'hermes';
  const isNanobot = agentId === 'nanobot';
  const openClawConfig = useOpenClawStoreConfig({ enabled: isOpenClaw, configured, onSaved });
  const hermesConfig = useHermesStoreConfig({ enabled: isHermes, onSaved });
  const nanobotConfig = useNanobotStoreConfig({ enabled: isNanobot, onSaved });
  const agent = STORE_CONFIG_AGENTS[agentId];
  const AgentIcon = agent.icon;
  const steps = agent.steps[mode];
  const activeStep = steps[clampStepIndex(activeStepIndex, steps.length)];
  const isFinalStep = activeStepIndex === steps.length - 1;
  const activeSavedMessage = isOpenClaw
    ? openClawConfig.savedMessage
    : isHermes
      ? hermesConfig.savedMessage
      : isNanobot
        ? nanobotConfig.savedMessage
        : savedMessage;
  const activeSaveError = isOpenClaw
    ? openClawConfig.saveError
    : isHermes
      ? hermesConfig.saveError
      : isNanobot
        ? nanobotConfig.saveError
        : '';
  const activeWarningMessage = isNanobot
    ? nanobotConfig.warningMessage
    : '';
  const activeSaving = isOpenClaw
    ? openClawConfig.savingConfig
    : isHermes
      ? hermesConfig.savingConfig
      : isNanobot
        ? nanobotConfig.savingConfig
        : false;
  const activeLoading = isOpenClaw
    ? openClawConfig.loadingConfig
    : isHermes
      ? hermesConfig.loadingConfig
      : isNanobot
        ? nanobotConfig.loadingConfig
        : false;
  const activeLoadError = isOpenClaw
    ? openClawConfig.loadError
    : isHermes
      ? hermesConfig.loadError
      : isNanobot
        ? nanobotConfig.loadError
        : '';

  const clearStatus = () => {
    setSavedMessage('');
    if (isOpenClaw) openClawConfig.clearMessages();
    if (isHermes) hermesConfig.clearMessages();
    if (isNanobot) nanobotConfig.clearMessages();
  };

  const selectMode = (nextMode: StoreConfigMode) => {
    setMode(nextMode);
    setActiveStepIndex(0);
    clearStatus();
  };

  const handleSaved = () => {
    setSavedMessage(storeConfigText.saved);
    onSaved();
  };

  const handleFooterSave = () => {
    if (isOpenClaw) {
      void openClawConfig.save();
      return;
    }
    if (isHermes) {
      void hermesConfig.save();
      return;
    }
    if (isNanobot) {
      void nanobotConfig.save();
      return;
    }
    handleSaved();
  };

  const renderActiveContent = () => {
    if (isOpenClaw) return openClawConfig.renderContent(activeStep);
    if (isHermes) return hermesConfig.renderContent(activeStep);
    if (isNanobot) return nanobotConfig.renderContent(activeStep);

    return (
      <p className="store-config-placeholder">
        {`${agent.name} ${activeStep} \u914d\u7f6e\u8868\u5355\u5c06\u5728\u8fd9\u91cc\u663e\u793a\u3002`}
      </p>
    );
  };

  return (
    <section className="store-config-page" aria-labelledby="store-config-title">
      <header className="store-config-header">
        <button type="button" className="store-config-back" onClick={onBack}>
          <ChevronLeft size={18} strokeWidth={2} />
          {storeConfigText.backToStore}
        </button>

        <div className="store-config-hero">
          <div className={`agent-logo store-config-logo agent-logo-${agent.tone}`}>
            <AgentIcon size={38} strokeWidth={2.2} />
          </div>
          <div className="store-config-title-block">
            <h1 id="store-config-title">{agent.name}</h1>
            <div className="store-config-badges">
              <span className={`agent-badge ${installed ? 'installed' : 'not-installed'}`}>
                {installed ? installBadgeText.installed : installBadgeText.notInstalled}
              </span>
              <span className={`agent-badge ${configured ? 'configured' : 'needs-configure'}`}>
                {configured ? installBadgeText.configured : installBadgeText.needsConfigure}
              </span>
            </div>
          </div>
        </div>

        <div className="store-config-mode-switch" role="group" aria-label="Store config mode">
          <button
            type="button"
            className={mode === 'quick' ? 'active' : undefined}
            aria-pressed={mode === 'quick'}
            onClick={() => selectMode('quick')}
          >
            {storeConfigText.quickConfig}
          </button>
          <button
            type="button"
            className={mode === 'full' ? 'active' : undefined}
            aria-pressed={mode === 'full'}
            onClick={() => selectMode('full')}
          >
            {storeConfigText.fullConfig}
          </button>
        </div>
      </header>

      <div className="store-config-shell">
        <aside className="store-config-steps" aria-label={`${agent.name} configuration steps`}>
          {steps.map((step, index) => (
            <div
              key={`${agent.id}-${mode}-${step}`}
              className={`store-config-step ${index === activeStepIndex ? 'active' : ''}`}
              aria-current={index === activeStepIndex ? 'step' : undefined}
            >
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </aside>

        <div className="store-config-panel">
          <div>
            <p className="store-config-kicker">{mode === 'quick' ? storeConfigText.quickConfig : storeConfigText.fullConfig}</p>
            <h2>{activeStep}</h2>
            {activeLoading ? <p className="store-config-placeholder">{storeConfigText.loading}...</p> : null}
            {activeLoadError ? <p className="store-config-status error" aria-live="polite">{activeLoadError}</p> : null}
            {renderActiveContent()}
          </div>

          <footer className="store-config-actions">
            <button
              type="button"
              className="secondary-action"
              disabled={activeStepIndex === 0}
              onClick={() => setActiveStepIndex((index) => clampStepIndex(index - 1, steps.length))}
            >
              {storeConfigText.previous}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={activeStepIndex === steps.length - 1}
              onClick={() => setActiveStepIndex((index) => clampStepIndex(index + 1, steps.length))}
            >
              {storeConfigText.next}
            </button>
            <button type="button" className="primary-action" disabled={activeSaving} onClick={handleFooterSave}>
              {storeConfigText.saveConfig}
            </button>
            <button type="button" className="secondary-action" disabled={activeSaving || !isFinalStep} onClick={handleFooterSave}>
              {storeConfigText.applyConfig}
            </button>
          </footer>
          {activeSavedMessage ? <p className="store-config-status" aria-live="polite">{activeSavedMessage}</p> : null}
          {activeWarningMessage ? <p className="store-config-status warning" aria-live="polite">{activeWarningMessage}</p> : null}
          {activeSaveError ? <p className="store-config-status error" aria-live="polite">{activeSaveError}</p> : null}
        </div>
      </div>
    </section>
  );
}
