import { useState } from 'react';
import type { CSSProperties } from 'react';
import IntroScreen from '../components/IntroScreen';

const shellStyle: CSSProperties = {
  minHeight: '100vh',
  background: '#070b14',
  color: '#f8fafc',
  fontFamily: 'system-ui, sans-serif',
};

const controlsStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 10001,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const noteStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  background: 'rgba(7, 11, 20, 0.82)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  fontSize: 12,
  lineHeight: 1.35,
};

const buttonStyle: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255, 255, 255, 0.16)',
  background: 'rgba(17, 24, 39, 0.9)',
  color: '#f8fafc',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function IntroPreview() {
  const [replayKey, setReplayKey] = useState(0);
  return (
    <div style={shellStyle}>
      <IntroScreen key={replayKey} />
      <div style={controlsStyle}>
        <div style={noteStyle}>Temporary intro preview route</div>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => setReplayKey((key) => key + 1)}
        >
          Replay intro
        </button>
      </div>
    </div>
  );
}
