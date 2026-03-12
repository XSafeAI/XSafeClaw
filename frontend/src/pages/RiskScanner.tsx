import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Shield, Zap, Loader2, Play, ChevronDown, ChevronRight,
  AlertTriangle, XCircle, Square,
  Crosshair, Send, Clock, Check, Bot, User, MessageSquare,
  ShieldAlert, ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { redteamAPI, guardAPI } from '../services/api';

/* ==================== Types ==================== */
interface InstructionItem { record_id: string; instruction: string; category: string; }
interface TurnItem { thought: string; output: string; }
interface DecomposedResult {
  record_id: string; instruction: string; name: string;
  description: string; risk_type: string; turns: TurnItem[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  turnIndex?: number;
  state?: string; // 'sending' | 'done' | 'error' | 'timeout'
}

/* ==================== Constants ==================== */
const tabs = [
  { id: 'redteam', name: 'Risk Discovery', icon: Crosshair },
  { id: 'assess',  name: 'Risk Assessment', icon: Shield },
] as const;
type TabId = typeof tabs[number]['id'];

/* ==================== Sub Components ==================== */
function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`bg-surface-1 border border-border rounded-xl ${className}`} style={style}>{children}</div>;
}

function CardHeader({ icon: Icon, title, badge, action }: { icon: typeof Shield; title: string; badge?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {badge}
      </div>
      {action}
    </div>
  );
}

/* ==================== Safety Rehearsal Panel ==================== */
function RedTeamPanel() {
  const [instructions, setInstructions] = useState<InstructionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<DecomposedResult | null>(null);

  // Chat state
  const [sessionKey, setSessionKey] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [currentTurn, setCurrentTurn] = useState(-1);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const navigate = useNavigate();

  const [guardPending, setGuardPending] = useState<{
    id: string; tool_name: string; risk_source: string | null;
    failure_mode: string | null; real_world_harm: string | null;
  }[]>([]);

  // Poll guard pending items for the active red-team session
  useEffect(() => {
    if (!sessionKey) { setGuardPending([]); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await guardAPI.pending(false);
        if (cancelled) return;
        const forSession = data.filter((p: any) => p.session_key === sessionKey || p.session_key?.endsWith(sessionKey));
        setGuardPending(forSession.map((p: any) => ({
          id: p.id,
          tool_name: p.tool_name,
          risk_source: p.risk_source ?? null,
          failure_mode: p.failure_mode ?? null,
          real_world_harm: p.real_world_harm ?? null,
        })));
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sessionKey]);

  // Load instructions on mount
  useEffect(() => {
    redteamAPI.listInstructions()
      .then(res => { setInstructions(res.data as InstructionItem[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Cleanup session on unmount
  useEffect(() => {
    return () => {
      if (sessionKey) {
        redteamAPI.closeSession(sessionKey).catch(() => {});
      }
    };
  }, [sessionKey]);

  const handleGenerate = useCallback(async () => {
    if (!selectedId) return;
    setGenerating(true);
    setResult(null);
    setChatMessages([]);
    setSessionKey('');
    setCurrentTurn(-1);
    abortRef.current = false;
    try {
      const res = await redteamAPI.generate(selectedId);
      setResult(res.data);
      setExpandedTurns(new Set(res.data.turns.map((_, i) => i)));
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [selectedId]);

  const handleRunAll = useCallback(async () => {
    if (!result || running) return;
    setRunning(true);
    abortRef.current = false;

    // 1. Start a new gateway session
    let key = sessionKey;
    if (!key) {
      try {
        setChatMessages(prev => [...prev, {
          id: `sys-${Date.now()}`,
          role: 'system',
          content: 'Connecting to OpenClaw gateway...',
          timestamp: new Date(),
        }]);
        const sessRes = await redteamAPI.startSession();
        key = sessRes.data.session_key;
        setSessionKey(key);
        setChatMessages(prev => [...prev, {
          id: `sys-conn-${Date.now()}`,
          role: 'system',
          content: `Session created: ${key}`,
          timestamp: new Date(),
        }]);
      } catch (err: any) {
        setChatMessages(prev => [...prev, {
          id: `sys-err-${Date.now()}`,
          role: 'system',
          content: `Failed to connect: ${err.response?.data?.detail || err.message}`,
          timestamp: new Date(),
          state: 'error',
        }]);
        setRunning(false);
        return;
      }
    }

    // 2. Execute each turn sequentially
    for (let i = 0; i < result.turns.length; i++) {
      if (abortRef.current) {
        setChatMessages(prev => [...prev, {
          id: `sys-abort-${Date.now()}`,
          role: 'system',
          content: 'Execution aborted by user.',
          timestamp: new Date(),
        }]);
        break;
      }

      const turn = result.turns[i];
      setCurrentTurn(i);

      const userMsgId = `user-${i}-${Date.now()}`;
      setChatMessages(prev => [...prev, {
        id: userMsgId,
        role: 'user',
        content: turn.output,
        timestamp: new Date(),
        turnIndex: i,
        state: 'sending',
      }]);

      try {
        const res = await redteamAPI.sendMessage(key, turn.output);

        setChatMessages(prev => prev.map(m =>
          m.id === userMsgId ? { ...m, state: 'done' } : m
        ));

        setChatMessages(prev => [...prev, {
          id: `assistant-${i}-${Date.now()}`,
          role: 'assistant',
          content: res.data.response_text || '[No response]',
          timestamp: new Date(),
          turnIndex: i,
          state: res.data.state,
        }]);
      } catch (err: any) {
        setChatMessages(prev => prev.map(m =>
          m.id === userMsgId ? { ...m, state: 'error' } : m
        ));
        setChatMessages(prev => [...prev, {
          id: `err-${i}-${Date.now()}`,
          role: 'system',
          content: `Error on turn ${i + 1}: ${err.response?.data?.detail || err.message}`,
          timestamp: new Date(),
          state: 'error',
        }]);
        break;
      }
    }

    setCurrentTurn(-1);
    setRunning(false);
  }, [result, running, sessionKey]);

  const handleAbort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const toggleTurn = (index: number) => {
    setExpandedTurns(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const selectedInstruction = instructions.find(i => i.record_id === selectedId);
  const completedTurns = chatMessages.filter(m => m.role === 'assistant').length;
  const totalTurns = result?.turns.length ?? 0;
  const allDone = completedTurns >= totalTurns && totalTurns > 0;

  // Step 1: category selection
  const categories = [...new Set(instructions.map(i => i.category).filter(Boolean))].sort();
  const filteredInstructions = selectedCategory
    ? instructions.filter(i => i.category === selectedCategory)
    : instructions;

  return (
    <div className="grid grid-cols-12 gap-6 items-stretch">
      {/* Left — Instruction Selection & Turn Overview */}
      <div className="col-span-5 flex flex-col gap-5 self-stretch">
        {/* Instruction Selector */}
        <Card className="flex flex-col flex-1">
          <CardHeader icon={Crosshair} title="Attack Setup" />
          <div className="p-5 space-y-5 flex flex-col">

            {/* Step 1 — Choose a target task */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">1</span>
                <span className="text-[12px] font-semibold text-text-primary">Choose a target task</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {loading ? (
                  <span className="text-[12px] text-text-muted">Loading...</span>
                ) : categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => { setSelectedCategory(cat === selectedCategory ? '' : cat); setSelectedId(''); }}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                      selectedCategory === cat
                        ? 'bg-accent/15 border-accent/40 text-accent'
                        : 'bg-surface-0 border-border text-text-secondary hover:border-border-active hover:text-text-primary'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2 — Choose an attack */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${selectedCategory ? 'bg-accent' : 'bg-surface-2'}`}>2</span>
                <span className={`text-[12px] font-semibold ${selectedCategory ? 'text-text-primary' : 'text-text-muted'}`}>Choose an attack</span>
              </div>
              <div className="relative">
                <button
                  onClick={() => selectedCategory && setDropdownOpen(!dropdownOpen)}
                  disabled={loading || !selectedCategory}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-[13px] text-left hover:border-border-active focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {!selectedCategory ? (
                      <span className="text-text-muted">Select a task first...</span>
                    ) : selectedInstruction ? (
                      <>
                        <span className="text-accent font-semibold flex-shrink-0">{selectedInstruction.record_id}</span>
                        <span className="font-mono text-text-primary truncate">{selectedInstruction.instruction}</span>
                      </>
                    ) : (
                      <span className="text-text-muted">Select an attack...</span>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-text-muted flex-shrink-0 ml-2 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {dropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full max-h-[280px] overflow-y-auto bg-surface-1 border border-border rounded-lg shadow-xl">
                    {filteredInstructions.map(item => (
                      <button
                        key={item.record_id}
                        onClick={() => { setSelectedId(item.record_id); setDropdownOpen(false); }}
                        className={`w-full text-left px-4 py-3 text-[12px] border-b border-border/50 last:border-b-0 hover:bg-surface-2 transition-colors ${selectedId === item.record_id ? 'bg-accent/10' : ''}`}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-accent font-semibold">{item.record_id}</span>
                        </div>
                        <span className="font-mono text-text-secondary break-all">{item.instruction}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Generate Button */}
            <div className="pt-2">
            <button
              onClick={handleGenerate}
              disabled={!selectedId || generating}
              className="w-full px-5 py-2.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {generating ? 'Generating Attack Plan...' : 'Generate Attack'}
            </button>
            </div>
          </div>
        </Card>

        {/* Generated Result Info + Turn Overview */}
        {result && (
          <Card>
            <CardHeader
              icon={AlertTriangle}
              title="Attack Plan"
              badge={
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
                  {result.risk_type.replace(/_/g, ' ')}
                </span>
              }
            />
            <div className="p-5 space-y-3">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Scenario</span>
                <p className="text-[13px] font-medium text-text-primary mt-1">{result.name.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Description</span>
                <p className="text-[12px] text-text-secondary mt-1">{result.description}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                {!running ? (
                  <button
                    onClick={handleRunAll}
                    disabled={allDone}
                    className={`flex-1 px-5 py-3 rounded-lg text-[13px] font-semibold transition-all flex items-center justify-center gap-2 ${
                      allDone
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 cursor-default'
                        : 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25'
                    }`}
                  >
                    {allDone ? (
                      <><Check className="w-4 h-4" /> All Turns Completed</>
                    ) : (
                      <><Play className="w-4 h-4" /> Run All Turns ({totalTurns})</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleAbort}
                    className="flex-1 px-5 py-3 rounded-lg text-[13px] font-semibold transition-all flex items-center justify-center gap-2 bg-orange-500/15 text-orange-400 border border-orange-500/30 hover:bg-orange-500/25"
                  >
                    <Square className="w-4 h-4" /> Stop Execution
                  </button>
                )}
              </div>

              {/* Progress */}
              {(running || allDone) && (
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 bg-surface-0 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'bg-accent'}`}
                      style={{ width: `${(completedTurns / totalTurns) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-text-muted tabular-nums">
                    {completedTurns}/{totalTurns}
                  </span>
                </div>
              )}
            </div>

            {/* Turn List (compact) */}
            <div className="border-t border-border max-h-[300px] overflow-y-auto">
              {result.turns.map((turn, idx) => {
                const isDone = chatMessages.some(m => m.role === 'assistant' && m.turnIndex === idx);
                const isCurrent = currentTurn === idx;
                const isExpanded = expandedTurns.has(idx);
                return (
                  <div key={idx} className="border-b border-border/50 last:border-b-0">
                    <button
                      onClick={() => toggleTurn(idx)}
                      className="w-full text-left px-4 py-2.5 hover:bg-surface-2/50 transition-colors flex items-center gap-2"
                    >
                      <div className="flex-shrink-0">
                        {isDone ? (
                          <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <Check className="w-3 h-3 text-emerald-400" />
                          </div>
                        ) : isCurrent ? (
                          <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center">
                            <Loader2 className="w-3 h-3 text-accent animate-spin" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-surface-2 flex items-center justify-center">
                            <Clock className="w-3 h-3 text-text-muted" />
                          </div>
                        )}
                      </div>
                      <span className="text-[12px] font-medium text-text-primary">Turn {idx + 1}</span>
                      <span className="text-[10px] text-text-muted truncate flex-1">{turn.thought.slice(0, 40)}...</span>
                      {isExpanded ? <ChevronDown className="w-3 h-3 text-text-muted" /> : <ChevronRight className="w-3 h-3 text-text-muted" />}
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3">
                        <div className="bg-yellow-500/5 border border-yellow-500/10 rounded-lg p-2.5 mb-2">
                          <p className="text-[10px] font-semibold text-yellow-400 mb-1">THOUGHT</p>
                          <p className="text-[11px] text-text-secondary leading-relaxed">{turn.thought}</p>
                        </div>
                        <div className="bg-surface-0 border border-border rounded-lg p-2.5">
                          <p className="text-[10px] font-semibold text-red-400 mb-1">ATTACK INPUT</p>
                          <p className="text-[11px] text-text-primary font-mono whitespace-pre-wrap break-all leading-relaxed">{turn.output}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Right — Live Chat Dialog */}
      <div className="col-span-7 flex flex-col gap-5 self-stretch min-h-0">
        {!result && !generating && (
          <Card className="flex-1">
            <div className="flex flex-col items-center justify-center h-full text-center py-24">
              <div className="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-5">
                <Crosshair className="w-8 h-8 text-text-muted" />
              </div>
              <p className="text-sm font-medium text-text-secondary mb-2">Automated Safety Rehearsal</p>
              <p className="text-[12px] text-text-muted max-w-sm">
                Select an attack instruction and generate multi-turn decomposed commands. Then execute them against the agent in a live session.
              </p>
            </div>
          </Card>
        )}

        {generating && (
          <Card className="flex-1">
            <div className="flex flex-col items-center justify-center h-full p-8">
              <div className="w-12 h-12 rounded-2xl bg-accent/15 flex items-center justify-center mb-4">
                <Loader2 className="w-6 h-6 text-accent animate-spin" />
              </div>
              <p className="text-sm font-semibold text-text-primary mb-1">Generating Attack Plan</p>
              <p className="text-[12px] text-text-muted">Decomposing instruction into multi-turn attack sequence...</p>
              <div className="w-48 bg-surface-0 rounded-full h-1.5 overflow-hidden mt-4">
                <div className="h-full rounded-full bg-gradient-to-r from-accent via-purple-400 to-accent bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" />
              </div>
            </div>
          </Card>
        )}

        {result && (
          <Card className="flex flex-col flex-1 overflow-hidden min-h-0">
            <CardHeader
              icon={MessageSquare}
              title="Safe Chat"
              badge={
                sessionKey ? (
                  <span className="text-[10px] font-mono bg-surface-2 text-text-muted px-2 py-0.5 rounded-full">
                    {sessionKey}
                  </span>
                ) : (
                  <span className="text-[10px] bg-surface-2 text-text-muted px-2 py-0.5 rounded-full">
                    Not started
                  </span>
                )
              }
            />

            {/* Guard interception banner */}
            {guardPending.length > 0 && (
              <div className="flex-shrink-0 mx-4 mt-3">
                {guardPending.map(gp => (
                  <div key={gp.id} className="flex items-start gap-3 px-4 py-3 bg-red-500/8 border border-red-500/25 rounded-xl mb-2 animate-pulse">
                    <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-red-400">
                        Tool <code className="bg-red-500/15 px-1.5 py-0.5 rounded text-[12px]">{gp.tool_name}</code> blocked by Guard
                      </p>
                      <p className="text-[11px] text-text-muted mt-0.5">Agent paused — needs human approval.</p>
                      {(gp.risk_source || gp.failure_mode || gp.real_world_harm) && (
                        <div className="mt-1.5 text-[11px] text-text-secondary space-y-0.5">
                          {gp.risk_source && <p><span className="text-amber-400 font-medium">Risk Source:</span> {gp.risk_source}</p>}
                          {gp.failure_mode && <p><span className="text-orange-400 font-medium">Failure Mode:</span> {gp.failure_mode}</p>}
                          {gp.real_world_harm && <p><span className="text-red-400 font-medium">Real World Harm:</span> {gp.real_world_harm}</p>}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => navigate('/monitor')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 text-[12px] font-semibold rounded-lg transition-colors flex-shrink-0"
                    >
                      Review <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Chat messages area */}
            <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-4">
              {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
                    <Send className="w-7 h-7 text-text-muted" />
                  </div>
                  <p className="text-sm font-medium text-text-secondary mb-1">Ready to attack</p>
                  <p className="text-[12px] text-text-muted max-w-xs">
                    Click "Run All Turns" to start a live session with the OpenClaw agent and execute the attack plan.
                  </p>
                </div>
              ) : (
                chatMessages.map(msg => (
                  <ChatBubble key={msg.id} message={msg} />
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Status bar */}
            {running && (
              <div className="px-5 py-3 border-t border-border bg-surface-0/50 flex items-center gap-3">
                <Loader2 className="w-4 h-4 text-accent animate-spin" />
                <span className="text-[12px] text-text-secondary">
                  Executing turn {currentTurn + 1} of {totalTurns}...
                </span>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ==================== Chat Bubble ==================== */
function ChatBubble({ message }: { message: ChatMessage }) {
  const { role, content, turnIndex, state } = message;

  if (role === 'system') {
    return (
      <div className="flex justify-center">
        <div className={`px-4 py-1.5 rounded-full text-[11px] font-medium ${
          state === 'error'
            ? 'bg-red-500/10 text-red-400'
            : 'bg-surface-2 text-text-muted'
        }`}>
          {content}
        </div>
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] overflow-hidden">
          {turnIndex !== undefined && (
            <div className="flex items-center justify-end gap-1.5 mb-1">
              <span className="text-[10px] font-bold text-red-400">TURN {turnIndex + 1}</span>
              {state === 'sending' && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
              {state === 'done' && <Check className="w-3 h-3 text-emerald-400" />}
              {state === 'error' && <XCircle className="w-3 h-3 text-red-400" />}
            </div>
          )}
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl rounded-br-sm px-4 py-3">
            <p className="text-[12px] text-text-primary font-mono whitespace-pre-wrap break-all leading-relaxed">{content}</p>
          </div>
        </div>
        <div className="w-7 h-7 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-auto">
          <User className="w-3.5 h-3.5 text-red-400" />
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="flex gap-2">
      <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-auto">
        <Bot className="w-3.5 h-3.5 text-accent" />
      </div>
      <div className="max-w-[85%] overflow-hidden">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-bold text-accent">AGENT</span>
          {state === 'final' && <Check className="w-3 h-3 text-emerald-400" />}
          {state === 'error' && <XCircle className="w-3 h-3 text-red-400" />}
          {state === 'timeout' && <Clock className="w-3 h-3 text-orange-400" />}
        </div>
        <div className="bg-accent/5 border border-accent/10 rounded-xl rounded-bl-sm px-4 py-3">
          <p className="text-[12px] text-text-primary whitespace-pre-wrap break-all leading-relaxed">{content}</p>
        </div>
      </div>
    </div>
  );
}

/* ==================== Risk Assessment Panel (Coming Soon) ==================== */
function RiskAssessmentPanel() {
  return (
    <Card>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-5">
          <Shield className="w-8 h-8 text-text-muted" />
        </div>
        <p className="text-sm font-medium text-text-secondary mb-2">Coming Soon</p>
        <p className="text-[12px] text-text-muted max-w-sm">
          Automated risk assessment for agent actions will be available in a future update.
        </p>
      </div>
    </Card>
  );
}

/* ==================== Main Page ==================== */
export default function RiskScanner() {
  const [activeTab, setActiveTab] = useState<TabId>('redteam');
  const [guardOn, setGuardOn] = useState(true);

  useEffect(() => {
    guardAPI.getEnabled().then(r => setGuardOn(r.data.enabled)).catch(() => {});
  }, []);

  const toggleGuard = async () => {
    const next = !guardOn;
    setGuardOn(next);
    try { await guardAPI.setEnabled(next); } catch { setGuardOn(!next); }
  };

  return (
    <div className="min-h-screen">
      {/* ===== Header ===== */}
      <div className="border-b border-border">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-text-primary">Safety Rehearsal</h1>
              <span className="text-[11px] font-semibold border border-success/40 text-success px-3 py-1 rounded-full uppercase tracking-wider">
                Ready
              </span>
            </div>
            <button onClick={toggleGuard}
              className="flex items-center gap-2.5 group"
              title={guardOn ? 'Guard is ON — tool calls will be checked' : 'Guard is OFF — tool calls pass through'}
            >
              <span className={`text-[12px] font-semibold transition-colors ${guardOn ? 'text-emerald-400' : 'text-text-muted'}`}>
                <Shield className="w-4 h-4 inline -mt-0.5 mr-1" />
                Guard
              </span>
              <div className={`relative w-9 h-5 rounded-full transition-colors ${guardOn ? 'bg-emerald-500' : 'bg-surface-2'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${guardOn ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
              </div>
            </button>
          </div>
          <p className="text-[13px] text-text-muted mt-2">
            Find weaknesses in your AI agents before they cause problems.
          </p>
        </div>

        {/* Tab Bar */}
        <div className="px-8 flex items-center gap-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors
                  ${isActive ? 'text-accent border-accent' : 'text-text-muted border-transparent hover:text-text-secondary hover:border-border'}`}>
                <Icon className="w-3.5 h-3.5" />
                {tab.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== Content ===== */}
      <div className="p-8">
        {activeTab === 'redteam' && <RedTeamPanel />}
        {activeTab === 'assess' && <RiskAssessmentPanel />}
      </div>
    </div>
  );
}
