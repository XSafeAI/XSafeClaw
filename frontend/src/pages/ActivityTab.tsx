import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare, Wrench, Zap, Clock,
  ChevronDown, ChevronRight, ChevronLeft,
  User, Bot, Terminal, Search, Filter,
  RefreshCw, AlertCircle, CheckCircle2,
  Hash, Copy,
  X,
} from 'lucide-react';
import api from '../services/api';

/* ============================== Types ============================== */

interface SessionRow {
  session_id: string;
  first_seen_at: string;
  last_activity_at: string | null;
  cwd: string | null;
  current_model_provider: string | null;
  current_model_name: string | null;
  total_runs: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  session_id: string;
  message_id: string;
  parent_message_id: string | null;
  role: string;
  timestamp: string;
  content_text: string | null;
  provider: string | null;
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  stop_reason: string | null;
  error_message: string | null;
  created_at: string;
  tool_calls: { id: string; tool_name: string; status: string; is_error: boolean; arguments: Record<string, any> | null; result_text: string | null }[];
}

interface ToolCallRow {
  id: string;
  message_db_id: number | null;
  initiating_message_id: string | null;
  result_message_id: string | null;
  tool_name: string;
  arguments: Record<string, any> | null;
  result_text: string | null;
  result_json: Record<string, any> | null;
  status: string;
  exit_code: number | null;
  is_error: boolean;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  cwd: string | null;
  error_message: string | null;
  created_at: string;
}

interface EventRow {
  id: string;
  session_id: string;
  user_message_id: string;
  started_at: string;
  completed_at: string | null;
  total_messages: number;
  total_tool_calls: number;
  total_assistant_messages: number;
  total_tool_result_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  tool_call_ids: string[] | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
}

type SubTab = 'chats' | 'tool_calls' | 'tasks';

const SUB_TABS: { id: SubTab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chats',      label: 'Chats',      icon: MessageSquare },
  { id: 'tasks',      label: 'Tasks',      icon: Zap },
  { id: 'tool_calls', label: 'Tool Calls', icon: Wrench },
];

/* ============================== Helpers ============================== */

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function truncate(s: string | null | undefined, len = 120): string {
  if (!s) return '—';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

/* ============================== Badge Components ============================== */

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    user: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    assistant: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    toolResult: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    system: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  };
  const icons: Record<string, typeof User> = { user: User, assistant: Bot, toolResult: Terminal };
  const Icon = icons[role] || Hash;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${styles[role] || 'bg-surface-2 text-text-muted border-border'}`}>
      <Icon className="w-3 h-3" /> {role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isOk = status === 'completed';
  const isErr = status === 'error' || status === 'failed';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border
      ${isOk ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
        : isErr ? 'bg-red-500/15 text-red-400 border-red-500/25'
        : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25'}`}>
      {isOk ? <CheckCircle2 className="w-3 h-3" /> : isErr ? <AlertCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {status}
    </span>
  );
}

/* ============================== Pagination ============================== */

function Pagination({ page, totalPages, total, onPage }: {
  page: number; totalPages: number; total: number; onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 border-t border-border mt-2">
      <span className="text-[11px] text-text-muted">{total} total records</span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          let p: number;
          if (totalPages <= 7) {
            p = i + 1;
          } else if (page <= 4) {
            p = i + 1;
          } else if (page >= totalPages - 3) {
            p = totalPages - 6 + i;
          } else {
            p = page - 3 + i;
          }
          return (
            <button key={p} onClick={() => onPage(p)}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-[11px] font-medium transition-colors
                ${p === page ? 'bg-accent/15 text-accent border border-accent/30' : 'text-text-muted hover:text-text-primary border border-transparent hover:border-border'}`}>
              {p}
            </button>
          );
        })}
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)}
          className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ============================== Copyable ID ============================== */

function CopyableId({ id, len = 10 }: { id: string; len?: number }) {
  return (
    <span className="inline-flex items-center gap-1 group cursor-pointer" onClick={() => copyToClipboard(id)} title={id}>
      <code className="text-[11px] font-mono text-text-secondary">{id.slice(0, len)}{id.length > len ? '…' : ''}</code>
      <Copy className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
    </span>
  );
}

/* ============================== Detail Panels ============================== */

function ChatDetail({ s }: { s: SessionRow }) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [msgLoading, setMsgLoading] = useState(true);
  const [msgPage, setMsgPage] = useState(1);
  const [msgTotal, setMsgTotal] = useState(0);
  const msgPageSize = 20;
  const msgTotalPages = Math.ceil(msgTotal / msgPageSize);
  const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null);

  useEffect(() => {
    setMsgLoading(true);
    api.get(`/sessions/${s.session_id}/messages`, { params: { page: msgPage, page_size: msgPageSize } })
      .then(r => {
        setMessages(r.data.messages || []);
        setMsgTotal(r.data.total || 0);
      })
      .catch(() => {})
      .finally(() => setMsgLoading(false));
  }, [s.session_id, msgPage]);

  return (
    <div className="bg-surface-0/50">
      {/* Session info header */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-border/50">
        <Field label="Session ID" value={s.session_id} mono />
        <Field label="First Seen" value={fmtDate(s.first_seen_at)} />
        <Field label="Last Activity" value={fmtDate(s.last_activity_at)} />
        <Field label="Working Directory" value={s.cwd || '—'} mono />
        <Field label="Model Provider" value={s.current_model_provider || '—'} />
        <Field label="Model Name" value={s.current_model_name || '—'} />
        <Field label="Total Messages" value={String(s.total_runs)} />
        <Field label="Total Tokens" value={fmtTokens(s.total_tokens)} />
      </div>

      {/* Messages list */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Messages ({msgTotal})
          </span>
        </div>

        {msgLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-4 h-4 text-accent animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-[12px]">No messages in this chat</div>
        ) : (
          <div className="space-y-1">
            {messages.map(m => (
              <div key={m.message_id}>
                <div
                  onClick={() => setExpandedMsgId(prev => prev === m.message_id ? null : m.message_id)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-surface-2/60 transition-colors"
                >
                  {expandedMsgId === m.message_id
                    ? <ChevronDown className="w-3 h-3 text-accent flex-shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />}
                  <RoleBadge role={m.role} />
                  <span className="text-[11px] text-text-muted flex-shrink-0">{fmtDate(m.timestamp)}</span>
                  {m.tool_calls.length > 0 ? (
                    <span className="text-[12px] truncate flex-1 min-w-0 flex items-center gap-1.5">
                      {m.content_text ? (
                        <span className="text-text-secondary truncate">{truncate(m.content_text, 60)}</span>
                      ) : null}
                      {m.tool_calls.map(tc => (
                        <span key={tc.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 flex-shrink-0">
                          <Wrench className="w-2.5 h-2.5" />{tc.tool_name}({tc.arguments ? truncate(JSON.stringify(tc.arguments).replace(/^\{|\}$/g, '').replace(/"/g, ''), 50) : ''})
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[12px] text-text-secondary truncate flex-1 min-w-0">{truncate(m.content_text, 100)}</span>
                  )}
                  {m.total_tokens != null && m.total_tokens > 0 && (
                    <span className="text-[10px] text-text-muted flex-shrink-0">{fmtTokens(m.total_tokens)}</span>
                  )}
                </div>
                {expandedMsgId === m.message_id && (
                  <div className="ml-6 mr-2 mb-1">
                    <MessageDetail m={m} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Messages pagination */}
        {msgTotalPages > 1 && (
          <div className="mt-2 px-1">
            <Pagination page={msgPage} totalPages={msgTotalPages} total={msgTotal} onPage={setMsgPage} />
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallInline({ tc }: { tc: MessageRow['tool_calls'][0] }) {
  const [showArgs, setShowArgs] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const argsStr = tc.arguments ? JSON.stringify(tc.arguments, null, 2) : null;
  const isLongArgs = argsStr && argsStr.length > 200;

  return (
    <div className={`rounded-lg border p-2.5 ${tc.is_error ? 'bg-red-500/5 border-red-500/20' : 'bg-surface-2/50 border-border/60'}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border
          ${tc.is_error ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
          <Wrench className="w-3 h-3" /> {tc.tool_name}
        </span>
        <code className="text-[10px] font-mono text-text-muted">{tc.id}</code>
        <StatusBadge status={tc.status} />
      </div>
      {/* Arguments */}
      {argsStr && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Arguments</span>
            {isLongArgs && (
              <button onClick={() => setShowArgs(!showArgs)} className="text-[10px] text-accent hover:underline">
                {showArgs ? 'Collapse' : 'Expand'}
              </button>
            )}
          </div>
          <pre className="text-[11px] text-text-secondary bg-surface-0/80 rounded-md p-2 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto font-mono">
            {showArgs || !isLongArgs ? argsStr : argsStr.slice(0, 200) + '…'}
          </pre>
        </div>
      )}
      {/* Result (if available) */}
      {tc.result_text && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Result</span>
            <button onClick={() => setShowResult(!showResult)} className="text-[10px] text-accent hover:underline">
              {showResult ? 'Hide' : 'Show'}
            </button>
          </div>
          {showResult && (
            <pre className="text-[11px] text-text-secondary bg-surface-0/80 rounded-md p-2 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto font-mono">
              {tc.result_text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function MessageDetail({ m }: { m: MessageRow }) {
  const [expanded, setExpanded] = useState(false);
  const text = m.content_text || '';
  const showToggle = text.length > 400;
  return (
    <div className="p-4 bg-surface-0/50 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Message ID" value={m.message_id} mono />
        <Field label="Session" value={m.session_id.slice(0, 12) + '…'} mono />
        <Field label="Parent" value={m.parent_message_id || '—'} mono />
        <Field label="Timestamp" value={fmtDate(m.timestamp)} />
        {m.role === 'assistant' && (
          <>
            <Field label="Provider" value={m.provider || '—'} />
            <Field label="Model" value={m.model_id || '—'} />
            <Field label="Input Tokens" value={fmtTokens(m.input_tokens)} />
            <Field label="Output Tokens" value={fmtTokens(m.output_tokens)} />
            <Field label="Total Tokens" value={fmtTokens(m.total_tokens)} />
            <Field label="Stop Reason" value={m.stop_reason || '—'} />
          </>
        )}
      </div>
      {m.tool_calls.length > 0 && (
        <div>
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2 block">Tool Calls ({m.tool_calls.length})</span>
          <div className="space-y-2">
            {m.tool_calls.map(tc => (
              <ToolCallInline key={tc.id} tc={tc} />
            ))}
          </div>
        </div>
      )}
      {text && (
        <div>
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1 block">Content</span>
          <pre className="text-[12px] text-text-secondary bg-surface-2 rounded-lg p-3 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">
            {expanded ? text : text.slice(0, 400)}{!expanded && showToggle && '…'}
          </pre>
          {showToggle && (
            <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-accent hover:underline mt-1">
              {expanded ? 'Collapse' : `Show all (${text.length} chars)`}
            </button>
          )}
        </div>
      )}
      {m.error_message && (
        <div>
          <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-1 block">Error</span>
          <pre className="text-[12px] text-red-300 bg-red-500/10 rounded-lg p-3 whitespace-pre-wrap">{m.error_message}</pre>
        </div>
      )}
    </div>
  );
}

function ToolCallDetail({ tc }: { tc: ToolCallRow }) {
  const [showResult, setShowResult] = useState(false);
  return (
    <div className="p-4 bg-surface-0/50 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Tool Call ID" value={tc.id} mono />
        <Field label="Tool Name" value={tc.tool_name} />
        <Field label="Status" value={tc.status} />
        <Field label="Duration" value={fmtDuration(tc.duration_seconds)} />
        <Field label="Exit Code" value={tc.exit_code != null ? String(tc.exit_code) : '—'} />
        <Field label="CWD" value={tc.cwd || '—'} mono />
        <Field label="Started At" value={fmtDate(tc.started_at)} />
        <Field label="Completed At" value={fmtDate(tc.completed_at)} />
        <Field label="Initiating Message" value={tc.initiating_message_id || '—'} mono />
        <Field label="Result Message" value={tc.result_message_id || '—'} mono />
      </div>
      {tc.arguments && (
        <div>
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1 block">Arguments</span>
          <pre className="text-[12px] text-text-secondary bg-surface-2 rounded-lg p-3 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
            {JSON.stringify(tc.arguments, null, 2)}
          </pre>
        </div>
      )}
      {tc.result_text && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Result</span>
            <button onClick={() => setShowResult(!showResult)} className="text-[11px] text-accent hover:underline">
              {showResult ? 'Hide' : 'Show'}
            </button>
          </div>
          {showResult && (
            <pre className="text-[12px] text-text-secondary bg-surface-2 rounded-lg p-3 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
              {tc.result_text}
            </pre>
          )}
        </div>
      )}
      {tc.error_message && (
        <div>
          <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-1 block">Error</span>
          <pre className="text-[12px] text-red-300 bg-red-500/10 rounded-lg p-3 whitespace-pre-wrap">{tc.error_message}</pre>
        </div>
      )}
    </div>
  );
}

interface TaskToolCall {
  id: string;
  tool_name: string;
  arguments: Record<string, any> | null;
}

interface TaskMessage {
  message_id: string;
  role: string;
  timestamp: string;
  content_text: string | null;
  tool_calls_count: number;
  tool_call_ids: string[];
  tool_calls: TaskToolCall[];
}

function TaskDetail({ ev }: { ev: EventRow }) {
  const [taskMessages, setTaskMessages] = useState<TaskMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(true);
  const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null);
  // Full message details (fetched on demand when expanding)
  const [fullMessages, setFullMessages] = useState<Record<string, MessageRow>>({});

  useEffect(() => {
    setMsgLoading(true);
    api.get(`/events/${ev.id}`)
      .then(r => {
        setTaskMessages(r.data.messages || []);
      })
      .catch(() => {})
      .finally(() => setMsgLoading(false));
  }, [ev.id]);

  const handleExpandMsg = (msgId: string) => {
    if (expandedMsgId === msgId) {
      setExpandedMsgId(null);
      return;
    }
    setExpandedMsgId(msgId);
    // Fetch full message details if not already loaded
    if (!fullMessages[msgId]) {
      api.get(`/messages/${msgId}`)
        .then(r => {
          setFullMessages(prev => ({ ...prev, [msgId]: r.data }));
        })
        .catch(() => {});
    }
  };

  return (
    <div className="bg-surface-0/50">
      {/* Task info header */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-border/50">
        <Field label="Task ID" value={ev.id} mono />
        <Field label="Session" value={ev.session_id.slice(0, 12) + '…'} mono />
        <Field label="User Message" value={ev.user_message_id} mono />
        <Field label="Status" value={ev.status} />
        <Field label="Started At" value={fmtDate(ev.started_at)} />
        <Field label="Completed At" value={fmtDate(ev.completed_at)} />
        <Field label="Total Messages" value={String(ev.total_messages)} />
        <Field label="Assistant Msgs" value={String(ev.total_assistant_messages)} />
        <Field label="Tool Result Msgs" value={String(ev.total_tool_result_messages)} />
        <Field label="Tool Calls" value={String(ev.total_tool_calls)} />
        <Field label="Input Tokens" value={fmtTokens(ev.total_input_tokens)} />
        <Field label="Output Tokens" value={fmtTokens(ev.total_output_tokens)} />
        <Field label="Total Tokens" value={fmtTokens(ev.total_tokens)} />
      </div>

      {/* Messages list */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Messages ({taskMessages.length})
          </span>
        </div>

        {msgLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-4 h-4 text-accent animate-spin" />
          </div>
        ) : taskMessages.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-[12px]">No messages in this task</div>
        ) : (
          <div className="space-y-1">
            {taskMessages.map(tm => (
              <div key={tm.message_id}>
                <div
                  onClick={() => handleExpandMsg(tm.message_id)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-surface-2/60 transition-colors"
                >
                  {expandedMsgId === tm.message_id
                    ? <ChevronDown className="w-3 h-3 text-accent flex-shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />}
                  <RoleBadge role={tm.role} />
                  <span className="text-[11px] text-text-muted flex-shrink-0">{fmtDate(tm.timestamp)}</span>
                  {tm.tool_calls && tm.tool_calls.length > 0 ? (
                    <span className="text-[12px] truncate flex-1 min-w-0 flex items-center gap-1.5">
                      {tm.content_text ? (
                        <span className="text-text-secondary truncate">{truncate(tm.content_text, 60)}</span>
                      ) : null}
                      {tm.tool_calls.map(tc => (
                        <span key={tc.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 flex-shrink-0">
                          <Wrench className="w-2.5 h-2.5" />{tc.tool_name}({tc.arguments ? truncate(JSON.stringify(tc.arguments).replace(/^\{|\}$/g, '').replace(/"/g, ''), 50) : ''})
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[12px] text-text-secondary truncate flex-1 min-w-0">{truncate(tm.content_text, 100)}</span>
                  )}
                </div>
                {expandedMsgId === tm.message_id && (
                  <div className="ml-6 mr-2 mb-1">
                    {fullMessages[tm.message_id] ? (
                      <MessageDetail m={fullMessages[tm.message_id]} />
                    ) : (
                      <div className="flex items-center justify-center py-4">
                        <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {ev.error_message && (
        <div className="px-4 pb-3">
          <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-1 block">Error</span>
          <pre className="text-[12px] text-red-300 bg-red-500/10 rounded-lg p-3 whitespace-pre-wrap">{ev.error_message}</pre>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-[12px] text-text-secondary truncate ${mono ? 'font-mono' : ''}`} title={value}>{value}</div>
    </div>
  );
}

/* ============================== Filter Input ============================== */

function FilterInput({ placeholder, value, onChange }: {
  placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="pl-8 pr-3 py-1.5 text-[12px] bg-surface-2 border border-border rounded-lg text-text-primary
                   placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 w-full"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function FilterSelect({ options, value, onChange, placeholder }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-3 py-1.5 text-[12px] bg-surface-2 border border-border rounded-lg text-text-primary
                 focus:outline-none focus:border-accent/50 appearance-none cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ============================== Table Header ============================== */

function TH({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider px-3 py-2.5 border-b border-border bg-surface-0/60 whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

function TD({ children, className = '', mono }: { children: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <td className={`px-3 py-2.5 text-[12px] text-text-secondary border-b border-border/50 whitespace-nowrap ${mono ? 'font-mono' : ''} ${className}`}>
      {children}
    </td>
  );
}

/* ============================== Main Component ============================== */

export default function ActivityTab() {
  const [subTab, setSubTab] = useState<SubTab>('chats');
  const [loading, setLoading] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [total, setTotal] = useState(0);
  const totalPages = Math.ceil(total / pageSize);

  // Data
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  // Filters
  const [sessionSearch, setSessionSearch] = useState('');
  const [tcNameFilter, setTcNameFilter] = useState('');
  const [tcStatusFilter, setTcStatusFilter] = useState('');
  const [tcErrorFilter, setTcErrorFilter] = useState('');
  const [evtSessionFilter, setEvtSessionFilter] = useState('');
  const [evtStatusFilter, setEvtStatusFilter] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | number | null>(null);

  // Available session IDs for dropdown
  const [sessionOptions, setSessionOptions] = useState<string[]>([]);

  // Fetch session options once
  useEffect(() => {
    api.get('/sessions/', { params: { page: 1, page_size: 100 } })
      .then(r => {
        const list = r.data.sessions || r.data.items || [];
        setSessionOptions(list.map((s: any) => s.session_id));
      })
      .catch(() => {});
  }, []);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setExpandedId(null);
    try {
      if (subTab === 'chats') {
        const r = await api.get('/sessions/', { params: { page, page_size: pageSize } });
        const list = r.data.sessions || r.data.items || [];
        setSessions(sessionSearch
          ? list.filter((s: SessionRow) => s.session_id.toLowerCase().includes(sessionSearch.toLowerCase()))
          : list);
        setTotal(r.data.total || list.length);
      } else if (subTab === 'tool_calls') {
        const params: any = { page, page_size: pageSize };
        if (tcNameFilter) params.tool_name = tcNameFilter;
        if (tcStatusFilter) params.status = tcStatusFilter;
        if (tcErrorFilter === 'true') params.is_error = true;
        if (tcErrorFilter === 'false') params.is_error = false;
        const r = await api.get('/tool-calls/', { params });
        setToolCalls(r.data.tool_calls || []);
        setTotal(r.data.total || 0);
      } else if (subTab === 'tasks') {
        const params: any = { skip: (page - 1) * pageSize, limit: pageSize };
        if (evtSessionFilter) params.session_id = evtSessionFilter;
        if (evtStatusFilter) params.status = evtStatusFilter;
        const r = await api.get('/events/', { params });
        setEvents(r.data.events || []);
        setTotal(r.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch activity data:', err);
    } finally {
      setLoading(false);
    }
  }, [subTab, page, pageSize, sessionSearch, tcNameFilter, tcStatusFilter, tcErrorFilter, evtSessionFilter, evtStatusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Reset page on tab or filter change
  const resetPage = () => setPage(1);

  const toggleExpand = (id: string | number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  /* ============================== Render ============================== */

  return (
    <div className="space-y-4">
      {/* Sub-tab bar + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5 bg-surface-1 border border-border rounded-lg p-0.5">
          {SUB_TABS.map(tab => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setSubTab(tab.id); resetPage(); setExpandedId(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md transition-all
                  ${active ? 'bg-accent/15 text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <Icon className="w-3.5 h-3.5" /> {tab.label}
              </button>
            );
          })}
        </div>
        <button onClick={fetchData} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-border-active transition-colors" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-text-muted" />

        {subTab === 'chats' && (
          <div className="w-64">
            <FilterInput placeholder="Search session ID…" value={sessionSearch}
              onChange={v => { setSessionSearch(v); resetPage(); }} />
          </div>
        )}

        {subTab === 'tool_calls' && (
          <>
            <FilterSelect
              placeholder="All Tools"
              value={tcNameFilter}
              onChange={v => { setTcNameFilter(v); resetPage(); }}
              options={[
                { value: 'exec', label: 'exec' },
                { value: 'read', label: 'read' },
                { value: 'write', label: 'write' },
                { value: 'web_search', label: 'web_search' },
                { value: 'browser', label: 'browser' },
                { value: 'session_status', label: 'session_status' },
              ]}
            />
            <FilterSelect
              placeholder="All Statuses"
              value={tcStatusFilter}
              onChange={v => { setTcStatusFilter(v); resetPage(); }}
              options={[
                { value: 'completed', label: 'Completed' },
                { value: 'pending', label: 'Pending' },
                { value: 'failed', label: 'Failed' },
              ]}
            />
            <FilterSelect
              placeholder="Error Filter"
              value={tcErrorFilter}
              onChange={v => { setTcErrorFilter(v); resetPage(); }}
              options={[
                { value: 'true', label: 'Errors Only' },
                { value: 'false', label: 'No Errors' },
              ]}
            />
          </>
        )}

        {subTab === 'tasks' && (
          <>
            <FilterSelect
              placeholder="All Sessions"
              value={evtSessionFilter}
              onChange={v => { setEvtSessionFilter(v); resetPage(); }}
              options={sessionOptions.map(id => ({ value: id, label: id.slice(0, 14) + '…' }))}
            />
            <FilterSelect
              placeholder="All Statuses"
              value={evtStatusFilter}
              onChange={v => { setEvtStatusFilter(v); resetPage(); }}
              options={[
                { value: 'completed', label: 'Completed' },
                { value: 'pending', label: 'Pending' },
                { value: 'error', label: 'Error' },
              ]}
            />
          </>
        )}

        <span className="text-[11px] text-text-muted ml-auto">{total} records</span>
      </div>

      {/* Data Table */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-5 h-5 text-accent animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              {/* ---------- CHATS ---------- */}
              {subTab === 'chats' && (
                <>
                  <thead>
                    <tr>
                      <TH> </TH>
                      <TH>Session ID</TH>
                      <TH>First Seen</TH>
                      <TH>Last Activity</TH>
                      <TH>Model</TH>
                      <TH>Messages</TH>
                      <TH>Tokens</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.length === 0 && (
                      <tr><td colSpan={7} className="text-center py-16 text-text-muted text-sm">No chats found</td></tr>
                    )}
                    {sessions.map(s => (
                      <>
                        <tr key={s.session_id} onClick={() => toggleExpand(s.session_id)}
                          className="cursor-pointer hover:bg-surface-0/50 transition-colors">
                          <TD>
                            {expandedId === s.session_id
                              ? <ChevronDown className="w-3.5 h-3.5 text-accent" />
                              : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
                          </TD>
                          <TD mono><CopyableId id={s.session_id} len={14} /></TD>
                          <TD>{fmtDate(s.first_seen_at)}</TD>
                          <TD>{fmtDate(s.last_activity_at)}</TD>
                          <TD>
                            {s.current_model_name
                              ? <span className="text-[11px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded-md">{s.current_model_name}</span>
                              : <span className="text-text-muted">—</span>}
                          </TD>
                          <TD>{s.total_runs}</TD>
                          <TD>{fmtTokens(s.total_tokens)}</TD>
                        </tr>
                        {expandedId === s.session_id && (
                          <tr key={s.session_id + '_detail'}>
                            <td colSpan={7} className="p-0"><ChatDetail s={s} /></td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </>
              )}

              {/* ---------- TOOL CALLS ---------- */}
              {subTab === 'tool_calls' && (
                <>
                  <thead>
                    <tr>
                      <TH> </TH>
                      <TH>ID</TH>
                      <TH>Tool</TH>
                      <TH>Status</TH>
                      <TH>Started</TH>
                      <TH>Duration</TH>
                      <TH>Exit Code</TH>
                      <TH>Arguments</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {toolCalls.length === 0 && (
                      <tr><td colSpan={8} className="text-center py-16 text-text-muted text-sm">No tool calls found</td></tr>
                    )}
                    {toolCalls.map(tc => (
                      <>
                        <tr key={tc.id} onClick={() => toggleExpand(tc.id)}
                          className="cursor-pointer hover:bg-surface-0/50 transition-colors">
                          <TD>
                            {expandedId === tc.id
                              ? <ChevronDown className="w-3.5 h-3.5 text-accent" />
                              : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
                          </TD>
                          <TD mono><CopyableId id={tc.id} len={14} /></TD>
                          <TD>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 text-text-secondary border border-border">
                              <Wrench className="w-3 h-3" /> {tc.tool_name}
                            </span>
                          </TD>
                          <TD><StatusBadge status={tc.status} /></TD>
                          <TD>{fmtDate(tc.started_at)}</TD>
                          <TD>{fmtDuration(tc.duration_seconds)}</TD>
                          <TD>
                            {tc.exit_code != null ? (
                              <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded-md ${tc.exit_code === 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                {tc.exit_code}
                              </span>
                            ) : '—'}
                          </TD>
                          <TD className="max-w-[240px] truncate">
                            {tc.arguments ? truncate(JSON.stringify(tc.arguments), 60) : '—'}
                          </TD>
                        </tr>
                        {expandedId === tc.id && (
                          <tr key={tc.id + '_detail'}>
                            <td colSpan={8} className="p-0"><ToolCallDetail tc={tc} /></td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </>
              )}

              {/* ---------- TASKS ---------- */}
              {subTab === 'tasks' && (
                <>
                  <thead>
                    <tr>
                      <TH> </TH>
                      <TH>Task ID</TH>
                      <TH>Session</TH>
                      <TH>Status</TH>
                      <TH>Started</TH>
                      <TH>Messages</TH>
                      <TH>Tool Calls</TH>
                      <TH>Tokens</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {events.length === 0 && (
                      <tr><td colSpan={8} className="text-center py-16 text-text-muted text-sm">No tasks found</td></tr>
                    )}
                    {events.map(ev => (
                      <>
                        <tr key={ev.id} onClick={() => toggleExpand(ev.id)}
                          className="cursor-pointer hover:bg-surface-0/50 transition-colors">
                          <TD>
                            {expandedId === ev.id
                              ? <ChevronDown className="w-3.5 h-3.5 text-accent" />
                              : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
                          </TD>
                          <TD mono><CopyableId id={ev.id} /></TD>
                          <TD mono><span className="text-[11px]">{ev.session_id.slice(0, 10)}…</span></TD>
                          <TD><StatusBadge status={ev.status} /></TD>
                          <TD>{fmtDate(ev.started_at)}</TD>
                          <TD>
                            <span className="text-[11px]">
                              {ev.total_messages}
                              <span className="text-text-muted ml-1">({ev.total_assistant_messages}A / {ev.total_tool_result_messages}T)</span>
                            </span>
                          </TD>
                          <TD>{ev.total_tool_calls}</TD>
                          <TD>{fmtTokens(ev.total_tokens)}</TD>
                        </tr>
                        {expandedId === ev.id && (
                          <tr key={ev.id + '_detail'}>
                            <td colSpan={8} className="p-0"><TaskDetail ev={ev} /></td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </>
              )}
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="px-4 pb-3">
          <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
        </div>
      </div>
    </div>
  );
}
