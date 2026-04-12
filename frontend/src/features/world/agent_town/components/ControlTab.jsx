import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ImageSwitch from './ImageSwitch';

const LANGUAGE_OPTIONS = [
  { id: 'zh-CN', label: 'Chinese' },
  { id: 'en-US', label: 'English' },
];

const DENSITY_OPTIONS = [
  { id: 'cozy', label: 'Cozy' },
  { id: 'compact', label: 'Compact' },
  { id: 'dense', label: 'Dense' },
];

const AMBIENT_OPTIONS = [
  { id: 'soft', label: 'Soft FX' },
  { id: 'normal', label: 'Balanced FX' },
  { id: 'cinematic', label: 'Cinematic FX' },
];

const SCENE_DISPLAY_OPTIONS = [
  { id: 'all', label: 'Working All' },
  { id: 'capped', label: 'Custom Cap' },
];

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

function useMapSkinStatus() {
  const [status, setStatus] = useState({});
  const [downloading, setDownloading] = useState({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/map-skins/status');
      if (!res.ok) return;
      const data = await res.json();
      const map = {};
      for (const s of data) map[s.id] = s.downloaded;
      setStatus(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const download = useCallback(async (mapId) => {
    setDownloading((prev) => ({ ...prev, [mapId]: { active: true, percent: 0 } }));
    try {
      const res = await fetch(`/api/map-skins/download/${mapId}`, { method: 'POST' });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.phase === 'downloading') {
              setDownloading((prev) => ({ ...prev, [mapId]: { active: true, percent: evt.percent } }));
            } else if (evt.phase === 'done') {
              setDownloading((prev) => ({ ...prev, [mapId]: { active: false, percent: 100 } }));
              setStatus((prev) => ({ ...prev, [mapId]: true }));
            } else if (evt.phase === 'error') {
              setDownloading((prev) => ({ ...prev, [mapId]: { active: false, percent: 0, error: evt.message } }));
            }
          } catch { /* skip bad json */ }
        }
      }
    } catch (err) {
      setDownloading((prev) => ({ ...prev, [mapId]: { active: false, percent: 0, error: err.message } }));
    }
  }, []);

  return { status, downloading, download, refresh };
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

function OptionChipGroup({ options, value, onChange, comingSoon = false }) {
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
        <span className="tc-coming-soon-toast">Coming Soon</span>
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

  return (
    <div className="tc-control-layout">
      <div className="tc-control-main tc-ornate-panel">
        <div className="tc-panel-microcopy">WORLD / MAP ROUTING</div>
        <div className="tc-control-title-row">
          <div>
            <div className="tc-control-overline">Scene Deck</div>
            <h3 className="tc-control-title">Map Switching</h3>
          </div>
          <div className="tc-control-badge">LIVE ROUTE</div>
        </div>

        <div className="tc-control-description">
          {`Map_opensource.tmj`} now drives all five world skins. The switch below changes the rendered layer and
          its matching collision grid so the town keeps the same navigation chain while swapping theme.
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
                downloadSkin(map.id);
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
                        <div className="tc-map-option-preview-caption">Scene Preview</div>
                      )}
                    </>
                  ) : (
                    <div className="tc-map-option-preview-empty">Preview offline</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="tc-control-side">
        <div className="tc-control-card tc-control-card-compact tc-ornate-panel">
          <div className="tc-panel-microcopy">RUNTIME / ACTIVE</div>
          <div className="tc-control-card-title">Current Scene</div>
          {activeMap ? (
            <div className="tc-control-facts">
              <div className="tc-control-fact">
                <span>Theme</span>
                <strong>{activeMap.label}</strong>
              </div>
              <div className="tc-control-fact">
                <span>Description</span>
                <strong>{activeMap.description}</strong>
              </div>
            </div>
          ) : null}
        </div>

        <div className="tc-control-card tc-control-card-scroll tc-ornate-panel">
          <div className="tc-panel-microcopy">AUDIO / AMBIENCE</div>
          <div className="tc-control-card-title">Background Music</div>
          <div className="tc-control-scroll-area">
            <div className="tc-control-setting">
              <span className="tc-control-setting-label">Playback</span>
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
              <span className="tc-control-setting-label">Track Select</span>
              <PixelSelect
                options={musicSelectOptions}
                value={activeMusicId}
                onChange={onChangeMusic}
                placeholder="Select track"
              />
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">Volume</span>
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

            <div className="tc-panel-microcopy">SCENE / DISPLAY</div>
            <div className="tc-control-card-title">On-map Agents</div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">Render Mode</span>
              <OptionChipGroup
                options={SCENE_DISPLAY_OPTIONS}
                value={sceneNpcDisplayMode}
                onChange={(next) => onChangeSceneNpcDisplayMode?.(next)}
              />
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">Visible Cap</span>
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
                  ? `Range: ${safeMin} – ${safeMax} (pending: ${safeMin}, eligible: ${safeMax})`
                  : 'All qualifying agents are rendered on-map without a custom cap.'}
              </div>
            </div>

            <div className="tc-panel-microcopy">UI / PLACEHOLDERS</div>
            <div className="tc-control-card-title">General Controls</div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">Language</span>
              <OptionChipGroup options={LANGUAGE_OPTIONS} value={language} onChange={setLanguage} comingSoon />
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">Console Density</span>
              <OptionChipGroup options={DENSITY_OPTIONS} value={density} onChange={setDensity} comingSoon />
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">Ambient FX</span>
              <OptionChipGroup options={AMBIENT_OPTIONS} value={ambientFx} onChange={setAmbientFx} comingSoon />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
