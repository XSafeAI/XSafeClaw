import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity, MessageSquare, Wrench, Clock,
  User, Bot, Terminal,
  RefreshCw, Zap, Users, ListChecks, ShieldCheck, Puzzle,
  Plus, Minus, Maximize2, X, Filter,
  Check, Pencil, Loader2, AlertTriangle,
  CheckCircle2, XCircle, Timer,
  ChevronDown, ChevronRight,
  ShieldAlert, ScanLine, Shield,
  Brain, FileText,
  Hash, Cpu, DollarSign, Radio,
} from 'lucide-react';
import { sessionsAPI, eventsAPI, statsAPI, guardAPI, skillsAPI, memoryAPI } from '../services/api';
import api from '../services/api';
import ActivityTab from './ActivityTab';
import { useI18n } from '../i18n';

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

const FILTER_IDS: SessionFilter[] = ['active', 'today', 'all'];

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

/* ============ Scan Badge ============ */
function ScanBadge({ status, riskType, details }: { status?: string; riskType?: string; details?: string }) {
  const { t } = useI18n();
  if (!status || status === 'unscanned') {
    return (
      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted flex-shrink-0 flex items-center gap-1" title={t.monitor.skills.notScanned}>
        <Shield className="w-2.5 h-2.5" /> {t.monitor.skills.unscanned}
      </span>
    );
  }
  if (status === 'safe') {
    return (
      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 flex-shrink-0 flex items-center gap-1" title={t.monitor.skills.safe}>
        <Shield className="w-2.5 h-2.5" /> {t.monitor.skills.safe}
      </span>
    );
  }
  if (status === 'unsafe') {
    return (
      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 flex-shrink-0 flex items-center gap-1 animate-pulse" title={`${t.monitor.skills.unsafe}: ${riskType} — ${details}`}>
        <ShieldAlert className="w-2.5 h-2.5" /> {t.monitor.skills.unsafe}
      </span>
    );
  }
  if (status === 'outdated') {
    return (
      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 flex-shrink-0 flex items-center gap-1" title={t.monitor.skills.fileChanged}>
        <Shield className="w-2.5 h-2.5" /> {t.monitor.skills.outdated}
      </span>
    );
  }
  return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 flex-shrink-0 flex items-center gap-1" title={t.monitor.skills.scanError}>
      <Shield className="w-2.5 h-2.5" /> {t.monitor.skills.error}
    </span>
  );
}

/* ============ Skills Panel ============ */
interface SkillItem {
  name: string; description?: string; emoji?: string; source?: string;
  eligible: boolean; configEnabled: boolean; hasApiKey: boolean;
  configEnv: Record<string, string>; missing?: any; skillKey?: string;
  path?: string; disabled?: boolean;
  scanStatus?: 'safe' | 'unsafe' | 'error' | 'unscanned' | 'outdated';
  scanRiskType?: string; scanDetails?: string; scanTime?: number;
}

function SkillsPanel() {
  const { t } = useI18n();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'eligible' | 'unavailable' | 'disabled'>('all');
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scanningKeys, setScanningKeys] = useState<Set<string>>(new Set());
  const [scanProgress, setScanProgress] = useState('');
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);

  const loadSkillContent = async (key: string) => {
    if (expandedSkill === key) { setExpandedSkill(null); return; }
    setExpandedSkill(key);
    setLoadingContent(true);
    try {
      const res = await skillsAPI.content(key);
      setExpandedContent(res.data.content || '');
    } catch { setExpandedContent('Failed to load content'); }
    setLoadingContent(false);
  };

  const fetchSkills = useCallback(async () => {
    try {
      const res = await skillsAPI.list();
      const payload = res.data;
      if (payload.error) setError(payload.error);
      const merged = (payload.skills || []).map((s: any) => {
        const scan = s.scanStatus;
        if (scan && typeof scan === 'object') {
          return {
            ...s,
            scanStatus: scan.status as any,
            scanRiskType: scan.risk_type || scan.riskType || '',
            scanDetails: scan.details || '',
            scanTime: scan.scanned_at || scan.scannedAt || 0,
          };
        }
        return s;
      });
      setSkills(merged);
    } catch (err: any) {
      console.error('[Skills] fetch error:', err);
      setError(`Failed to fetch skills: ${err?.message || err}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const toggleSkill = async (key: string, enabled: boolean) => {
    setToggling(prev => new Set(prev).add(key));
    try {
      await skillsAPI.update(key, { enabled });
      setSkills(prev => prev.map(s => (s.skillKey || s.name) === key ? { ...s, configEnabled: enabled } : s));
    } catch { /* ignore */ }
    setToggling(prev => { const n = new Set(prev); n.delete(key); return n; });
  };

  const scanAllSkills = async () => {
    setScanning(true);
    setScanProgress('Starting security scan…');
    try {
      const needScan = skills.filter(s => s.scanStatus !== 'safe');
      const eligibleKeys = needScan.filter(s => s.eligible).map(s => s.skillKey || s.name);
      const otherKeys = needScan.filter(s => !s.eligible).map(s => s.skillKey || s.name);
      const total = eligibleKeys.length + otherKeys.length;
      if (eligibleKeys.length > 0) {
        setScanProgress(`Scanning ${eligibleKeys.length} eligible skills (${total} total)…`);
        await skillsAPI.scanAll(eligibleKeys);
        await fetchSkills();
      }
      if (otherKeys.length > 0) {
        setScanProgress(`Scanning ${otherKeys.length} remaining skills…`);
        await skillsAPI.scanAll(otherKeys);
      }
      setScanProgress('Scan complete. Refreshing…');
      await fetchSkills();
    } catch (err: any) {
      setError(`Scan failed: ${err?.message || err}`);
    }
    setScanning(false);
    setScanProgress('');
  };

  const scanSingleSkill = async (key: string) => {
    setScanningKeys(prev => new Set(prev).add(key));
    try {
      const res = await skillsAPI.scanOne(key, true);
      setSkills(prev => prev.map(s => {
        if ((s.skillKey || s.name) !== key) return s;
        return { ...s, scanStatus: res.data?.status || 'error', scanRiskType: res.data?.risk_type || '', scanDetails: res.data?.details || '', scanTime: res.data?.scanned_at || 0 };
      }));
    } catch { /* ignore */ }
    setScanningKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
  };

  const filtered = useMemo(() => {
    let list = skills;
    if (filter === 'eligible') list = list.filter(s => s.eligible);
    if (filter === 'unavailable') list = list.filter(s => !s.eligible);
    if (filter === 'disabled') list = list.filter(s => !s.configEnabled);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q));
    }
    return list;
  }, [skills, filter, search]);

  const scanCounts = useMemo(() => ({
    safe: skills.filter(s => s.scanStatus === 'safe').length,
    unsafe: skills.filter(s => s.scanStatus === 'unsafe').length,
    unscanned: skills.filter(s => !s.scanStatus || s.scanStatus === 'unscanned' || s.scanStatus === 'outdated' || s.scanStatus === 'error').length,
  }), [skills]);

  if (loading) return (
    <div className="flex items-center justify-center py-20 gap-3 text-text-muted">
      <Loader2 className="w-5 h-5 animate-spin" /> {t.monitor.skills.loadingSkills}
    </div>
  );

  const filterLabels: Record<string, string> = {
    all: t.monitor.skills.filterAll,
    eligible: t.monitor.skills.filterEligible,
    unavailable: t.monitor.skills.filterUnavailable,
    disabled: t.monitor.skills.filterDisabled,
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
            <Shield className="w-3.5 h-3.5 text-emerald-400" /> {scanCounts.safe} {t.monitor.skills.safe}
          </div>
          {scanCounts.unsafe > 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-red-400 font-semibold animate-pulse">
              <ShieldAlert className="w-3.5 h-3.5" /> {scanCounts.unsafe} {t.monitor.skills.unsafe}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
            {scanCounts.unscanned} {t.monitor.skills.pending}
          </div>
        </div>
        <button
          onClick={scanAllSkills}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent text-[12px] font-semibold rounded-lg hover:bg-accent/20 disabled:opacity-50 transition-all"
        >
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
          {scanning ? scanProgress : t.monitor.skills.scanAll}
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'eligible', 'unavailable', 'disabled'] as const).map(f => {
            const count = f === 'all' ? skills.length : f === 'eligible' ? skills.filter(s => s.eligible).length : f === 'unavailable' ? skills.filter(s => !s.eligible).length : skills.filter(s => !s.configEnabled).length;
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${filter === f ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-surface-0 border-border text-text-secondary hover:border-border'}`}>
                {filterLabels[f]} ({count})
              </button>
            );
          })}
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t.monitor.skills.searchPlaceholder}
          className="px-3 py-1.5 bg-surface-0 border border-border rounded-lg text-[12px] w-44 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/40" />
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted">
          <Puzzle className="w-10 h-10 opacity-20 mb-3" />
          <p className="text-sm">{t.monitor.skills.noSkills}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(skill => {
            const key = skill.skillKey || skill.name;
            const isToggling = toggling.has(key);
            const isSkillScanning = scanningKeys.has(key);
            return (
              <div key={key}
                onClick={() => loadSkillContent(key)}
                className={`group relative border rounded-xl p-4 transition-all cursor-pointer ${
                  skill.scanStatus === 'unsafe' ? 'bg-red-500/5 border-red-500/30 hover:border-red-500/50'
                    : !skill.configEnabled ? 'bg-surface-0/40 border-border/50 opacity-50 hover:opacity-70'
                    : skill.eligible ? 'bg-surface-1/80 border-border hover:border-emerald-500/30'
                    : 'bg-surface-1/80 border-border hover:border-amber-500/30'
                } ${expandedSkill === key ? 'ring-1 ring-accent/40' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-lg flex-shrink-0">{skill.emoji || '🔧'}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-semibold text-text-primary truncate">{skill.name}</p>
                        {skill.eligible ? (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 flex-shrink-0">{t.monitor.skills.ready}</span>
                        ) : (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 flex-shrink-0">{t.monitor.skills.unavailable}</span>
                        )}
                        <ScanBadge status={skill.scanStatus} riskType={skill.scanRiskType} details={skill.scanDetails} />
                      </div>
                      {skill.source && <p className="text-[10px] text-text-muted font-mono">{skill.source}</p>}
                      {skill.path && <p className="text-[10px] text-text-muted font-mono truncate max-w-[260px]" title={skill.path}>{skill.path}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
                    <button onClick={() => scanSingleSkill(key)} disabled={isSkillScanning}
                      className="p-1 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors opacity-0 group-hover:opacity-100"
                      title={t.monitor.skills.rescan}>
                      {isSkillScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => toggleSkill(key, !skill.configEnabled)} disabled={isToggling}
                      title={skill.configEnabled ? t.monitor.skills.disable : t.monitor.skills.enable}>
                      {isToggling ? (
                        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                      ) : (
                        <div className={`relative w-8 h-[18px] rounded-full transition-colors ${skill.configEnabled ? 'bg-emerald-500' : 'bg-surface-2'}`}>
                          <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${skill.configEnabled ? 'translate-x-[15px]' : 'translate-x-[2px]'}`} />
                        </div>
                      )}
                    </button>
                  </div>
                </div>
                {skill.description && <p className="text-[11px] text-text-secondary mt-2 line-clamp-2 leading-relaxed">{skill.description}</p>}
                {skill.scanStatus === 'unsafe' && (skill.scanRiskType || skill.scanDetails) && (
                  <div className="mt-2 px-2.5 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                    {skill.scanRiskType && <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">{skill.scanRiskType.replace(/_/g, ' ')}</p>}
                    {skill.scanDetails && <p className="text-[10px] text-red-300/80 mt-0.5 leading-relaxed">{skill.scanDetails}</p>}
                  </div>
                )}
                {!skill.eligible && skill.missing && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {skill.missing.bins?.filter(Boolean).map((bin: string) => (
                      <span key={bin} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">missing: {bin}</span>
                    ))}
                    {skill.missing.anyBins?.filter(Boolean).map((bin: string) => (
                      <span key={bin} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">need: {bin}</span>
                    ))}
                    {skill.missing.env?.filter(Boolean).map((e: string) => (
                      <span key={e} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">${e}</span>
                    ))}
                    {skill.missing.config?.filter(Boolean).map((c: string) => (
                      <span key={c} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">cfg: {c}</span>
                    ))}
                    {skill.missing.os?.filter(Boolean).map((o: string) => (
                      <span key={o} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">os: {o}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {skill.hasApiKey && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 uppercase tracking-wider">API Key</span>}
                  {Object.keys(skill.configEnv || {}).length > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 uppercase tracking-wider">Env</span>}
                </div>
                {expandedSkill === key && (
                  <div className="mt-3 border-t border-border/50 pt-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{t.monitor.skills.preview}</span>
                      <button onClick={() => setExpandedSkill(null)} className="text-text-muted hover:text-text-primary">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {loadingContent ? (
                      <div className="flex items-center gap-2 text-text-muted py-4 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                      </div>
                    ) : (
                      <pre className="text-[10px] leading-relaxed text-text-secondary bg-surface-0 rounded-lg p-3 max-h-[300px] overflow-auto whitespace-pre-wrap break-words font-mono border border-border/30">{expandedContent}</pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============ Memory Panel ============ */
interface MemoryFile {
  key: string; name: string; path: string; relPath: string; sizeBytes: number;
  modifiedAt: number; preview: string; lines: number; category: string;
  scanStatus?: 'safe' | 'unsafe' | 'error' | 'unscanned' | 'outdated';
  scanRiskType?: string; scanDetails?: string; scanTime?: number;
}

function MemoryPanel() {
  const { t } = useI18n();
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | 'memory' | 'workspace'>('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanningKeys, setScanningKeys] = useState<Set<string>>(new Set());
  const [scanProgress, setScanProgress] = useState('');

  const fetchFiles = useCallback(async () => {
    try {
      const res = await memoryAPI.list();
      const merged = (res.data.files || []).map((f: any) => {
        const scan = f.scan;
        if (scan && typeof scan === 'object') {
          return {
            ...f,
            scanStatus: scan.status as any,
            scanRiskType: scan.risk_type || scan.riskType || '',
            scanDetails: scan.details || '',
            scanTime: scan.scanned_at || scan.scannedAt || 0,
          };
        }
        return f;
      });
      setFiles(merged);
    } catch (err: any) {
      setError(`Failed to fetch memory files: ${err?.message || err}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const loadContent = async (key: string) => {
    if (expandedKey === key) { setExpandedKey(null); return; }
    setExpandedKey(key);
    setLoadingContent(true);
    try {
      const res = await memoryAPI.content(key);
      setExpandedContent(res.data.content || '');
    } catch { setExpandedContent('Failed to load content'); }
    setLoadingContent(false);
  };

  const scanAll = async () => {
    setScanning(true);
    setScanProgress('Starting memory scan…');
    try {
      const needScan = files.filter(f => f.scanStatus !== 'safe');
      const memKeys = needScan.filter(f => f.category === 'memory').map(f => f.key);
      const wsKeys = needScan.filter(f => f.category === 'workspace').map(f => f.key);
      const total = memKeys.length + wsKeys.length;
      if (memKeys.length > 0) {
        setScanProgress(`Scanning ${memKeys.length} memory files (${total} total)…`);
        await memoryAPI.scanAll(memKeys);
        await fetchFiles();
      }
      if (wsKeys.length > 0) {
        setScanProgress(`Scanning ${wsKeys.length} workspace files…`);
        await memoryAPI.scanAll(wsKeys);
      }
      setScanProgress('Scan complete. Refreshing…');
      await fetchFiles();
    } catch (err: any) {
      setError(`Scan failed: ${err?.message || err}`);
    }
    setScanning(false);
    setScanProgress('');
  };

  const scanSingle = async (key: string) => {
    setScanningKeys(prev => new Set(prev).add(key));
    try {
      const res = await memoryAPI.scanOne(key, true);
      setFiles(prev => prev.map(f => {
        if (f.key !== key) return f;
        return { ...f, scanStatus: res.data?.status || 'error', scanRiskType: res.data?.risk_type || '', scanDetails: res.data?.details || '', scanTime: res.data?.scanned_at || 0 };
      }));
    } catch { /* ignore */ }
    setScanningKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
  };

  const filtered = useMemo(() => {
    if (catFilter === 'all') return files;
    return files.filter(f => f.category === catFilter);
  }, [files, catFilter]);

  const scanCounts = useMemo(() => ({
    safe: files.filter(f => f.scanStatus === 'safe').length,
    unsafe: files.filter(f => f.scanStatus === 'unsafe').length,
    unscanned: files.filter(f => !f.scanStatus || f.scanStatus === 'unscanned' || f.scanStatus === 'outdated' || f.scanStatus === 'error').length,
  }), [files]);

  if (loading) return (
    <div className="flex items-center justify-center py-20 gap-3 text-text-muted">
      <Loader2 className="w-5 h-5 animate-spin" /> {t.monitor.memory.loadingMemory}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
            <Shield className="w-3.5 h-3.5 text-emerald-400" /> {scanCounts.safe} {t.monitor.memory.safe}
          </div>
          {scanCounts.unsafe > 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-red-400 font-semibold animate-pulse">
              <ShieldAlert className="w-3.5 h-3.5" /> {scanCounts.unsafe} {t.monitor.memory.unsafe}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[12px] text-text-muted">{scanCounts.unscanned} {t.monitor.memory.pending}</div>
        </div>
        <button onClick={scanAll} disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent text-[12px] font-semibold rounded-lg hover:bg-accent/20 disabled:opacity-50 transition-all">
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
          {scanning ? scanProgress : t.monitor.memory.scanAll}
        </button>
      </div>
      <div className="flex items-center gap-2">
        {(['all', 'memory', 'workspace'] as const).map(f => {
          const count = f === 'all' ? files.length : files.filter(x => x.category === f).length;
          return (
            <button key={f} onClick={() => setCatFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${catFilter === f ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-surface-0 border-border text-text-secondary hover:border-border'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)} ({count})
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted">
          <Brain className="w-10 h-10 opacity-20 mb-3" />
          <p className="text-sm">{t.monitor.memory.noMemory}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(file => {
            const isExpanded = expandedKey === file.key;
            const isFileScanning = scanningKeys.has(file.key);
            return (
              <div key={file.key}
                onClick={() => loadContent(file.key)}
                className={`group border rounded-xl p-4 transition-all cursor-pointer ${
                  file.scanStatus === 'unsafe' ? 'bg-red-500/5 border-red-500/30' : 'bg-surface-1/80 border-border hover:border-accent/30'
                } ${isExpanded ? 'ring-1 ring-accent/40' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-semibold text-text-primary">{file.name}</p>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${file.category === 'memory' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'}`}>
                          {file.category}
                        </span>
                        <ScanBadge status={file.scanStatus} riskType={file.scanRiskType} details={file.scanDetails} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-text-muted">
                        <span>{(file.sizeBytes / 1024).toFixed(1)} {t.monitor.memory.kb}</span>
                        <span>{file.lines} {t.monitor.memory.lines}</span>
                        <span>{new Date(file.modifiedAt * 1000).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
                    <button onClick={() => scanSingle(file.key)} disabled={isFileScanning}
                      className="p-1 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Re-scan">
                      {isFileScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                {file.preview && !isExpanded && (
                  <p className="text-[11px] text-text-secondary mt-2 line-clamp-2 leading-relaxed font-mono">{file.preview}</p>
                )}
                {file.scanStatus === 'unsafe' && (file.scanRiskType || file.scanDetails) && (
                  <div className="mt-2 px-2.5 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                    {file.scanRiskType && <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">{file.scanRiskType.replace(/_/g, ' ')}</p>}
                    {file.scanDetails && <p className="text-[10px] text-red-300/80 mt-0.5 leading-relaxed">{file.scanDetails}</p>}
                  </div>
                )}
                {isExpanded && (
                  <div className="mt-3 border-t border-border/50 pt-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{t.monitor.memory.fullContent}</span>
                      <button onClick={() => setExpandedKey(null)} className="text-text-muted hover:text-text-primary"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    {loadingContent ? (
                      <div className="flex items-center gap-2 text-text-muted py-4 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                      </div>
                    ) : (
                      <pre className="text-[10px] leading-relaxed text-text-secondary bg-surface-0 rounded-lg p-3 max-h-[400px] overflow-auto whitespace-pre-wrap break-words font-mono border border-border/30">{expandedContent}</pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============ Tab Config ============ */
const MONITOR_TAB_IDS = ['world', 'agent', 'activity', 'skills', 'memory', 'approval'] as const;
type MonitorTabId = (typeof MONITOR_TAB_IDS)[number];

/* ============ Pending Approvals Panel ============ */
interface PendingItem {
  id: string;
  session_key: string;
  tool_name: string;
  params: Record<string, any>;
  guard_verdict: string;
  guard_raw: string;
  session_context: string;
  risk_source: string | null;
  failure_mode: string | null;
  real_world_harm: string | null;
  created_at: number;
  resolved: boolean;
  resolution: string;
  resolved_at: number;
  modified_params: Record<string, any> | null;
}

function ApprovalPanel({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editParams, setEditParams] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const { data } = await guardAPI.pending();
      setItems(data.map((d: any) => ({ ...d, session_context: d.session_context ?? '', real_world_harm: d.real_world_harm ?? null })));
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    const timer = setInterval(fetchItems, 3000);
    return () => clearInterval(timer);
  }, [fetchItems]);

  const pending = items.filter(i => !i.resolved);
  const resolved = items.filter(i => i.resolved);

  useEffect(() => { onCountChange?.(pending.length); }, [pending.length, onCountChange]);

  const handleResolve = async (id: string, resolution: string, modifiedParams?: Record<string, any>) => {
    setResolving(id);
    try {
      await guardAPI.resolve(id, resolution, modifiedParams);
      await fetchItems();
    } catch (e: any) {
      console.error('resolve failed', e);
    } finally {
      setResolving(null);
      setEditingId(null);
    }
  };

  const handleModify = (id: string) => {
    if (editingId === id) {
      try {
        const parsed = JSON.parse(editParams);
        handleResolve(id, 'modified', parsed);
      } catch { alert('Invalid JSON'); }
    } else {
      const item = items.find(i => i.id === id);
      setEditingId(id);
      setEditParams(JSON.stringify(item?.params ?? {}, null, 2));
    }
  };

  const timeAgo = (ts: number) => {
    const sec = Math.floor(Date.now() / 1000 - ts);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  const resolutionIcon = (r: string) => {
    if (r === 'approved') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    if (r === 'rejected') return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    if (r === 'modified') return <Pencil className="w-3.5 h-3.5 text-amber-400" />;
    if (r === 'timeout') return <Timer className="w-3.5 h-3.5 text-text-muted" />;
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-5 h-5 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-text-primary">{t.monitor.approvals.title}</h2>
          {pending.length > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 text-xs font-semibold animate-pulse">
              {t.monitor.approvals.nPending.replace('{n}', String(pending.length))}
            </span>
          )}
        </div>
        <button
          onClick={fetchItems}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Empty state */}
      {pending.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 bg-surface-1 border border-border rounded-xl">
          <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
            <ShieldCheck className="w-7 h-7 text-text-muted" />
          </div>
          <p className="text-sm font-medium text-text-secondary mb-1">{t.monitor.approvals.noApprovals}</p>
          <p className="text-[12px] text-text-muted max-w-xs">{t.monitor.approvals.noApprovalsDesc}</p>
        </div>
      )}

      {/* Pending items */}
      {pending.map(item => (
        <div key={item.id} className="bg-surface-1 border-l-4 border-l-red-500 border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="font-mono text-sm font-semibold text-text-primary">{item.tool_name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold uppercase">
                  {item.guard_verdict}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(item.created_at)}</span>
                <span>{t.common.session}: <code className="text-accent">{item.session_key.slice(0, 12)}…</code></span>
              </div>
              {(item.risk_source || item.failure_mode || item.real_world_harm) && (
                <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                  {item.risk_source && <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">{item.risk_source}</span>}
                  {item.failure_mode && <span className="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-medium">{item.failure_mode}</span>}
                  {item.real_world_harm && <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">{item.real_world_harm}</span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => handleResolve(item.id, 'approved')}
                disabled={resolving === item.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
              >
                {resolving === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {t.common.approve}
              </button>
              <button
                onClick={() => handleModify(item.id)}
                disabled={resolving === item.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-50"
              >
                <Pencil className="w-3.5 h-3.5" />
                {editingId === item.id ? t.common.save : t.common.modify}
              </button>
              <button
                onClick={() => handleResolve(item.id, 'rejected')}
                disabled={resolving === item.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                {t.common.reject}
              </button>
            </div>
          </div>

          {/* Session Context */}
          {item.session_context && (
            <div className="px-5 pt-2 pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">{t.monitor.approvals.sessionTrajectory}</p>
              <pre className="bg-surface-0 border border-border rounded-lg p-3 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-words overflow-y-auto max-h-64 leading-relaxed">
                {item.session_context}
              </pre>
            </div>
          )}

          <div className="px-5 pb-4">
            <button
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary mb-2 transition-colors"
            >
              {expandedId === item.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {t.common.parameters}
            </button>
            {expandedId === item.id && (
              <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-text-dim overflow-x-auto max-h-48">
                {JSON.stringify(item.params, null, 2)}
              </pre>
            )}
            {editingId === item.id && (
              <div className="mt-3">
                <label className="text-xs text-text-muted font-semibold mb-1 block">{t.common.editParamsJson}</label>
                <textarea
                  value={editParams}
                  onChange={e => setEditParams(e.target.value)}
                  rows={6}
                  className="w-full bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                />
                <button
                  onClick={() => setEditingId(null)}
                  className="mt-2 text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  {t.common.cancelEditing}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Resolved history */}
      {resolved.length > 0 && (
        <div>
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-3"
          >
            {showResolved ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {t.monitor.approvals.resolved.replace('{n}', String(resolved.length))}
          </button>
          {showResolved && (
            <div className="space-y-2">
              {resolved.map(item => (
                <div key={item.id} className="bg-surface-1 border border-border rounded-lg px-4 py-3 flex items-center justify-between opacity-70">
                  <div className="flex items-center gap-3">
                    {resolutionIcon(item.resolution)}
                    <span className="font-mono text-xs text-text-primary">{item.tool_name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted capitalize">{item.resolution}</span>
                  </div>
                  <span className="text-xs text-text-muted">{timeAgo(item.resolved_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============ Dashboard Stats Panel ============ */
function DashboardPanel({ data }: { data: any }) {
  const { t } = useI18n();
  const sessions = data.sessions || {};
  const messages = data.messages || {};
  const tokens = data.tokens || {};
  const channels = data.channels || [];
  const model = data.model || {};
  const models = data.models || [];
  const cost = data.cost ?? 0;
  const toolCalls = data.toolCalls ?? 0;

  const formatTokens = (n: number) => {
    if (!n) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const cards: { icon: any; label: string; value: string | number; sub?: string; accent?: string }[] = [
    {
      icon: Users,
      label: t.monitor.dashboard.sessions,
      value: sessions.total ?? 0,
      sub: t.monitor.dashboard.active24h.replace('{n}', String(sessions.active24h ?? 0)),
      accent: 'text-blue-400',
    },
    {
      icon: Radio,
      label: t.monitor.dashboard.channels,
      value: channels.length,
      sub: channels.map((c: any) => c.name).join(', ') || t.monitor.dashboard.none,
      accent: 'text-emerald-400',
    },
    {
      icon: MessageSquare,
      label: t.monitor.dashboard.messages,
      value: messages.total ?? 0,
      sub: t.monitor.dashboard.userAssistant.replace('{u}', String(messages.user ?? 0)).replace('{a}', String(messages.assistant ?? 0)),
      accent: 'text-violet-400',
    },
    {
      icon: Wrench,
      label: t.monitor.dashboard.toolCalls,
      value: toolCalls,
      accent: 'text-amber-400',
    },
    {
      icon: Hash,
      label: t.monitor.dashboard.tokens,
      value: formatTokens(tokens.total ?? 0),
      sub: tokens.total ? `↓${formatTokens(tokens.input)} ↑${formatTokens(tokens.output)}` : 'N/A',
      accent: 'text-cyan-400',
    },
    {
      icon: DollarSign,
      label: t.monitor.dashboard.estCost,
      value: cost > 0 ? `$${cost.toFixed(4)}` : '$0',
      sub: model.primary || 'N/A',
      accent: 'text-rose-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="bg-surface-1 border border-border rounded-xl p-3.5 hover:border-border-active transition-colors group"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-7 h-7 rounded-lg bg-surface-0 flex items-center justify-center ${card.accent || 'text-text-muted'} group-hover:scale-105 transition-transform`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{card.label}</span>
            </div>
            <p className="text-lg font-bold text-text-primary leading-none">{card.value}</p>
            {card.sub && (
              <p className="text-[10px] text-text-muted mt-1.5 truncate" title={card.sub}>{card.sub}</p>
            )}
          </div>
        );
      })}
      {models.length > 0 && (
        <div className="col-span-2 sm:col-span-3 lg:col-span-6 flex items-center gap-2 px-1">
          <Cpu className="w-3 h-3 text-text-muted flex-shrink-0" />
          <span className="text-[10px] text-text-muted">
            Models: {models.map((m: any) => `${m.provider}/${m.modelId} (${m.messages} msgs)`).join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}

/* ============ Main Page ============ */
export default function Monitor() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as MonitorTabId | null) ?? 'agent';
  const [activeTab, setActiveTab] = useState<MonitorTabId>(
    MONITOR_TAB_IDS.includes(initialTab as any) ? initialTab! : 'agent'
  );
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [eventMessages, setEventMessages] = useState<EventMessage[]>([]);
  const [stats, setStats] = useState({ sessions: 0, messages: 0, tools: 0, events: 0 });
  const [loading, setLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('active');
  const [pendingCount, setPendingCount] = useState(0);
  const [dashboard, setDashboard] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* ---------- Data fetching ---------- */
  const fetchData = useCallback(async () => {
    try {
      const [sessRes, statsRes, eventsRes, dashRes] = await Promise.all([
        sessionsAPI.list({ page: 1, page_size: 50 }),
        statsAPI.overview().catch(() => ({ data: {} as any })),
        api.get('/events/', { params: { limit: 100 } }).catch(() => ({ data: { events: [] } })),
        statsAPI.dashboard().catch(() => ({ data: null })),
      ]);

      const items = sessRes.data.items || sessRes.data;
      const sessionList: any[] = Array.isArray(items) ? items : [];
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

      if (dashRes.data) setDashboard(dashRes.data);
    } catch (err) {
      console.error('Failed to fetch data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 5_000); return () => clearInterval(t); }, [fetchData]);

  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        const { data } = await guardAPI.pending();
        setPendingCount(Array.isArray(data) ? data.filter((i: any) => !i.resolved).length : 0);
      } catch { /* ignore */ }
    };
    fetchPendingCount();
    const t = setInterval(fetchPendingCount, 5_000);
    return () => clearInterval(t);
  }, []);

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

  const monitorTabs: { id: MonitorTabId; name: string; icon: typeof Activity }[] = [
    { id: 'world',    name: t.monitor.tabs.town,      icon: Activity },
    { id: 'agent',    name: t.monitor.tabs.agents,     icon: Users },
    { id: 'activity', name: t.monitor.tabs.activities, icon: ListChecks },
    { id: 'skills',   name: t.monitor.tabs.skills,     icon: Puzzle },
    { id: 'memory',   name: t.monitor.tabs.memory,     icon: Brain },
    { id: 'approval', name: t.monitor.tabs.approvals,  icon: ShieldCheck },
  ];

  const filterLabelsMap: Record<SessionFilter, string> = {
    active: t.monitor.agents.active,
    today: t.monitor.agents.today,
    all: t.monitor.agents.all,
  };

  const tabCounts: Record<MonitorTabId, number> = { world: 0, agent: stats.sessions, activity: stats.events, skills: 0, memory: 0, approval: pendingCount };

  return (
    <div className="min-h-screen">
      {/* ===== Header ===== */}
      <div className="border-b border-border">
        <div className="px-8 py-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-text-primary">{t.monitor.title}</h1>
            <span className="text-[11px] font-semibold border border-success/40 text-success px-3 py-1 rounded-full uppercase tracking-wider">
              {t.common.active}
            </span>
          </div>
          <p className="text-[13px] text-text-muted mt-2">
            {t.monitor.subtitle}
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
                  ${tab.id === 'approval' && tabCounts[tab.id] > 0
                    ? 'bg-red-500/20 text-red-400 animate-pulse'
                    : active ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-text-muted'
                  }`}>
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
            <p className="text-sm opacity-40">{t.monitor.town}</p>
          </div>
        )}

        {/* ========== Tab: Agent — Timeline ========== */}
        {activeTab === 'agent' && (
          <div className="space-y-4">
            {/* Dashboard Stats Panel */}
            {dashboard && <DashboardPanel data={dashboard} />}

            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-text-primary">{t.monitor.timeline.title}</h2>
                <span className="text-[11px] text-text-muted">
                  {t.monitor.timeline.sessionsTasks.replace('{s}', String(visibleRows.length)).replace('{t}', String(visibleEvents.length))}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Session filter */}
                <div className="flex items-center gap-0.5 bg-surface-1 border border-border rounded-lg p-0.5">
                  <Filter className="w-3.5 h-3.5 text-text-muted ml-2 mr-1" />
                  {FILTER_IDS.map(fid => (
                    <button
                      key={fid}
                      onClick={() => setSessionFilter(fid)}
                      className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all
                        ${sessionFilter === fid
                          ? 'bg-accent/15 text-accent shadow-sm'
                          : 'text-text-muted hover:text-text-secondary'
                        }`}
                    >
                      {filterLabelsMap[fid]}
                    </button>
                  ))}
                </div>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Zoom controls */}
                <button onClick={zoomIn} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors" title={t.monitor.timeline.zoomIn}>
                  <Plus className="w-4 h-4" />
                </button>
                <button onClick={zoomOut} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors" title={t.monitor.timeline.zoomOut}>
                  <Minus className="w-4 h-4" />
                </button>
                <button onClick={fitAll} className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors text-[12px] font-medium" title={t.monitor.timeline.fit}>
                  <Maximize2 className="w-3.5 h-3.5" /> {t.monitor.timeline.fit}
                </button>
                <button onClick={fetchData} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors ml-1" title={t.monitor.timeline.refresh}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Timeline Chart */}
            {visibleEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 bg-surface-1 border border-border rounded-xl">
                <Activity className="w-12 h-12 mb-3 text-text-muted opacity-30" />
                <p className="text-sm text-text-secondary">{t.monitor.timeline.noTasks}</p>
                <p className="text-xs text-text-muted mt-1">{t.monitor.timeline.tasksWillAppear}</p>
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
                      <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{selectedEvent.total_messages} {t.monitor.timeline.messages}</span>
                      <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />{selectedEvent.total_tool_calls} {t.monitor.timeline.toolCalls}</span>
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
                      <span className="text-sm">{t.monitor.timeline.loadingMessages}</span>
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
        {activeTab === 'skills' && <SkillsPanel />}
        {activeTab === 'memory' && <MemoryPanel />}
        {activeTab === 'approval' && (
          <ApprovalPanel onCountChange={setPendingCount} />
        )}
      </div>
    </div>
  );
}
