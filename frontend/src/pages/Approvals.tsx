import { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, Check, X, Pencil, Loader2, RefreshCw,
  Clock, AlertTriangle, CheckCircle2, XCircle, Timer,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { guardAPI } from '../services/api';

interface PendingItem {
  id: string;
  session_key: string;
  tool_name: string;
  params: Record<string, any>;
  guard_verdict: string;
  guard_raw: string;
  risk_source: string | null;
  failure_mode: string | null;
  created_at: number;
  resolved: boolean;
  resolution: string;
  resolved_at: number;
  modified_params: Record<string, any> | null;
}

const POLL_INTERVAL = 3000;

export default function Approvals() {
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
      setItems(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    const timer = setInterval(fetchItems, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchItems]);

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
      } catch {
        alert('Invalid JSON');
      }
    } else {
      const item = items.find(i => i.id === id);
      setEditingId(id);
      setEditParams(JSON.stringify(item?.params ?? {}, null, 2));
    }
  };

  const pending = items.filter(i => !i.resolved);
  const resolved = items.filter(i => i.resolved);

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

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Tool Guard</h1>
            <p className="text-xs text-text-muted">Review and approve unsafe tool calls</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {pending.length > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 text-xs font-semibold animate-pulse">
              {pending.length} pending
            </span>
          )}
          <button
            onClick={fetchItems}
            className="p-2 rounded-lg bg-surface-2 border border-border hover:bg-surface-3 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Pending Items */}
      {pending.length === 0 && !loading && (
        <div className="text-center py-16 bg-surface-1 rounded-xl border border-border">
          <CheckCircle2 className="w-12 h-12 text-emerald-400/40 mx-auto mb-3" />
          <p className="text-text-muted text-sm">No pending approvals</p>
          <p className="text-text-muted/60 text-xs mt-1">Tool calls flagged as unsafe will appear here</p>
        </div>
      )}

      {pending.map(item => (
        <div key={item.id} className="bg-surface-1 border-l-4 border-l-red-500 border border-border rounded-xl overflow-hidden">
          {/* Card Header */}
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
                <span>Session: <code className="text-accent">{item.session_key.slice(0, 12)}…</code></span>
              </div>
              {item.risk_source && (
                <p className="text-xs text-amber-400/80 mt-1.5">
                  Risk: {item.risk_source}{item.failure_mode ? ` · ${item.failure_mode}` : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => handleResolve(item.id, 'approved')}
                disabled={resolving === item.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
              >
                {resolving === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Approve
              </button>
              <button
                onClick={() => handleModify(item.id)}
                disabled={resolving === item.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-50"
              >
                <Pencil className="w-3.5 h-3.5" />
                {editingId === item.id ? 'Save' : 'Modify'}
              </button>
              <button
                onClick={() => handleResolve(item.id, 'rejected')}
                disabled={resolving === item.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                Reject
              </button>
            </div>
          </div>

          {/* Params */}
          <div className="px-5 pb-4">
            <button
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary mb-2 transition-colors"
            >
              {expandedId === item.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Parameters
            </button>
            {expandedId === item.id && (
              <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-text-dim overflow-x-auto max-h-48">
                {JSON.stringify(item.params, null, 2)}
              </pre>
            )}
            {editingId === item.id && (
              <div className="mt-3">
                <label className="text-xs text-text-muted font-semibold mb-1 block">Edit parameters (JSON):</label>
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
                  Cancel editing
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Resolved History */}
      {resolved.length > 0 && (
        <div>
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-3"
          >
            {showResolved ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Resolved ({resolved.length})
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
