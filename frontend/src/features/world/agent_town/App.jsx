import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GameCanvas from './components/GameCanvas';
import Tooltip from './components/Tooltip';
import AgentCard from './components/AgentCard';
import PendingPopup from './components/PendingPopup';
import TownConsole from './components/TownConsole';
import { DEFAULT_MAP_CONFIG, MAP_VARIANTS, MUSIC_TRACKS } from './config/constants';
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
  const [showPopup, setShowPopup]   = useState(false);
  const [journeyData, setJourneyData] = useState(null);
  const [guardEnabled, setGuardEnabled] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [activeMapId, setActiveMapId] = useState(DEFAULT_MAP_CONFIG.id);
  const [activeMusicId, setActiveMusicId] = useState(MUSIC_TRACKS[0]?.id || '');
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.42);
  const [cursorState, setCursorState] = useState('normal');
  const audioRef = useRef(null);
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

  const handlePendingClick = useCallback(() => {
    setShowPopup(true);
  }, []);

  const handleCursorStateChange = useCallback((nextState) => {
    setCursorState(nextState || 'normal');
  }, []);

  const handleToggleGuard = useCallback(() => {
    setGuardEnabled((value) => !value);
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
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setConsoleOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  return (
    <div className={`app-layout agent-town-cursor cursor-${cursorState}`} ref={layoutRef}>
      <audio ref={audioRef} preload="auto" hidden />
      <div className="town-quick-actions">
        <button
          type="button"
          className={`town-console-toggle ${consoleOpen ? 'is-open' : ''}`}
          onClick={() => setConsoleOpen((prev) => !prev)}
        >
          <span className="town-console-toggle-dot" />
          <span className="town-console-toggle-text">{consoleOpen ? 'Close Console' : 'Open Console'}</span>
        </button>
        <button
          type="button"
          className={`town-guard-toggle ${guardEnabled ? 'is-active' : ''}`}
          onClick={handleToggleGuard}
        >
          <span className="town-guard-toggle-label">Guard</span>
          <span className="town-guard-toggle-state">{guardEnabled ? 'ON' : 'OFF'}</span>
        </button>
      </div>

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
            onPendingClick={handlePendingClick}
            onCursorStateChange={handleCursorStateChange}
            guardEnabled={guardEnabled}
            onLayoutChange={handleLayoutChange}
            mapConfig={activeMapConfig}
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
    </div>
  );
}
