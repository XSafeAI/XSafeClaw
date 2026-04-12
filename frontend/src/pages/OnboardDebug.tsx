import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle, Loader2, Terminal, XCircle, RefreshCw, ChevronRight,
} from 'lucide-react';
import { systemAPI } from '../services/api';

/* ─── types ─────────────────────────────────────────────────────────────── */
type Stage =
  | 'idle'
  | 'onboarding'
  | 'prompt_confirm'
  | 'prompt_select'
  | 'prompt_multiselect'
  | 'prompt_text'
  | 'onboard_failed'
  | 'complete';

interface SelectOption { label: string; selected: boolean; }
interface LogLine { id: number; text: string; kind: 'output' | 'info' | 'success' | 'error' | 'prompt'; }

let _lid = 0;

/* ─── TerminalLog ────────────────────────────────────────────────────────── */
function TerminalLog({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  return (
    <div
      ref={ref}
      className="bg-[#0d0d0d] border border-border rounded-xl p-4 font-mono text-[12px] leading-5 h-56 overflow-y-auto space-y-0.5"
    >
      {lines.length === 0 && <span className="text-text-muted">Waiting for output…</span>}
      {lines.map((l) => (
        <div
          key={l.id}
          className={
            l.kind === 'success' ? 'text-emerald-400'
            : l.kind === 'error' ? 'text-red-400'
            : l.kind === 'info' ? 'text-sky-400'
            : l.kind === 'prompt' ? 'text-yellow-300'
            : 'text-text-secondary'
          }
        >
          {l.kind === 'prompt' ? (
            <span><span className="text-yellow-500 select-none">? </span>{l.text}</span>
          ) : (
            <span><span className="text-text-muted select-none">$ </span>{l.text}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── TextPrompt ─────────────────────────────────────────────────────────── */
function TextPrompt({ promptText, onSubmit, disabled }: {
  promptText: string; onSubmit: (v: string) => void; disabled: boolean;
}) {
  const [val, setVal] = useState('');
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Terminal className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <p className="text-sm text-text-primary font-medium">{promptText}</p>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && val.trim()) onSubmit(val.trim()); }}
          placeholder="Type your answer and press Enter…"
          className="flex-1 bg-surface-2 border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
          autoFocus
          disabled={disabled}
        />
        <button
          onClick={() => val.trim() && onSubmit(val.trim())}
          disabled={!val.trim() || disabled}
          className="px-4 py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all"
        >
          Send
        </button>
      </div>
    </div>
  );
}

/* ─── SelectPrompt ───────────────────────────────────────────────────────── */
function SelectPrompt({ promptText, options, onChoice, disabled }: {
  promptText: string; options: SelectOption[]; onChoice: (i: number) => void; disabled: boolean;
}) {
  const defaultIdx = options.findIndex(o => o.selected);
  const [chosen, setChosen] = useState(defaultIdx >= 0 ? defaultIdx : 0);
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Terminal className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <p className="text-sm text-text-primary font-medium">{promptText}</p>
      </div>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <button key={i} onClick={() => setChosen(i)} disabled={disabled}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all text-left ${chosen === i ? 'bg-accent/15 border-accent/50 text-text-primary' : 'bg-surface-2 border-border text-text-secondary hover:border-accent/30'}`}
          >
            <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${chosen === i ? 'border-accent' : 'border-text-muted'}`}>
              {chosen === i && <span className="w-2 h-2 rounded-full bg-accent block" />}
            </span>
            <span className="text-sm">{opt.label}</span>
            {opt.selected && chosen !== i && <span className="ml-auto text-[10px] text-text-muted">(default)</span>}
          </button>
        ))}
      </div>
      <button onClick={() => onChoice(chosen)} disabled={disabled}
        className="w-full py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-semibold rounded-xl transition-all text-sm"
      >
        Confirm Selection
      </button>
    </div>
  );
}

/* ─── MultiSelectPrompt ──────────────────────────────────────────────────── */
function MultiSelectPrompt({ promptText, options, onConfirm, disabled }: {
  promptText: string; options: SelectOption[]; onConfirm: (indices: number[]) => void; disabled: boolean;
}) {
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(options.map((o, i) => o.selected ? i : -1).filter(i => i >= 0))
  );
  const toggle = (i: number) => setChecked(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Terminal className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <p className="text-sm text-text-primary font-medium">{promptText}</p>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {options.map((opt, i) => (
          <button key={i} onClick={() => toggle(i)} disabled={disabled}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all text-left ${checked.has(i) ? 'bg-accent/15 border-accent/50 text-text-primary' : 'bg-surface-2 border-border text-text-secondary hover:border-accent/30'}`}
          >
            <span className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${checked.has(i) ? 'bg-accent border-accent' : 'border-text-muted'}`}>
              {checked.has(i) && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            <span className="text-sm">{opt.label}</span>
          </button>
        ))}
      </div>
      <button onClick={() => onConfirm(Array.from(checked).sort((a, b) => a - b))} disabled={disabled}
        className="w-full py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-semibold rounded-xl transition-all text-sm"
      >
        Confirm ({checked.size} selected)
      </button>
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export default function OnboardDebug() {
  const [stage, setStage]                   = useState<Stage>('idle');
  const [logs, setLogs]                     = useState<LogLine[]>([]);
  const [procId, setProcId]                 = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt]   = useState('');
  const [selectOptions, setSelectOptions]   = useState<SelectOption[]>([]);
  const [interacting, setInteracting]       = useState(false);
  const [confirmYesDefault, setConfirmYesDefault] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = (text: string, kind: LogLine['kind'] = 'output') => {
    if (!text.trim()) return;
    setLogs(prev => [...prev, { id: ++_lid, text, kind }]);
  };

  /* ── start onboard ── */
  const startOnboard = async () => {
    abortRef.current?.abort();
    setLogs([]);
    setProcId(null);
    setStage('onboarding');
    addLog('Running: openclaw onboard --install-daemon', 'info');

    let pid: string;
    try {
      const res = await systemAPI.onboardStart();
      pid = res.data.proc_id;
      setProcId(pid);
    } catch (err) {
      addLog(`❌ Failed to start: ${String(err)}`, 'error');
      setStage('onboard_failed');
      return;
    }

    abortRef.current = new AbortController();
    try {
      const resp = await fetch(systemAPI.onboardStreamUrl(pid), { signal: abortRef.current.signal });
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;
          try {
            const d = JSON.parse(line.slice(5).trim());
            if (d.type === 'output' && d.text) {
              addLog(d.text);
            } else if (d.type === 'prompt_confirm') {
              addLog(d.text, 'prompt');
              setPendingPrompt(d.text);
              setSelectOptions([]);
              setConfirmYesDefault(d.yes_default !== false);
              setStage('prompt_confirm');
            } else if (d.type === 'prompt_multiselect') {
              addLog(d.text, 'prompt');
              setPendingPrompt(d.text);
              setSelectOptions(d.options ?? []);
              setStage('prompt_multiselect');
            } else if (d.type === 'prompt_select') {
              addLog(d.text, 'prompt');
              setPendingPrompt(d.text);
              setSelectOptions(d.options ?? []);
              setStage('prompt_select');
            } else if (d.type === 'prompt_text') {
              addLog(d.text, 'prompt');
              setPendingPrompt(d.text);
              setSelectOptions([]);
              setStage('prompt_text');
            } else if (d.type === 'done') {
              if (d.success) {
                addLog('✅ Onboarding complete!', 'success');
                setStage('complete');
              } else {
                addLog(`❌ Exited with code ${d.exit_code}`, 'error');
                setStage('onboard_failed');
              }
            } else if (d.type === 'error') {
              addLog(`❌ ${d.message}`, 'error');
              setStage('onboard_failed');
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addLog(`❌ ${String(err)}`, 'error');
        setStage('onboard_failed');
      }
    }
  };

  /* ── send input ── */
  const sendInput = async (text: string, logMsg?: string) => {
    if (!procId || interacting) return;
    setInteracting(true);
    try {
      await systemAPI.onboardInput(procId, text);
      if (logMsg) addLog(logMsg, 'info');
      setPendingPrompt('');
      setSelectOptions([]);
      setStage('onboarding');
    } catch {
      addLog('❌ Failed to send input', 'error');
    } finally {
      setInteracting(false);
    }
  };

  const handleConfirm = (yes: boolean) => {
    if (yes) sendInput(confirmYesDefault ? 'ENTER' : 'UP:1', '[Selected: Yes]');
    else     sendInput(confirmYesDefault ? 'DOWN:1' : 'ENTER', '[Selected: No]');
  };
  const handleMultiSelect = (indices: number[]) =>
    sendInput(indices.length === 0 ? 'ENTER' : `MULTISELECT:${indices.join(',')}`, `[Selected: ${indices.length} item(s)]`);
  const handleSelect = (chosenIdx: number) => {
    const defaultIdx = selectOptions.findIndex(o => o.selected);
    const diff = chosenIdx - (defaultIdx >= 0 ? defaultIdx : 0);
    const cmd = diff === 0 ? 'ENTER' : diff > 0 ? `DOWN:${diff}` : `UP:${Math.abs(diff)}`;
    sendInput(cmd, `[Selected: ${selectOptions[chosenIdx]?.label}]`);
  };
  const handleTextInput = (value: string) => sendInput(value, '[Input sent]');

  const isOnboarding =
    stage === 'onboarding' || stage === 'prompt_confirm' ||
    stage === 'prompt_select' || stage === 'prompt_multiselect' || stage === 'prompt_text';

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-xl">

        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <img src="/logo.png" alt="XSafeClaw" className="w-16 h-16 rounded-xl shadow-lg shadow-accent/25" />
          <div className="text-center">
            <p className="text-[22px] font-bold text-text-primary tracking-tight">Onboard Debugger</p>
            <p className="text-[13px] text-text-muted mt-0.5">Run and debug <span className="font-mono">openclaw onboard --install-daemon</span></p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">

          {/* idle */}
          {stage === 'idle' && (
            <div className="flex flex-col items-center gap-6 py-4">
              <Terminal className="w-14 h-14 text-text-muted/40" />
              <div className="text-center">
                <p className="text-sm font-medium text-text-secondary">Ready to run</p>
                <p className="text-[12px] text-text-muted mt-1">Click the button to start the onboard process.</p>
              </div>
              <button
                onClick={startOnboard}
                className="flex items-center gap-2.5 px-8 py-3 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/25"
              >
                <Terminal className="w-4 h-4" />
                Run Onboard
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* onboarding + prompts */}
          {isOnboarding && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                {stage === 'onboarding'
                  ? <Loader2 className="w-5 h-5 text-emerald-400 animate-spin flex-shrink-0" />
                  : <Terminal className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                }
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    {stage === 'onboarding' ? 'Configuring daemon…' : 'Interactive prompt'}
                  </p>
                  <p className="text-[12px] text-text-muted font-mono">openclaw onboard --install-daemon</p>
                </div>
              </div>

              <TerminalLog lines={logs} />

              {stage === 'prompt_confirm' && (
                <SelectPrompt
                  promptText={pendingPrompt}
                  options={[
                    { label: 'Yes, Continue', selected: confirmYesDefault },
                    { label: 'No, Cancel',    selected: !confirmYesDefault },
                  ]}
                  onChoice={idx => handleConfirm(idx === 0)}
                  disabled={interacting}
                />
              )}
              {stage === 'prompt_multiselect' && selectOptions.length > 0 && (
                <MultiSelectPrompt promptText={pendingPrompt} options={selectOptions} onConfirm={handleMultiSelect} disabled={interacting} />
              )}
              {stage === 'prompt_select' && selectOptions.length > 0 && (
                <SelectPrompt promptText={pendingPrompt} options={selectOptions} onChoice={handleSelect} disabled={interacting} />
              )}
              {stage === 'prompt_text' && (
                <TextPrompt promptText={pendingPrompt} onSubmit={handleTextInput} disabled={interacting} />
              )}
            </div>
          )}

          {/* failed */}
          {stage === 'onboard_failed' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">Onboard failed</p>
                  <p className="text-[12px] text-text-muted mt-1">Check the log for details.</p>
                </div>
              </div>
              <TerminalLog lines={logs} />
              <button
                onClick={startOnboard}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-surface-2 hover:bg-surface-1 border border-border text-text-primary font-medium rounded-xl transition-all text-sm"
              >
                <RefreshCw className="w-4 h-4" /> Retry Onboard
              </button>
            </div>
          )}

          {/* complete */}
          {stage === 'complete' && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle className="w-9 h-9 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-text-primary">Onboard complete!</p>
                <p className="text-[13px] text-text-secondary mt-2">OpenClaw daemon is configured and running.</p>
              </div>
              {logs.length > 0 && <TerminalLog lines={logs} />}
              <button
                onClick={startOnboard}
                className="flex items-center gap-2 px-6 py-2.5 bg-surface-2 hover:bg-surface-1 border border-border text-text-primary font-medium rounded-xl transition-all text-sm"
              >
                <RefreshCw className="w-4 h-4" /> Run Again
              </button>
            </div>
          )}
        </div>

        {/* Run again button when onboarding in progress */}
        {isOnboarding && (
          <div className="mt-4 text-center">
            <button
              onClick={startOnboard}
              className="flex items-center gap-1.5 mx-auto text-[12px] text-text-muted hover:text-text-primary transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Restart from scratch
            </button>
          </div>
        )}

        <p className="text-center text-[11px] text-text-muted mt-6">
          Onboard Debugger · XSafeClaw V1.0
        </p>
      </div>
    </div>
  );
}
