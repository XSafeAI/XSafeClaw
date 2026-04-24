import React from 'react';
import { formatAgentDisplayName } from '../config/constants';

function safeStr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDur(s) {
  if (!s) return '–';
  if (s < 60) return s.toFixed(0) + 's';
  return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
}

/**
 * Hover tooltip that follows the NPC position.
 * Props: data = { data: { agent, state, snippet, event }, pos: { x, y } } | null
 */
export default function Tooltip({ data }) {
  if (!data) return null;

  const { agent, state, snippet, event } = data.data;
  const { x, y } = data.pos;

  return (
    <div
      className="tooltip"
      style={{
        display: 'block',
        left: x + 'px',
        top: y + 'px',
      }}
    >
      <div className="ttName">
        <span className={`dot dot-${state}`} />
        {safeStr(formatAgentDisplayName(agent))}
      </div>
      <div className="ttMeta">
        {safeStr(agent.provider)} · {safeStr(agent.model || '')} · {state}
      </div>
      {event && (
        <div className="ttMeta" style={{ color: '#b2773f' }}>
          {safeStr(event.event_type)} · {fmtDur(event.duration)}
        </div>
      )}
      {snippet && <div className="ttSnippet">{safeStr(snippet)}</div>}
    </div>
  );
}
