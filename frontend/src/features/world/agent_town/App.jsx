import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GameCanvas from './components/GameCanvas';
import Tooltip from './components/Tooltip';
import AgentCard from './components/AgentCard';
import TownConsole from './components/TownConsole';
import { DEFAULT_MAP_CONFIG, MAP_VARIANTS, MUSIC_TRACKS, USE_AGENT_TOWN_MOCK, removeDemoSession } from './config/constants';
import './components/TownConsole.css';
const AgentJourney = lazy(() => import('./components/AgentJourney'));

const UI_W = 28 * 32;
const UI_H = 20 * 32;
const MAP_TOP_GAP = 54;
const CONSOLE_OVERLAP = 84;
const MAP_SCALE_BOOST = 1.8;

export default function App() {
  const [tooltip, setTooltip]       = useState(null);
  const [agentCard, setAgentCard]   = useState(null);
  const [journeyData, setJourneyData] = useState(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [guardEnabled, setGuardEnabled] = useState(false);
  const [activeMapId, setActiveMapId] = useState(DEFAULT_MAP_CONFIG.id);
  const [activeMusicId, setActiveMusicId] = useState(MUSIC_TRACKS[0]?.id || '');
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.42);
  const [sceneNpcDisplayMode, setSceneNpcDisplayMode] = useState('all');
  const [sceneNpcDisplayCap, setSceneNpcDisplayCap] = useState(12);
  const [cursorState, setCursorState] = useState('normal');
  const [canvasRefreshTrigger, setCanvasRefreshTrigger] = useState(0);
  const audioRef = useRef(null);
  const gameEngineRef = useRef(null);
  const [mapSize, setMapSize] = useState(null);
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  const layoutRef = useRef(null);

  useEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setViewport({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleLayoutChange = useCallback(({ sceneW, sceneH }) => {
    if (sceneW > 0 && sceneH > 0) {
      setMapSize({ w: sceneW, h: sceneH });
    }
  }, []);

  const activeMapConfig = useMemo(
    () => MAP_VARIANTS.find((map) => map.id === activeMapId) || DEFAULT_MAP_CONFIG,
    [activeMapId]
  );
  const activeMusicTrack = useMemo(
    () => MUSIC_TRACKS.find((track) => track.id === activeMusicId) || MUSIC_TRACKS[0] || null,
    [activeMusicId]
  );
  const activeCursorUrl = useMemo(() => {
    if (cursorState === 'grab-full') return '/UI/png/pointer/pointer_grab_full.png';
    if (cursorState === 'grab-start') return '/UI/png/pointer/pointer_grab_start.png';
    return '/UI/png/pointer/pointer_normal.png';
  }, [cursorState]);

  const syncAudioTrack = useCallback((track, enabled, volume, restart = false) => {
    const audio = audioRef.current;
    if (!audio || !track) return;

    const trackChanged = audio.dataset.trackId !== track.id;
    if (trackChanged || restart) {
      audio.pause();
      audio.src = track.url;
      audio.dataset.trackId = track.id;
      audio.load();
      audio.currentTime = 0;
    }

    audio.loop = true;
    audio.volume = volume;

    if (enabled) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);

  const handleNpcHover = useCallback((data, pos) => {
    setTooltip({ data, pos });
  }, []);

  const handleNpcLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleNpcClick = useCallback((data) => {
    setAgentCard(data);
  }, []);

  const handleCursorStateChange = useCallback((nextState) => {
    setCursorState(nextState || 'normal');
  }, []);

  useEffect(() => {
    if (USE_AGENT_TOWN_MOCK) return;
    fetch('/api/guard/enabled', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (typeof d.enabled === 'boolean') setGuardEnabled(d.enabled); })
      .catch(() => {});
  }, []);

  const handleToggleGuard = useCallback(() => {
    setGuardEnabled((prev) => {
      const next = !prev;
      if (!USE_AGENT_TOWN_MOCK) {
        fetch('/api/guard/enabled', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        }).catch(() => { setGuardEnabled(prev); });
      }
      return next;
    });
  }, []);

  const handleDeleteAgent = useCallback(async (agent) => {
    if (!agent) return;
    const sessionKey = agent.session_key || '';
    const sessionId = agent.id || '';
    setAgentCard(null);
    setJourneyData(null);
    removeDemoSession(sessionKey);
    if (sessionId && gameEngineRef.current) {
      gameEngineRef.current.deleteAgentById(sessionId);
    }
    try {
      if (sessionKey) {
        await fetch('/api/chat/close-session?' + new URLSearchParams({ session_key: sessionKey }), { method: 'POST' }).catch(() => {});
      }
      if (sessionId) {
        await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => {});
      }
    } catch (_) {}
    setTimeout(() => setCanvasRefreshTrigger((n) => n + 1), 2000);
  }, []);

  const handleCloseCard = useCallback(() => {
    setAgentCard(null);
  }, []);

  const handleOpenJourney = useCallback((d) => {
    setAgentCard(null);
    setJourneyData(d);
  }, []);

  const mapBaseW = mapSize?.w ?? UI_W;
  const mapBaseH = mapSize?.h ?? UI_H;
  const totalH = mapBaseH * MAP_SCALE_BOOST + MAP_TOP_GAP + 24;
  const scale = Math.min(
    viewport.w / (mapBaseW * MAP_SCALE_BOOST),
    viewport.h / totalH,
  );
  const mapW = Math.round(mapBaseW * scale * MAP_SCALE_BOOST);
  const mapH = Math.round(mapBaseH * scale * MAP_SCALE_BOOST);
  const topGap = Math.round(MAP_TOP_GAP * scale);

  useEffect(() => {
    setMapSize(null);
  }, [activeMapConfig.id]);

  useEffect(() => {
    syncAudioTrack(activeMusicTrack, musicEnabled, musicVolume);
  }, [activeMusicTrack, musicEnabled, musicVolume, syncAudioTrack]);

  useEffect(() => {
    const resumeAudio = () => {
      const audio = audioRef.current;
      if (!audio || !musicEnabled || !audio.paused) return;
      audio.play().catch(() => {});
    };

    window.addEventListener('pointerdown', resumeAudio);
    window.addEventListener('keydown', resumeAudio);
    return () => {
      window.removeEventListener('pointerdown', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
    };
  }, [musicEnabled]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const styleId = 'agent-town-global-cursor-style';
    let styleEl = document.getElementById(styleId);

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const cursorRule = `url('${activeCursorUrl}') 4 4, pointer`;
    root.style.cursor = cursorRule;
    body.style.cursor = cursorRule;
    if (layoutRef.current) {
      layoutRef.current.style.cursor = cursorRule;
    }

    styleEl.textContent = `
      html,
      body,
      body *,
      .app-layout,
      .app-layout * {
        cursor: ${cursorRule} !important;
      }
    `;

    return () => {
      root.style.removeProperty('cursor');
      body.style.removeProperty('cursor');
      if (layoutRef.current) {
        layoutRef.current.style.removeProperty('cursor');
      }
      styleEl?.remove();
    };
  }, [activeCursorUrl]);

  const handleToggleMusic = useCallback(() => {
    setMusicEnabled((prev) => {
      const next = !prev;
      syncAudioTrack(activeMusicTrack, next, musicVolume, false);
      return next;
    });
  }, [activeMusicTrack, musicVolume, syncAudioTrack]);

  const handleChangeMusic = useCallback((trackId) => {
    const nextTrack = MUSIC_TRACKS.find((track) => track.id === trackId) || MUSIC_TRACKS[0] || null;
    setActiveMusicId(trackId);
    syncAudioTrack(nextTrack, musicEnabled, musicVolume, true);
  }, [musicEnabled, musicVolume, syncAudioTrack]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.target.isContentEditable || event.target.closest('[contenteditable]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (window.getSelection()?.toString()) return;
      if (event.key === 'Escape') { setConsoleOpen(false); return; }
      if (event.key === 'c' || event.key === 'C') { setConsoleOpen((v) => !v); return; }
      if (event.key === 'm' || event.key === 'M') { handleToggleMusic(); return; }
      if (event.key === 'g' || event.key === 'G') { handleToggleGuard(); return; }
      if (event.key === 'h' || event.key === 'H') { window.location.href = '/'; return; }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleMusic, handleToggleGuard]);

  return (
    <div
      className={`app-layout agent-town-cursor cursor-${cursorState}`}
      data-map-theme={activeMapConfig.id}
      ref={layoutRef}
    >
      <audio ref={audioRef} preload="auto" hidden />
      <nav className="town-hud">
        <button
          type="button"
          className={`town-hud-btn town-hud-console ${consoleOpen ? 'is-on' : ''}`}
          onClick={() => setConsoleOpen((prev) => !prev)}
          title={`${consoleOpen ? 'Close' : 'Open'} Console  [C]`}
        >
          <span className="town-hud-pip" />
          <span className="town-hud-icon">☰</span>
          <span className="town-hud-label">CMD</span>
        </button>
        <button
          type="button"
          className={`town-hud-btn town-hud-music ${musicEnabled ? 'is-on' : ''}`}
          onClick={handleToggleMusic}
          title={`${musicEnabled ? 'Mute' : 'Play'} Music  [M]`}
        >
          <span className="town-hud-pip" />
          <span className="town-hud-icon">{musicEnabled ? '♫' : '♪'}</span>
          <span className="town-hud-label">BGM</span>
        </button>
        <button
          type="button"
          className={`town-hud-btn town-hud-guard ${guardEnabled ? 'is-on' : ''}`}
          onClick={handleToggleGuard}
          title={`${guardEnabled ? 'Disable' : 'Enable'} Guard  [G]`}
        >
          <span className="town-hud-pip" />
          <span className="town-hud-icon">⚔</span>
          <span className="town-hud-label">GRD</span>
        </button>
        <span className="town-hud-sep" />
        <a
          className="town-hud-btn town-hud-home"
          href="/monitor"
          title="Back to Backend  [H]"
        >
          <span className="town-hud-pip" />
          <span className="town-hud-icon">⌂</span>
          <span className="town-hud-label">Backend</span>
        </a>
      </nav>

      <div
        className="content-stack"
        style={{
          width: mapW,
          height: topGap + mapH,
          alignItems: 'center',
        }}
      >
        <div style={{ height: topGap }} />
        <div style={{ width: mapW, height: mapH, position: 'relative', zIndex: 1 }}>
          <GameCanvas
            key={activeMapConfig.id}
            onNpcHover={handleNpcHover}
            onNpcLeave={handleNpcLeave}
            onNpcClick={handleNpcClick}
            onCursorStateChange={handleCursorStateChange}
            guardEnabled={guardEnabled}
            onLayoutChange={handleLayoutChange}
            mapConfig={activeMapConfig}
            refreshTrigger={canvasRefreshTrigger}
            gameEngineRef={gameEngineRef}
          />
        </div>
      </div>

      {consoleOpen ? (
        <div className="town-console-overlay" onClick={() => setConsoleOpen(false)}>
          <div className="town-console-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="town-console-close"
              onClick={() => setConsoleOpen(false)}
            >
              CLOSE
            </button>
            <TownConsole
              guardEnabled={guardEnabled}
              onToggleGuard={handleToggleGuard}
              onSelectAgent={(data) => setAgentCard(data)}
              mapVariants={MAP_VARIANTS}
              activeMapId={activeMapConfig.id}
              onChangeMap={setActiveMapId}
              musicTracks={MUSIC_TRACKS}
              activeMusicId={activeMusicTrack?.id || ''}
              onChangeMusic={handleChangeMusic}
              musicEnabled={musicEnabled}
              onToggleMusic={handleToggleMusic}
              musicVolume={musicVolume}
              onChangeMusicVolume={setMusicVolume}
              sceneNpcDisplayMode={sceneNpcDisplayMode}
              onChangeSceneNpcDisplayMode={setSceneNpcDisplayMode}
              sceneNpcDisplayCap={sceneNpcDisplayCap}
              onChangeSceneNpcDisplayCap={setSceneNpcDisplayCap}
              onDeleteAgent={handleDeleteAgent}
              onDataChanged={() => setCanvasRefreshTrigger((n) => n + 1)}
            />
          </div>
        </div>
      ) : null}

      <Tooltip data={tooltip} />

      {agentCard && (
        <AgentCard
          data={agentCard}
          onClose={handleCloseCard}
          onJourney={handleOpenJourney}
          onDeleteAgent={handleDeleteAgent}
        />
      )}

      {journeyData && (
        <Suspense fallback={null}>
          <AgentJourney data={journeyData} onClose={() => setJourneyData(null)} onDeleteAgent={handleDeleteAgent} />
        </Suspense>
      )}
    </div>
  );
}
