import { useEffect, useMemo, useState } from 'react';

const TARGET_TIME = new Date(2026, 2, 16, 0, 0, 0).getTime();

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function getRemainingSeconds() {
  return Math.max(0, Math.floor((TARGET_TIME - Date.now()) / 1000));
}

function formatCountdown(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return { h: pad(h), m: pad(m), s: pad(s) };
}

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  phase: number;
}

function useStars(count: number): Star[] {
  return useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: 1 + Math.random() * 2,
        speed: 0.4 + Math.random() * 1.2,
        opacity: 0.3 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
      })),
    [count],
  );
}

export default function World() {
  const [remaining, setRemaining] = useState(getRemainingSeconds);

  useEffect(() => {
    const tick = () => setRemaining(getRemainingSeconds());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const { h, m, s } = formatCountdown(remaining);
  const stars = useStars(80);
  const openMockPreview = () => {
    window.location.href = '/agent-town.html';
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .world-root {
          position: fixed; inset: 0;
          background: #0a0a12;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          overflow: hidden;
          font-family: 'Press Start 2P', monospace;
          image-rendering: pixelated;
        }
        .world-bg {
          position: absolute; inset: 0;
          background: url('/qkaX8fZ3Kiwpzwvy8dRct_Zi1wtZD8.png') center/cover no-repeat;
          z-index: 0;
        }
        .world-overlay {
          position: absolute; inset: 0;
          background: rgba(8, 8, 16, 0.72);
          z-index: 1;
        }

        /* ── Stars ── */
        .star {
          position: absolute;
          border-radius: 0;
          background: #fff;
          z-index: 2;
          animation: twinkle var(--dur) ease-in-out infinite;
          animation-delay: var(--delay);
        }
        @keyframes twinkle {
          0%, 100% { opacity: var(--lo); }
          50%      { opacity: var(--hi); }
        }

        /* ── Scanlines ── */
        .scanlines {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.12) 2px,
            rgba(0,0,0,0.12) 4px
          );
          pointer-events: none;
          z-index: 10;
        }

        /* ── Glow halo behind title ── */
        .glow-halo {
          position: absolute;
          width: 600px; height: 200px;
          border-radius: 50%;
          background: radial-gradient(ellipse, rgba(109,99,255,0.18) 0%, transparent 70%);
          filter: blur(40px);
          pointer-events: none;
        }

        /* ── Title ── */
        .title {
          position: relative;
          z-index: 2;
          font-size: clamp(16px, 3.2vw, 36px);
          color: #fff;
          text-align: center;
          letter-spacing: 3px;
          text-shadow:
            0 0 6px rgba(109,99,255,0.7),
            0 0 20px rgba(109,99,255,0.4),
            0 0 60px rgba(109,99,255,0.2);
          animation: titlePulse 4s ease-in-out infinite;
        }
        @keyframes titlePulse {
          0%, 100% { text-shadow: 0 0 6px rgba(109,99,255,0.7), 0 0 20px rgba(109,99,255,0.4), 0 0 60px rgba(109,99,255,0.2); }
          50%      { text-shadow: 0 0 10px rgba(109,99,255,0.9), 0 0 30px rgba(109,99,255,0.6), 0 0 80px rgba(109,99,255,0.35); }
        }

        /* ── Subtitle ── */
        .subtitle {
          position: relative; z-index: 2;
          margin-top: 18px;
          font-size: clamp(6px, 1vw, 10px);
          color: rgba(255,255,255,0.35);
          letter-spacing: 6px;
          text-transform: uppercase;
        }

        /* ── Countdown ── */
        .cd-wrap {
          position: relative; z-index: 2;
          margin-top: 56px;
          display: flex; align-items: center; gap: 6px;
        }
        .cd-block {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          min-width: 80px;
        }
        .cd-num {
          font-size: clamp(24px, 5vw, 56px);
          color: #e8c860;
          text-shadow:
            0 0 8px rgba(232,200,96,0.6),
            0 0 24px rgba(232,200,96,0.3);
          line-height: 1;
          animation: numGlow 2s ease-in-out infinite;
        }
        @keyframes numGlow {
          0%, 100% { text-shadow: 0 0 8px rgba(232,200,96,0.6), 0 0 24px rgba(232,200,96,0.3); }
          50%      { text-shadow: 0 0 12px rgba(232,200,96,0.85), 0 0 36px rgba(232,200,96,0.5); }
        }
        .cd-label {
          font-size: clamp(5px, 0.7vw, 8px);
          color: rgba(255,255,255,0.3);
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        .cd-sep {
          font-size: clamp(20px, 4vw, 44px);
          color: rgba(232,200,96,0.45);
          align-self: flex-start;
          margin-top: 4px;
          animation: sepBlink 1s step-end infinite;
        }
        @keyframes sepBlink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.2; }
        }

        /* ── Bottom bar ── */
        .bottom-bar {
          position: absolute; bottom: 0; left: 0; right: 0;
          height: 3px;
          background: linear-gradient(90deg,
            transparent 0%,
            rgba(109,99,255,0.5) 20%,
            rgba(232,200,96,0.6) 50%,
            rgba(109,99,255,0.5) 80%,
            transparent 100%
          );
          z-index: 10;
        }

        /* ── Pixel border frame ── */
        .pixel-frame {
          position: absolute; inset: 16px;
          border: 2px solid rgba(109,99,255,0.12);
          pointer-events: none; z-index: 5;
        }
        .pixel-frame::before,
        .pixel-frame::after {
          content: '';
          position: absolute;
          background: rgba(109,99,255,0.25);
        }
        .pixel-frame::before {
          top: -2px; left: -2px;
          width: 12px; height: 12px;
          border-top: 2px solid rgba(109,99,255,0.35);
          border-left: 2px solid rgba(109,99,255,0.35);
          background: none;
        }
        .pixel-frame::after {
          bottom: -2px; right: -2px;
          width: 12px; height: 12px;
          border-bottom: 2px solid rgba(109,99,255,0.35);
          border-right: 2px solid rgba(109,99,255,0.35);
          background: none;
        }

        /* ── Status line ── */
        .status-line {
          position: relative; z-index: 2;
          margin-top: 40px;
          display: flex; align-items: center; gap: 8px;
          font-size: clamp(5px, 0.65vw, 8px);
          color: rgba(34,197,94,0.7);
          letter-spacing: 1px;
        }
        .preview-entry {
          position: relative;
          z-index: 2;
          margin-top: 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          min-width: 260px;
          min-height: 58px;
          padding: 10px 18px 9px;
          border: 2px solid rgba(232,200,96,0.42);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.05)),
            linear-gradient(180deg, rgba(88,64,140,0.98), rgba(45,31,82,0.99));
          color: #f6e7c8;
          font-family: 'Press Start 2P', monospace;
          font-size: clamp(6px, 0.72vw, 9px);
          letter-spacing: 0.8px;
          text-transform: uppercase;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.28),
            0 0 0 1px rgba(109,99,255,0.18),
            0 14px 30px rgba(8,8,16,0.34);
          cursor: pointer;
          transition: transform 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
          overflow: hidden;
        }
        .preview-entry::before {
          content: '';
          position: absolute;
          inset: 4px;
          border: 1px solid rgba(255,241,207,0.18);
          pointer-events: none;
        }
        .preview-entry::after {
          content: '';
          position: absolute;
          left: 12px;
          right: 12px;
          top: 7px;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(255,243,219,0.95), transparent);
          opacity: 0.86;
          pointer-events: none;
        }
        .preview-entry:hover {
          transform: translateY(-2px);
          filter: brightness(1.06);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.32),
            0 0 0 1px rgba(232,200,96,0.22),
            0 18px 38px rgba(8,8,16,0.44);
        }
        .preview-entry-dot {
          width: 10px;
          height: 10px;
          background: #e8c860;
          box-shadow:
            0 0 8px rgba(232,200,96,0.6),
            0 0 18px rgba(232,200,96,0.28);
          position: relative;
          z-index: 1;
          flex-shrink: 0;
        }
        .preview-entry-copy {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
          text-align: left;
        }
        .preview-entry-overline {
          color: rgba(255,255,255,0.42);
          font-size: clamp(5px, 0.56vw, 7px);
          letter-spacing: 1.4px;
        }
        .preview-entry-title {
          color: #f7e7c5;
          font-size: clamp(7px, 0.9vw, 10px);
          letter-spacing: 1px;
          text-shadow:
            0 0 6px rgba(232,200,96,0.22),
            0 0 18px rgba(109,99,255,0.18);
        }
        .preview-entry-sub {
          color: rgba(232,200,96,0.8);
          font-size: clamp(5px, 0.58vw, 7px);
          letter-spacing: 1px;
        }
        .status-dot {
          width: 6px; height: 6px;
          background: #22c55e;
          border-radius: 0;
          animation: statusPulse 1.5s ease-in-out infinite;
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(34,197,94,0.6); }
          50%      { opacity: 0.4; box-shadow: none; }
        }

        /* ── Floating pixel particles ── */
        .particle {
          position: absolute;
          width: 2px; height: 2px;
          background: rgba(109,99,255,0.4);
          z-index: 2;
          animation: float var(--fdur) linear infinite;
          animation-delay: var(--fdelay);
        }
        @keyframes float {
          0%   { transform: translateY(0) scale(1); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(-120vh) scale(0.5); opacity: 0; }
        }
      `}</style>

      <div className="world-root">
        <div className="world-bg" />
        <div className="world-overlay" />
        <div className="scanlines" />
        <div className="pixel-frame" />
        <div className="bottom-bar" />

        {stars.map((star, i) => (
          <div
            key={i}
            className="star"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: star.size,
              height: star.size,
              '--dur': `${star.speed}s`,
              '--delay': `${star.phase}s`,
              '--lo': star.opacity * 0.2,
              '--hi': star.opacity,
            } as React.CSSProperties}
          />
        ))}

        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={`p${i}`}
            className="particle"
            style={{
              left: `${8 + Math.random() * 84}%`,
              bottom: '-4px',
              '--fdur': `${6 + Math.random() * 10}s`,
              '--fdelay': `${Math.random() * 8}s`,
            } as React.CSSProperties}
          />
        ))}

        <div className="glow-halo" />

        <div className="title">Welcome to Agent Town</div>
        <div className="subtitle">Systems Initializing</div>

        <div className="cd-wrap">
          <div className="cd-block">
            <span className="cd-num">{h}</span>
            <span className="cd-label">Hours</span>
          </div>
          <span className="cd-sep">:</span>
          <div className="cd-block">
            <span className="cd-num">{m}</span>
            <span className="cd-label">Min</span>
          </div>
          <span className="cd-sep">:</span>
          <div className="cd-block">
            <span className="cd-num">{s}</span>
            <span className="cd-label">Sec</span>
          </div>
        </div>

        <div className="status-line">
          <span className="status-dot" />
          <span>BUILDING WORLD — STAND BY</span>
        </div>

        <button type="button" className="preview-entry" onClick={openMockPreview}>
          <span className="preview-entry-dot" />
          <span className="preview-entry-copy">
            <span className="preview-entry-overline">Preview Channel</span>
            <span className="preview-entry-title">Mock Preview</span>
            <span className="preview-entry-sub">Enter Agent Town Build</span>
          </span>
        </button>
      </div>
    </>
  );
}
