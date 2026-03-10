import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity, MessageSquare, Wrench, Clock,
  User, Bot, Terminal,
  RefreshCw, Zap, Users, ListChecks, ShieldCheck,
  Plus, Minus, Maximize2, X, Filter,
} from 'lucide-react';
import { sessionsAPI, eventsAPI, statsAPI } from '../services/api';
import api from '../services/api';
import ActivityTab from './ActivityTab';

/* ============ Types ============ */
interface SessionItem {
  session_id: string;
  first_seen_at: string;
  last_activity_at: string;
  cwd: string;
  current_model_provider: string;
  current_model_name: string;
  total_runs: number;
  total_tokens: number;
}

interface EventItem {
  id: string;
  session_id: string;
  user_message_id: string;
  started_at: string;
  completed_at: string | null;
  total_messages: number;
  total_tool_calls: number;
  total_tokens: number;
  tool_call_ids: string[] | null;
  status: string;
}

interface EventToolCall {
  id: string;
  tool_name: string;
  arguments: Record<string, any> | null;
}

interface EventMessage {
  message_id: string;
  role: string;
  timestamp: string;
  content_text: string | null;
  tool_calls_count: number;
  tool_call_ids: string[];
  tool_calls?: EventToolCall[];
}

type SessionFilter = 'active' | 'today' | 'all';

const FILTER_OPTIONS: { id: SessionFilter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'today',  label: 'Today' },
  { id: 'all',    label: 'All' },
];

/* ============ Color Palette ============ */
const SESSION_COLORS = [
  { bg: 'rgba(52, 211, 153, 0.18)', border: '#34d399', text: '#34d399' },
  { bg: 'rgba(167, 139, 250, 0.18)', border: '#a78bfa', text: '#a78bfa' },
  { bg: 'rgba(96, 165, 250, 0.18)', border: '#60a5fa', text: '#60a5fa' },
  { bg: 'rgba(251, 191, 36, 0.18)', border: '#fbbf24', text: '#fbbf24' },
  { bg: 'rgba(248, 113, 113, 0.18)', border: '#f87171', text: '#f87171' },
  { bg: 'rgba(45, 212, 191, 0.18)', border: '#2dd4bf', text: '#2dd4bf' },
  { bg: 'rgba(244, 114, 182, 0.18)', border: '#f472b6', text: '#f472b6' },
  { bg: 'rgba(232, 121, 249, 0.18)', border: '#e879f9', text: '#e879f9' },
];

/* ============ Helpers ============ */
function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K tokens`;
  return `${n} tokens`;
}

function formatTimeLabel(date: Date, rangeMs: number): string {
  if (rangeMs < 60_000) {
    // < 1 min → HH:MM:SS.mmm
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  if (rangeMs < 3600_000) {
    // < 1 hour → HH:MM:SS
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  if (rangeMs < 86400_000) {
    // < 1 day → HH:MM
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  // > 1 day → MM/DD HH:MM
  return (
    date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }) +
    ' ' +
    date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function durationStr(startStr: string, endStr: string | null): string {
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/** Determine which sessions are "active" based on their most-recent event time. */
function classifyActiveSessions(events: EventItem[], cutoffMs: number): Set<string> {
  const latestPerSession = new Map<string, number>();
  events.forEach(e => {
    const t = new Date(e.started_at).getTime();
    const prev = latestPerSession.get(e.session_id) ?? 0;
    if (t > prev) latestPerSession.set(e.session_id, t);
  });
  const active = new Set<string>();
  const now = Date.now();
  latestPerSession.forEach((t, sid) => {
    if (now - t <= cutoffMs) active.add(sid);
  });
  return active;
}

/* ============ Sub-Components ============ */
const roleConfig: Record<string, { icon: typeof User; color: string; bg: string; label: string }> = {
  user:       { icon: User,     color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',    label: 'User' },
  assistant:  { icon: Bot,      color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Assistant' },
  toolResult: { icon: Terminal,  color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',  label: 'Tool Result' },
};

function MessageBubble({ msg }: { msg: EventMessage }) {
  const config = roleConfig[msg.role] || roleConfig.assistant;
  const Icon = config.icon;
  const text = msg.content_text || '';
  const truncated = text.length > 300 ? text.slice(0, 300) + '…' : text;
  const [expanded, setExpanded] = useState(false);
  const toolCalls = msg.tool_calls || [];

  return (
    <div className={`border rounded-lg p-3 ${config.bg}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${config.color}`}><Icon className="w-4 h-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold ${config.color}`}>{config.label}</span>
            <span className="text-[10px] text-text-muted">{formatDate(msg.timestamp)}</span>
            {msg.tool_calls_count > 0 && (
              <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full">
                {msg.tool_calls_count} tool call{msg.tool_calls_count > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {text && (
            <div className="text-sm text-text-secondary whitespace-pre-wrap break-words">
              {expanded ? text : truncated}
              {text.length > 300 && (
                <button onClick={() => setExpanded(!expanded)} className="ml-1 text-xs text-accent hover:text-accent-dim">
                  {expanded ? 'collapse' : 'more'}
                </button>
              )}
            </div>
          )}
          {/* Tool call details */}
          {toolCalls.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {toolCalls.map(tc => (
                <div key={tc.id} className="rounded-md border border-purple-500/20 bg-purple-500/5 p-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/25">
                      <Wrench className="w-2.5 h-2.5" /> {tc.tool_name}
                    </span>
                    <code className="text-[10px] font-mono text-text-muted">{tc.id}</code>
                  </div>
                  {tc.arguments && (
                    <pre className="mt-1.5 text-[11px] text-text-secondary bg-surface-0/60 rounded-md p-2 whitespace-pre-wrap break-words max-h-[150px] overflow-y-auto font-mono">
                      {JSON.stringify(tc.arguments, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Time Axis bar (top / bottom) --- */
function TimeAxis({ ticks, labelWidth }: { ticks: { pct: number; label: string }[]; labelWidth: number }) {
  return (
    <div className="flex">
      <div
        className="shrink-0 bg-surface-0 border-r border-border sticky left-0 z-10"
        style={{ width: labelWidth }}
      />
      <div className="flex-1 bg-surface-0 relative h-8 select-none">
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute top-1/2 text-[10px] font-semibold text-text-muted whitespace-nowrap"
            style={{
              left: `${t.pct}%`,
              transform: `translate(${i === ticks.length - 1 ? '-100%' : i === 0 ? '4px' : '-50%'}, -50%)`,
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ============ Tab Config ============ */
const monitorTabs = [
  { id: 'world',    name: 'Town',      icon: Activity },
  { id: 'agent',    name: 'Agents',     icon: Users },
  { id: 'activity', name: 'Activities', icon: ListChecks },
  { id: 'approval', name: 'Pending Approvals',   icon: ShieldCheck },
] as const;
type MonitorTabId = (typeof monitorTabs)[number]['id'];

/* ============ Main Page ============ */
export default function Monitor() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as MonitorTabId | null) ?? 'agent';
  const [activeTab, setActiveTab] = useState<MonitorTabId>(
    monitorTabs.some(t => t.id === initialTab) ? initialTab : 'agent'
  );
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [eventMessages, setEventMessages] = useState<EventMessage[]>([]);
  const [stats, setStats] = useState({ sessions: 0, messages: 0, tools: 0, events: 0 });
  const [loading, setLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('active');
  const scrollRef = useRef<HTMLDivElement>(null);

  /* ---------- Data fetching ---------- */
  const fetchData = useCallback(async () => {
    try {
      const [sessRes, statsRes, eventsRes] = await Promise.all([
        sessionsAPI.list({ page: 1, page_size: 50 }),
        statsAPI.overview().catch(() => ({ data: {} as any })),
        api.get('/events/', { params: { limit: 100 } }).catch(() => ({ data: { events: [] } })),
      ]);

      const items = sessRes.data.items || sessRes.data;
      // Handle both possible response shapes
      const sessionList: any[] = Array.isArray(items) ? items : [];
      // Normalize: API may return { sessions: [...] }
      const rawSessions = (sessRes.data as any).sessions || sessionList;
      setSessions(Array.isArray(rawSessions) ? rawSessions : []);

      const evts = eventsRes.data.events || eventsRes.data;
      setAllEvents(Array.isArray(evts) ? evts : []);

      const s = statsRes.data;
      setStats({
        sessions: s.total_sessions ?? 0,
        messages: s.total_messages ?? 0,
        tools:    s.total_tool_calls ?? 0,
        events:   s.total_events ?? 0,
      });
    } catch (err) {
      console.error('Failed to fetch data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 5_000); return () => clearInterval(t); }, [fetchData]);

  /* Load event messages on select */
  useEffect(() => {
    if (!selectedEvent) { setEventMessages([]); return; }
    eventsAPI.get(selectedEvent.id)
      .then(r => setEventMessages(r.data.messages || []))
      .catch(() => setEventMessages([]));
  }, [selectedEvent]);

  /* ---------- Session filter sets ---------- */
  const activeSessionIds = useMemo(() => classifyActiveSessions(allEvents, 3600_000), [allEvents]);       // last 1h
  const todaySessionIds  = useMemo(() => classifyActiveSessions(allEvents, 86400_000), [allEvents]);      // last 24h

  /* ---------- Derived timeline data ---------- */
  const eventsBySession = useMemo(() => {
    const m = new Map<string, EventItem[]>();
    allEvents.forEach(e => { if (!m.has(e.session_id)) m.set(e.session_id, []); m.get(e.session_id)!.push(e); });
    m.forEach(list => list.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()));
    return m;
  }, [allEvents]);

  /* Build ALL rows: every session that has events, ordered by most-recent-event time (newest first) */
  const allRows = useMemo(() => {
    const sessionMap = new Map(sessions.map(s => [s.session_id, s]));
    const ids = [...eventsBySession.keys()];
    // sort by latest event time (newest first)
    ids.sort((a, b) => {
      const evtsA = eventsBySession.get(a)!;
      const evtsB = eventsBySession.get(b)!;
      const latestA = new Date(evtsA[evtsA.length - 1].started_at).getTime();
      const latestB = new Date(evtsB[evtsB.length - 1].started_at).getTime();
      return latestB - latestA;
    });
    return ids.map(id => ({
      session: sessionMap.get(id),
      sessionId: id,
      events: eventsBySession.get(id)!,
    }));
  }, [sessions, eventsBySession]);

  /* Filtered rows based on session filter */
  const visibleRows = useMemo(() => {
    if (sessionFilter === 'all') return allRows;
    const allowed = sessionFilter === 'active' ? activeSessionIds : todaySessionIds;
    const filtered = allRows.filter(r => allowed.has(r.sessionId));
    // If "active" is empty, fall back to "today"; if that's also empty, show all
    if (filtered.length === 0 && sessionFilter === 'active') {
      const todayFiltered = allRows.filter(r => todaySessionIds.has(r.sessionId));
      return todayFiltered.length > 0 ? todayFiltered : allRows;
    }
    return filtered.length > 0 ? filtered : allRows;
  }, [allRows, sessionFilter, activeSessionIds, todaySessionIds]);

  /* Events from visible rows only */
  const visibleEvents = useMemo(() => {
    const sidSet = new Set(visibleRows.map(r => r.sessionId));
    return allEvents.filter(e => sidSet.has(e.session_id));
  }, [allEvents, visibleRows]);

  /* Time range from VISIBLE events only */
  const { gStart, rangeMs } = useMemo(() => {
    if (visibleEvents.length === 0) return { gStart: Date.now(), rangeMs: 1000 };
    let lo = Infinity, hi = -Infinity;
    visibleEvents.forEach(e => {
      const s = new Date(e.started_at).getTime();
      const c = e.completed_at ? new Date(e.completed_at).getTime() : Date.now();
      if (s < lo) lo = s;
      if (c > hi) hi = c;
    });
    const r = hi - lo || 1000;
    const pad = Math.max(r * 0.05, 5000); // at least 5 seconds of padding
    return { gStart: lo - pad, rangeMs: r + pad * 2 };
  }, [visibleEvents]);

  /* Time ticks — more ticks for finer granularity */
  const ticks = useMemo(() => {
    const n = Math.max(6, Math.round(10 * zoomLevel));
    const arr: { pct: number; label: string }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = gStart + (rangeMs * i) / n;
      arr.push({
        pct: (i / n) * 100,
        label: i === 0 ? 'Start' : i === n ? 'End' : formatTimeLabel(new Date(t), rangeMs),
      });
    }
    return arr;
  }, [gStart, rangeMs, zoomLevel]);

  /* Color per session (based on visible rows index) */
  const colorOf = useCallback((sid: string) => {
    const idx = visibleRows.findIndex(r => r.sessionId === sid);
    return SESSION_COLORS[(idx >= 0 ? idx : 0) % SESSION_COLORS.length];
  }, [visibleRows]);

  /* Event bar position */
  const barPos = useCallback((ev: EventItem) => {
    const s = new Date(ev.started_at).getTime();
    const e = ev.completed_at ? new Date(ev.completed_at).getTime() : Date.now();
    const left = ((s - gStart) / rangeMs) * 100;
    const width = Math.max(((e - s) / rangeMs) * 100, 1.2);
    return { left, width };
  }, [gStart, rangeMs]);

  /* Zoom */
  const zoomIn  = () => setZoomLevel(z => Math.min(z * 1.5, 10));
  const zoomOut = () => setZoomLevel(z => Math.max(z / 1.5, 1));
  const fitAll  = () => setZoomLevel(1);

  /* ---------- Render ---------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <RefreshCw className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  const LABEL_W = 152;
  const tabCounts: Record<MonitorTabId, number> = { world: 0, agent: stats.sessions, activity: stats.events, approval: 0 };

  return (
    <div className="min-h-screen">
      {/* ===== Header ===== */}
      <div className="border-b border-border">
        <div className="px-8 py-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-text-primary">Claw Monitor</h1>
            <span className="text-[11px] font-semibold border border-success/40 text-success px-3 py-1 rounded-full uppercase tracking-wider">
              Running
            </span>
          </div>
          <p className="text-[13px] text-text-muted mt-2">
            Real-time monitoring of agent chats, tasks, and tool call activities.
          </p>
        </div>
        <div className="px-8 flex items-center gap-1">
          {monitorTabs.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors
                  ${active ? 'text-accent border-accent' : 'text-text-muted border-transparent hover:text-text-secondary hover:border-border'}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.name}
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md min-w-[22px] text-center
                  ${active ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-text-muted'}`}>
                  {tabCounts[tab.id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== Content ===== */}
      <div className="p-6">

        {/* ========== Tab: World ========== */}
        {activeTab === 'world' && (
          <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-text-muted select-none">
            <Activity className="w-12 h-12 opacity-20" />
            <p className="text-sm opacity-40">Town view — coming soon</p>
          </div>
        )}

        {/* ========== Tab: Agent — Timeline ========== */}
        {activeTab === 'agent' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-text-primary">Timeline</h2>
                <span className="text-[11px] text-text-muted">
                  {visibleRows.length} session{visibleRows.length !== 1 && 's'} · {visibleEvents.length} task{visibleEvents.length !== 1 && 's'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Session filter */}
                <div className="flex items-center gap-0.5 bg-surface-1 border border-border rounded-lg p-0.5">
                  <Filter className="w-3.5 h-3.5 text-text-muted ml-2 mr-1" />
                  {FILTER_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setSessionFilter(opt.id)}
                      className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all
                        ${sessionFilter === opt.id
                          ? 'bg-accent/15 text-accent shadow-sm'
                          : 'text-text-muted hover:text-text-secondary'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Zoom controls */}
                <button onClick={zoomIn} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors" title="Zoom in">
                  <Plus className="w-4 h-4" />
                </button>
                <button onClick={zoomOut} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors" title="Zoom out">
                  <Minus className="w-4 h-4" />
                </button>
                <button onClick={fitAll} className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors text-[12px] font-medium" title="Fit to view">
                  <Maximize2 className="w-3.5 h-3.5" /> Fit
                </button>
                <button onClick={fetchData} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors ml-1" title="Refresh">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Timeline Chart */}
            {visibleEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 bg-surface-1 border border-border rounded-xl">
                <Activity className="w-12 h-12 mb-3 text-text-muted opacity-30" />
                <p className="text-sm text-text-secondary">No tasks recorded yet</p>
                <p className="text-xs text-text-muted mt-1">Tasks will appear here as agents run</p>
              </div>
            ) : (
              <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
                <div ref={scrollRef} className="overflow-x-auto">
                  <div style={{ minWidth: `${100 * zoomLevel}%` }}>
                    {/* Top axis */}
                    <TimeAxis ticks={ticks} labelWidth={LABEL_W} />

                    {/* Session rows */}
                    {visibleRows.map((row) => {
                      const c = colorOf(row.sessionId);
                      return (
                        <div key={row.sessionId} className="flex border-t border-border group hover:bg-surface-0/40 transition-colors">
                          {/* Label — sticky so it stays visible on horizontal scroll */}
                          <div
                            className="shrink-0 border-r border-border px-3 flex flex-col justify-center sticky left-0 z-10 bg-surface-1 group-hover:bg-surface-2/80"
                            style={{ width: LABEL_W, minHeight: 56 }}
                          >
                            <p className="text-[11px] font-mono truncate" style={{ color: c.text }}>
                              {row.sessionId.slice(0, 14)}
                            </p>
                            <p className="text-[10px] text-text-muted mt-0.5">
                              {row.events.length} task{row.events.length !== 1 && 's'}
                              {row.session && ` · ${fmtTokens(row.session.total_tokens)}`}
                            </p>
                          </div>

                          {/* Bar area */}
                          <div className="flex-1 relative" style={{ minHeight: 56 }}>
                            {/* Grid lines */}
                            {ticks.slice(1, -1).map((tk, i) => (
                              <div key={i} className="absolute top-0 bottom-0 border-l border-border/30" style={{ left: `${tk.pct}%`, borderStyle: 'dashed' }} />
                            ))}

                            {/* Event bars */}
                            {row.events.map((ev) => {
                              const p = barPos(ev);
                              const sel = selectedEvent?.id === ev.id;
                              return (
                                <button
                                  key={ev.id}
                                  onClick={() => setSelectedEvent(sel ? null : ev)}
                                  className="absolute rounded-full border flex items-center gap-1.5 px-3 text-[11px] font-medium transition-all hover:brightness-130 cursor-pointer overflow-hidden whitespace-nowrap"
                                  style={{
                                    top: 10, bottom: 10,
                                    left: `${p.left}%`,
                                    width: `${p.width}%`,
                                    minWidth: 56,
                                    backgroundColor: c.bg,
                                    borderColor: sel ? c.text : `${c.border}55`,
                                    color: c.text,
                                    boxShadow: sel ? `0 0 16px ${c.bg}, 0 0 4px ${c.border}44` : 'none',
                                    zIndex: sel ? 10 : 1,
                                  }}
                                  title={`Task ${ev.user_message_id}\n${ev.total_messages} msgs · ${ev.total_tool_calls} tools\n${formatDate(ev.started_at)} → ${ev.completed_at ? formatDate(ev.completed_at) : 'ongoing'}`}
                                >
                                  <span className="font-bold opacity-90">{ev.total_messages}</span>
                                  <span className="truncate opacity-70">{ev.user_message_id.slice(0, 8)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Bottom axis */}
                    <TimeAxis ticks={ticks} labelWidth={LABEL_W} />
                  </div>
                </div>
              </div>
            )}

            {/* ===== Task Detail Panel ===== */}
            {selectedEvent && (
              <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
                {/* Panel header */}
                <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-surface-0/50">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4" style={{ color: colorOf(selectedEvent.session_id).text }} />
                      <span className="text-sm font-semibold text-text-primary">
                        Task {selectedEvent.user_message_id.slice(0, 10)}
                      </span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium
                      ${selectedEvent.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400'
                        : selectedEvent.status === 'error' ? 'bg-red-500/15 text-red-400'
                        : 'bg-yellow-500/15 text-yellow-400'}`}>
                      {selectedEvent.status}
                    </span>
                    <div className="flex items-center gap-4 text-[11px] text-text-muted">
                      <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{selectedEvent.total_messages} messages</span>
                      <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />{selectedEvent.total_tool_calls} tool calls</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{durationStr(selectedEvent.started_at, selectedEvent.completed_at)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Messages list */}
                <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
                  {eventMessages.length === 0 ? (
                    <div className="flex items-center justify-center py-10 text-text-muted">
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                      <span className="text-sm">Loading messages…</span>
                    </div>
                  ) : (
                    eventMessages.map(msg => <MessageBubble key={msg.message_id} msg={msg} />)
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========== Tab: Activity ========== */}
        {activeTab === 'activity' && <ActivityTab />}

        {/* ========== Tab: Approval ========== */}
        {activeTab === 'approval' && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
              <ShieldCheck className="w-7 h-7 text-text-muted" />
            </div>
            <p className="text-sm font-medium text-text-secondary mb-1">Pending Approvals</p>
            <p className="text-[12px] text-text-muted max-w-xs">Agent actions requiring human approval.</p>
          </div>
        )}
      </div>
    </div>
  );
}
