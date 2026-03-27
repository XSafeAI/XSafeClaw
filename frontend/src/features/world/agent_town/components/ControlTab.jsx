import { useMemo, useState } from 'react';
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
  guardEnabled = false,
  onToggleGuard,
}) {
  const [language, setLanguage] = useState('zh-CN');
  const [density, setDensity] = useState('compact');
  const [ambientFx, setAmbientFx] = useState('normal');

  const activeMap = useMemo(
    () => mapVariants.find((item) => item.id === activeMapId) || mapVariants[0] || null,
    [activeMapId, mapVariants]
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
            return (
              <button
                key={map.id}
                type="button"
                className={`tc-map-option ${isActive ? 'tc-map-option-active' : ''}`}
                onClick={() => onChangeMap(map.id)}
              >
                <div className="tc-map-option-top">
                  <span className="tc-map-option-id">{map.label}</span>
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
                      <div className="tc-map-option-preview-caption">Scene Preview</div>
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
                  {musicTracks.find((track) => track.id === activeMusicId)?.label || 'Home'}
                </span>
              </div>
            </div>

            <div className="tc-control-setting">
              <span className="tc-control-setting-label">Track Select</span>
              <div className="tc-music-list">
                {musicTracks.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    className={`tc-music-option ${track.id === activeMusicId ? 'tc-music-option-active' : ''}`}
                    onClick={() => onChangeMusic?.(track.id)}
                  >
                    <span className="tc-music-option-name">{track.label}</span>
                    <span className="tc-music-option-file">{track.fileName}</span>
                  </button>
                ))}
              </div>
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
