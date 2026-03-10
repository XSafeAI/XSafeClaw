import { Suspense, lazy, useCallback, useState } from 'react';
import GameCanvas from './components/GameCanvas';
import Tooltip from './components/Tooltip';
import AgentCard from './components/AgentCard';
import PendingPopup from './components/PendingPopup';
import TownConsole from './components/TownConsole';
import './components/TownConsole.css';
const AgentJourney = lazy(() => import('./components/AgentJourney'));

export default function App() {
  const [tooltip, setTooltip]       = useState(null);
  const [agentCard, setAgentCard]   = useState(null);
  const [showPopup, setShowPopup]   = useState(false);
  const [journeyData, setJourneyData] = useState(null);
  const [guardEnabled, setGuardEnabled] = useState(false);

  const handleNpcHover = useCallback((data, pos) => {
    setTooltip({ data, pos });
  }, []);

  const handleNpcLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleNpcClick = useCallback((data) => {
    setAgentCard(data);
  }, []);

  const handlePendingClick = useCallback(() => {
    setShowPopup(true);
  }, []);

  const handleCloseCard = useCallback(() => {
    setAgentCard(null);
  }, []);

  const handleOpenJourney = useCallback((d) => {
    setAgentCard(null);
    setJourneyData(d);
  }, []);

  return (
    <>
      <GameCanvas
        onNpcHover={handleNpcHover}
        onNpcLeave={handleNpcLeave}
        onNpcClick={handleNpcClick}
        onPendingClick={handlePendingClick}
        guardEnabled={guardEnabled}
      />

      <TownConsole
        guardEnabled={guardEnabled}
        onToggleGuard={() => setGuardEnabled((v) => !v)}
        onSelectAgent={(data) => setAgentCard(data)}
      />

      <Tooltip data={tooltip} />

      {agentCard && (
        <AgentCard
          data={agentCard}
          onClose={handleCloseCard}
          onJourney={handleOpenJourney}
        />
      )}

      {showPopup && (
        <PendingPopup onClose={() => setShowPopup(false)} />
      )}

      {journeyData && (
        <Suspense fallback={null}>
          <AgentJourney data={journeyData} onClose={() => setJourneyData(null)} />
        </Suspense>
      )}
    </>
  );
}
