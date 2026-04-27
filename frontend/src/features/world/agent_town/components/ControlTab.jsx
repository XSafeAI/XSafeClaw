import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ImageSwitch from './ImageSwitch';
import { getAgentTownText } from '../i18n';

const LANGUAGE_OPTION_IDS = ['zh-CN', 'en-US'];
const DENSITY_OPTION_IDS = ['cozy', 'compact', 'dense'];
const AMBIENT_OPTION_IDS = ['soft', 'normal', 'cinematic'];

function CircularProgress({ percent, size = 40, stroke = 3 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,224,177,0.15)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#efc16a" strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.15s ease' }} />
    </svg>
  );
}

const mapSkinStore = {
  status: {},
  downloading: {},
  listeners: new Set(),
  inFlight: new Map(),
};

function mapSkinSnapshot() {
  return {
    status: mapSkinStore.status,
    downloading: mapSkinStore.downloading,
  };
}

function emitMapSkinStore() {
  const snapshot = mapSkinSnapshot();
  for (const listener of mapSkinStore.listeners) listener(snapshot);
}

function patchMapSkinStore(patch) {
  Object.assign(mapSkinStore, patch);
  emitMapSkinStore();
}

async function refreshMapSkinStatus() {
  try {
    const res = await fetch('/api/map-skins/status', { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    const map = {};
    for (const s of data) map[s.id] = s.downloaded;
    patchMapSkinStore({ status: map });
    return true;
  } catch {
    return false;
  }
}

async function downloadMapSkin(mapId) {
  const existing = mapSkinStore.inFlight.get(mapId);
  if (existing) return existing;

  const task = (async () => {
    let completed = false;
    patchMapSkinStore({
      downloading: {
        ...mapSkinStore.downloading,
        [mapId]: { active: true, percent: 0 },
      },
    });

    try {
      const res = await fetch(`/api/map-skins/download/${mapId}`, { method: 'POST' });
      if (!res.ok || !res.body) {
        throw new Error(`download failed: HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.phase === 'waiting' || evt.phase === 'start') {
              patchMapSkinStore({
                downloading: {
                  ...mapSkinStore.downloading,
                  [mapId]: { active: true, percent: mapSkinStore.downloading[mapId]?.percent || 0 },
                },
              });
            } else if (evt.phase === 'downloading') {
              patchMapSkinStore({
                downloading: {
                  ...mapSkinStore.downloading,
                  [mapId]: { active: true, percent: evt.percent },
                },
              });
            } else if (evt.phase === 'done') {
              completed = true;
              patchMapSkinStore({
                downloading: {
                  ...mapSkinStore.downloading,
                  [mapId]: { active: false, percent: 100 },
                },
                status: {
                  ...mapSkinStore.status,
                  [mapId]: true,
                },
              });
            } else if (evt.phase === 'error') {
              throw new Error(evt.message || 'map download failed');
            }
          } catch (err) {
            if (err instanceof SyntaxError) continue;
            throw err;
          }
        }
      }
      await refreshMapSkinStatus();
      return completed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || 'map download failed');
      patchMapSkinStore({
        downloading: {
          ...mapSkinStore.downloading,
          [mapId]: { active: false, percent: 0, error: message },
        },
      });
      return false;
    } finally {
      mapSkinStore.inFlight.delete(mapId);
    }
  })();

  mapSkinStore.inFlight.set(mapId, task);
  return task;
}

function useMapSkinStatus() {
  const [snapshot, setSnapshot] = useState(mapSkinSnapshot);

  useEffect(() => {
    mapSkinStore.listeners.add(setSnapshot);
    return () => {
      mapSkinStore.listeners.delete(setSnapshot);
    };
  }, []);

  useEffect(() => { refreshMapSkinStatus(); }, []);

  return {
    status: snapshot.status,
    downloading: snapshot.downloading,
    download: downloadMapSkin,
    refresh: refreshMapSkinStatus,
  };
}

function PixelSelect({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select',
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const normalizedValue = String(value ?? '');

  const selectedOption = useMemo(
    () => options.find((option) => String(option.value) === normalizedValue) || null,
    [normalizedValue, options],
  );

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      ref={rootRef}
      className={`tc-pixel-select ${open ? 'tc-pixel-select-open' : ''} ${disabled ? 'tc-pixel-select-disabled' : ''}`}
    >
      <button
        type="button"
        className="tc-pixel-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="tc-pixel-select-copy">
          <span className="tc-pixel-select-value">{selectedOption?.label || placeholder}</span>
          {selectedOption?.meta ? (
            <span className="tc-pixel-select-meta">{selectedOption.meta}</span>
          ) : null}
        </span>
        <span className="tc-pixel-select-caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="tc-pixel-select-menu" role="listbox">
          {options.map((option) => {
            const isActive = String(option.value) === normalizedValue;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`tc-pixel-select-option ${isActive ? 'tc-pixel-select-option-active' : ''}`}
                onClick={() => {
                  onChange?.(option.value);
                  setOpen(false);
                }}
              >
                <span className="tc-pixel-select-option-label">{option.label}</span>
                {option.meta ? (
                  <span className="tc-pixel-select-option-meta">{option.meta}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function OptionChipGroup({ options, value, onChange, comingSoon = false, comingSoonText = 'Coming Soon' }) {
  const [showToast, setShowToast] = useState(false);

  const handleClick = (id) => {
    if (comingSoon) {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 1500);
      return;
    }
    onChange(id);
  };

  return (
    <div className="tc-control-chip-row" style={{ position: 'relative' }}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`tc-control-chip ${value === option.id ? 'tc-control-chip-active' : ''} ${comingSoon ? 'tc-control-chip-disabled' : ''}`}
          onClick={() => handleClick(option.id)}
        >
          {option.label}
        </button>
      ))}
      {showToast && (
        <span className="tc-coming-soon-toast">{comingSoonText}</span>
      )}
    </div>
  );
}

export default function ControlTab({
  mapVariants,
  activeMapId,
  onChangeMap,
  musicTracks = [],
  activeMusicId = '',
  onChangeMusic,
  musicEnabled = false,
  onToggleMusic,
  musicVolume = 0.4,
  onChangeMusicVolume,
  sceneNpcDisplayMode = 'all',
  onChangeSceneNpcDisplayMode,
  sceneNpcDisplayCap = 12,
  onChangeSceneNpcDisplayCap,
  minSceneNpcDisplayCap = 0,
  maxSceneNpcDisplayCap = 999,
  guardEnabled = false,
  onToggleGuard,
  townText = getAgentTownText('en'),
}) {
  const [language, setLanguage] = useState('zh-CN');
  const [density, setDensity] = useState('compact');
  const [ambientFx, setAmbientFx] = useState('normal');
  const { status: skinStatus, downloading, download: downloadSkin } = useMapSkinStatus();

  const activeMap = useMemo(
    () => mapVariants.find((item) => item.id === activeMapId) || mapVariants[0] || null,
    [activeMapId, mapVariants]
  );

  const safeMin = Math.max(0, Number(minSceneNpcDisplayCap) || 0);
  const safeMax = Math.max(safeMin, Number(maxSceneNpcDisplayCap) || 0);
  const [capDraft, setCapDraft] = useState(String(sceneNpcDisplayCap));
  const [capFocused, setCapFocused] = useState(false);

  useEffect(() => {
    if (!capFocused) setCapDraft(String(sceneNpcDisplayCap));
  }, [sceneNpcDisplayCap, capFocused]);

  const commitCap = () => {
    const raw = Number(capDraft);
    if (!Number.isFinite(raw) || capDraft.trim() === '') {
      const fallback = Math.max(safeMin, Math.min(safeMax, sceneNpcDisplayCap));
      setCapDraft(String(fallback));
      onChangeSceneNpcDisplayCap?.(fallback);
      return;
    }
    const clamped = Math.max(safeMin, Math.min(safeMax, Math.floor(raw)));
    setCapDraft(String(clamped));
    onChangeSceneNpcDisplayCap?.(clamped);
  };

  const musicSelectOptions = useMemo(
    () => musicTracks.map((track) => ({
      value: track.id,
      label: track.label,
      meta: track.fileName,
    })),
    [musicTracks],
  );

  const sceneDisplayOptions = useMemo(() => [
    { id: 'all', label: townText.control.workingAll },
    { id: 'capped', label: townText.control.customCap },
  ], [townText]);

  const languageOptions = useMemo(() => [
    { id: LANGUAGE_OPTION_IDS[0], label: townText.control.languageChinese },
    { id: LANGUAGE_OPTION_IDS[1], label: townText.control.languageEnglish },
  ], [townText]);

  const densityOptions = useMemo(() => [
    { id: DENSITY_OPTION_IDS[0], label: townText.control.densityCozy },
    { id: DENSITY_OPTION_IDS[1], label: townText.control.densityCompact },
    { id: DENSITY_OPTION_IDS[2], label: townText.control.densityDense },
  ], [townText]);

  const ambientOptions = useMemo(() => [
    { id: AMBIENT_OPTION_IDS[0], label: townText.control.ambientSoft },
    { id: AMBIENT_OPTION_IDS[1], label: townText.control.ambientBalanced },
    { id: AMBIENT_OPTION_IDS[2], label: townText.control.ambientCinematic },
  ], [townText]);

  return (
    <div className="tc-control-layout">
      <div className="tc-control-main tc-ornate-panel">
        <div className="tc-panel-microcopy">{townText.control.worldRouting}</div>
        <div className="tc-control-title-row">
          <div>
            <div className="tc-control-overline">{townText.control.sceneDeck}</div>
            <h3 className="tc-control-title">{townText.control.mapSwitching}</h3>
          </div>
          <div className="tc-control-badge">{townText.control.liveRoute}</div>
        </div>

        <div className="tc-control-description">
          {townText.control.mapDescription}
        </div>

        <div className="tc-map-option-grid">
          {mapVariants.map((map) => {
            const isActive = map.id === activeMapId;
            const needsDownload = !map.bundled && !skinStatus[map.id];
            const dl = downloading[map.id];
            const isDownloading = dl?.active;
            const dlPercent = dl?.percent || 0;

            const handleClick = () => {
              if (isDownloading) return;
              if (needsDownload) {
                downloadSkin(map.id).then((ok) => {
                  if (ok) onChangeMap(map.id);
                });
                return;
              }
              onChangeMap(map.id);
            };

            return (
              <button
                key={map.id}
                type="button"
                className={`tc-map-option ${isActive ? 'tc-map-option-active' : ''}`}
                onClick={handleClick}
              >
                <div className="tc-map-option-top">
                  <span className="tc-map-option-id">{map.label}</span>
                  {!map.bundled && needsDownload && !isDownloading && (
                    <span className="tc-map-skin-badge">DLC</span>
                  )}
                </div>
                <div className="tc-map-option-copy">
                  <div className="tc-map-option-body">{map.description}</div>
                  <div className="tc-map-option-meta">
                    <span>{map.width * map.tileWidth} × {map.height * map.tileHeight} px</span>
                  </div>
                </div>
                <div className="tc-map-option-preview">
                  {map.previewImage ? (
                    <>
                      <img
                        className="tc-map-option-preview-img"
                        src={map.previewImage}
                        alt={`${map.label} preview`}
                        draggable={false}
                      />
                      {needsDownload && (
                        <div className="tc-map-download-overlay">
                          {isDownloading ? (
                            <div className="tc-map-download-progress">
                              <CircularProgress percent={dlPercent} size={52} stroke={3.5} />
                              <span className="tc-map-download-pct">{Math.round(dlPercent)}%</span>
                            </div>
                          ) : (
                            <div className="tc-map-download-circle">
                              <svg className="tc-map-download-arrow" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="4" x2="12" y2="16" />
                                <polyline points="7 12 12 17 17 12" />
                                <line x1="6" y1="21" x2="18" y2="21" />
                              </svg>
                            </div>
                          )}
                        </div>
                      )}
                      {!needsDownload && (
                        <div className="tc-map-option-preview-caption">{townText.control.scenePreview}</div>
                      )}
                    </>
                  ) : (
                    <div className="tc-map-option-preview-empty">{townText.control.previewOffline}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="tc-control-side">
        <div className="tc-control-card tc-control-card-compact tc-ornate-panel">
          <div className="tc-panel-microcopy">{townText.control.runtimeActive}</div>
          <div className="tc-control-card-title">{townText.control.currentScene}</div>
          {activeMap ? (
            <div className="tc-control-facts">
              <div className="tc-control-fact">
                <span>{townText.control.theme}</span>
                <strong>{activeMap.label}</strong>
              </div>
              <div className="tc-control-fact">
                <span>{townText.control.description}</span>
                <strong>{activeMap.description}</strong>
              </div>
            </div>
          ) : null}
        </div>

        <div className="tc-control-card tc-control-card-scroll tc-ornate-panel">
          <div className="tc-panel-microcopy">{townText.control.audioAmbience}</div>
          <div className="tc-control-card-title">{townText.control.backgroundMusic}</div>
          <div className="tc-control-scroll-area">
            <div className="tc-control-setting">
              <span className="tc-control-setting-label">{townText.control.playback}</span>
              <div className="tc-control-toggle-row">
                <ImageSwitch
                  checked={musicEnabled}
                  onClick={onToggleMusic}
                  label="BGM"
                  onText="ON"
                  offText="OFF"
                />
                <span className="tc-control-inline-value">
                  {musicTracks.find((track) => track.id === activeMusicId)?.label || musicTracks[0]?.label || '—'}
                </span>
              </div>
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">{townText.control.trackSelect}</span>
              <PixelSelect
                options={musicSelectOptions}
                value={activeMusicId}
                onChange={onChangeMusic}
                placeholder={townText.control.selectTrack}
              />
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">{townText.control.volume}</span>
              <div className="tc-control-slider-row">
                <input
                  className="tc-control-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={musicVolume}
                  onChange={(event) => onChangeMusicVolume?.(Number(event.target.value))}
                />
                <span className="tc-control-inline-value">{Math.round(musicVolume * 100)}%</span>
              </div>
            </div>

            <div className="tc-panel-microcopy">{townText.control.sceneDisplay}</div>
            <div className="tc-control-card-title">{townText.control.onMapAgents}</div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">{townText.control.renderMode}</span>
              <OptionChipGroup
                options={sceneDisplayOptions}
                value={sceneNpcDisplayMode}
                onChange={(next) => onChangeSceneNpcDisplayMode?.(next)}
              />
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">{townText.control.visibleCap}</span>
              <input
                className="tc-scene-cap-input"
                type="number"
                min={safeMin}
                max={safeMax}
                step="1"
                value={capDraft}
                disabled={sceneNpcDisplayMode !== 'capped'}
                onChange={(e) => setCapDraft(e.target.value)}
                onFocus={() => setCapFocused(true)}
                onBlur={() => { setCapFocused(false); commitCap(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
              />
              <div className="tc-scene-cap-hint">
                {sceneNpcDisplayMode === 'capped'
                  ? `${townText.control.rangeHint}: ${safeMin} - ${safeMax} (pending: ${safeMin}, eligible: ${safeMax})`
                  : townText.control.allAgentsHint}
              </div>
            </div>

            <div className="tc-panel-microcopy">{townText.control.uiPlaceholders}</div>
            <div className="tc-control-card-title">{townText.control.generalControls}</div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">{townText.control.language}</span>
              <OptionChipGroup options={languageOptions} value={language} onChange={setLanguage} comingSoon comingSoonText={townText.control.comingSoon} />
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">{townText.control.consoleDensity}</span>
              <OptionChipGroup options={densityOptions} value={density} onChange={setDensity} comingSoon comingSoonText={townText.control.comingSoon} />
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">{townText.control.ambientFx}</span>
              <OptionChipGroup options={ambientOptions} value={ambientFx} onChange={setAmbientFx} comingSoon comingSoonText={townText.control.comingSoon} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
