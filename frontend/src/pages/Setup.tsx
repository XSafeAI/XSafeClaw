/**
 * Setup / Onboarding page
 * Shown when OpenClaw CLI is not installed.
 *
 * Flow:
 *   checking → not_installed → installing → onboarding → complete
 *
 * The onboarding step uses a PTY-based backend so that interactive TUI
 * prompts from @clack/prompts (Yes/No, text inputs) are properly surfaced
 * to the user as interactive UI elements.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle,
  Download,
  Loader2,
  Settings2,
  Terminal,
  XCircle,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { systemAPI } from '../services/api';

/* ─────────────────────── types ─────────────────────── */
type Stage =
  | 'checking'
  | 'not_installed'
  | 'installing'
  | 'install_failed'
  | 'onboarding'           // streaming output, no prompt pending
  | 'prompt_confirm'       // waiting for Yes/No click
  | 'prompt_select'        // waiting for single-choice selection
  | 'prompt_multiselect'   // waiting for multi-checkbox selection
  | 'prompt_text'          // waiting for text input
  | 'onboard_failed'
  | 'complete';

interface SelectOption {
  label: string;
  selected: boolean;  // true = ● (current default in clack)
}

interface LogLine {
  id: number;
  text: string;
  kind: 'output' | 'info' | 'success' | 'error' | 'prompt';
}

let _lid = 0;

/* ─────────────────────── step indicator ─────────────────────── */
const STEPS = [
  { id: 1, label: 'Detect' },
  { id: 2, label: 'Install' },
  { id: 3, label: 'Onboard' },
  { id: 4, label: 'Ready' },
];

function stepIndex(stage: Stage): number {
  if (stage === 'checking' || stage === 'not_installed') return 1;
  if (stage === 'installing' || stage === 'install_failed') return 2;
  if (
    stage === 'onboarding' ||
    stage === 'prompt_confirm' ||
    stage === 'prompt_select' ||
    stage === 'prompt_text' ||
    stage === 'onboard_failed'
  )
    return 3;
  return 4;
}

function StepBar({ stage }: { stage: Stage }) {
  const active = stepIndex(stage);
  return (
    <div className="flex items-center mx-auto w-fit mb-10">
      {STEPS.map((step, i) => {
        const done = active > step.id;
        const current = active === step.id;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all
                  ${done ? 'bg-emerald-500 text-white' : current ? 'bg-accent text-white ring-2 ring-accent/40' : 'bg-surface-2 text-text-muted'}`}
              >
                {done ? <CheckCircle className="w-4 h-4" /> : step.id}
              </div>
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${current ? 'text-accent' : done ? 'text-emerald-400' : 'text-text-muted'}`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-16 h-0.5 mx-2 mb-5 transition-all ${done ? 'bg-emerald-500/60' : 'bg-border'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────── terminal log ─────────────────────── */
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
      {lines.length === 0 && (
        <span className="text-text-muted">Waiting for output…</span>
      )}
      {lines.map((l) => (
        <div
          key={l.id}
          className={
            l.kind === 'success'
              ? 'text-emerald-400'
              : l.kind === 'error'
              ? 'text-red-400'
              : l.kind === 'info'
              ? 'text-sky-400'
              : l.kind === 'prompt'
              ? 'text-yellow-300'
              : 'text-text-secondary'
          }
        >
          {l.kind === 'prompt' ? (
            <span>
              <span className="text-yellow-500 select-none">? </span>
              {l.text}
            </span>
          ) : (
            <>
              <span className="text-text-muted select-none">$ </span>
              {l.text}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── Yes / No prompt card ─────────────────────── */
/* ─────────────────────── Text input prompt card ─────────────────────── */
function TextPrompt({
  promptText,
  onSubmit,
  disabled,
}: {
  promptText: string;
  onSubmit: (value: string) => void;
  disabled: boolean;
}) {
  const [val, setVal] = useState('');
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Terminal className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <p className="text-sm text-text-primary font-medium">{promptText}</p>
      </div>
      {promptText.toLowerCase().includes('token') ||
      promptText.toLowerCase().includes('key') ||
      promptText.toLowerCase().includes('password') ? (
        <p className="text-[11px] text-text-muted">
          Get your token at{' '}
          <a
            href="https://openclaw.ai/settings"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            openclaw.ai/settings
          </a>
        </p>
      ) : null}
      <div className="flex gap-2">
        <input
          type="password"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && val.trim()) onSubmit(val.trim());
          }}
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

/* ─────────────────────── Select prompt (radio-button list) ─────────────────────── */
function SelectPrompt({
  promptText,
  options,
  onChoice,
  disabled,
}: {
  promptText: string;
  options: SelectOption[];
  onChoice: (index: number) => void;
  disabled: boolean;
}) {
  const defaultIdx = options.findIndex((o) => o.selected);
  const [chosen, setChosen] = useState(defaultIdx >= 0 ? defaultIdx : 0);

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Terminal className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <p className="text-sm text-text-primary font-medium">{promptText}</p>
      </div>

      <div className="space-y-2">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => setChosen(i)}
            disabled={disabled}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all text-left
              ${chosen === i
                ? 'bg-accent/15 border-accent/50 text-text-primary'
                : 'bg-surface-2 border-border text-text-secondary hover:border-accent/30'
              }`}
          >
            <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center
              ${chosen === i ? 'border-accent' : 'border-text-muted'}`}>
              {chosen === i && <span className="w-2 h-2 rounded-full bg-accent block" />}
            </span>
            <span className="text-sm">{opt.label}</span>
            {opt.selected && chosen !== i && (
              <span className="ml-auto text-[10px] text-text-muted">(default)</span>
            )}
          </button>
        ))}
      </div>

      <button
        onClick={() => onChoice(chosen)}
        disabled={disabled}
        className="w-full py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-semibold rounded-xl transition-all text-sm"
      >
        Confirm Selection
      </button>
    </div>
  );
}

/* ─────────────────────── Multi-select prompt (checkboxes) ─────────────────────── */
function MultiSelectPrompt({
  promptText,
  options,
  onConfirm,
  disabled,
}: {
  promptText: string;
  options: SelectOption[];
  onConfirm: (selectedIndices: number[]) => void;
  disabled: boolean;
}) {
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(options.map((o, i) => o.selected ? i : -1).filter(i => i >= 0))
  );

  const toggle = (i: number) =>
    setChecked(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Terminal className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <p className="text-sm text-text-primary font-medium">{promptText}</p>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => toggle(i)}
            disabled={disabled}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all text-left
              ${checked.has(i)
                ? 'bg-accent/15 border-accent/50 text-text-primary'
                : 'bg-surface-2 border-border text-text-secondary hover:border-accent/30'
              }`}
          >
            <span className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all
              ${checked.has(i) ? 'bg-accent border-accent' : 'border-text-muted'}`}>
              {checked.has(i) && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <span className="text-sm">{opt.label}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => onConfirm(Array.from(checked).sort((a, b) => a - b))}
        disabled={disabled}
        className="w-full py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-semibold rounded-xl transition-all text-sm"
      >
        Confirm ({checked.size} selected)
      </button>
    </div>
  );
}

/* ─────────────────────── main component ─────────────────────── */
interface SetupProps {
  onComplete: () => void;
}

export default function Setup({ onComplete }: SetupProps) {
  const [stage, setStage] = useState<Stage>('checking');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [procId, setProcId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string>('');
  const [selectOptions, setSelectOptions] = useState<SelectOption[]>([]);
  const [interacting, setInteracting] = useState(false);
  const [version, setVersion] = useState('');
  const [confirmYesDefault, setConfirmYesDefault] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = (text: string, kind: LogLine['kind'] = 'output') => {
    if (!text.trim()) return;
    setLogs((prev) => [...prev, { id: ++_lid, text, kind }]);
  };

  /* ── 1. Auto-detect on mount ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await systemAPI.status();
        const d = res.data;
        if (d.openclaw_installed) {
          setVersion(d.openclaw_version ?? '');
          setStage('complete');
        } else {
          setStage('not_installed');
        }
      } catch {
        setStage('not_installed');
      }
    })();
  }, []);

  /* ── 2. Install ── */
  const handleInstall = async () => {
    setStage('installing');
    setLogs([]);
    addLog('Running: npm install -g openclaw@latest', 'info');

    abortRef.current = new AbortController();
    try {
      const resp = await fetch('/api/system/install', {
        method: 'POST',
        signal: abortRef.current.signal,
      });
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
          if (!line.startsWith('data:')) continue;
          try {
            const d = JSON.parse(line.slice(5).trim());
            if (d.type === 'output' && d.text) addLog(d.text);
            else if (d.type === 'done') {
              if (d.success) {
                addLog('✅ Installation complete!', 'success');
                setStage('onboarding');
                await startOnboard();
              } else {
                addLog(`❌ npm exited with code ${d.exit_code}`, 'error');
                setStage('install_failed');
              }
            } else if (d.type === 'error') {
              addLog(`❌ ${d.message}`, 'error');
              setStage('install_failed');
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addLog(`❌ ${String(err)}`, 'error');
        setStage('install_failed');
      }
    }
  };

  /* ── 3. Onboard (PTY-based) ── */
  const startOnboard = async () => {
    addLog('Running: openclaw onboard --install-daemon', 'info');

    let pid: string;
    try {
      const res = await systemAPI.onboardStart();
      pid = res.data.proc_id;
      setProcId(pid);
    } catch (err) {
      addLog(`❌ Failed to start onboard: ${String(err)}`, 'error');
      setStage('onboard_failed');
      return;
    }

    abortRef.current = new AbortController();
    try {
      const resp = await fetch(systemAPI.onboardStreamUrl(pid), {
        signal: abortRef.current.signal,
      });
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
          if (line.startsWith(':')) continue; // keep-alive
          if (!line.startsWith('data:')) continue;
          try {
            const d = JSON.parse(line.slice(5).trim());

            if (d.type === 'output' && d.text) {
              addLog(d.text);

            } else if (d.type === 'prompt_confirm') {
              // ── Yes/No buttons ──
              addLog(d.text, 'prompt');
              setPendingPrompt(d.text);
              setSelectOptions([]);
              setConfirmYesDefault(d.yes_default !== false);
              setStage('prompt_confirm');

            } else if (d.type === 'prompt_multiselect') {
              // ── Checkbox list ──
              addLog(d.text, 'prompt');
              setPendingPrompt(d.text);
              setSelectOptions(d.options ?? []);
              setStage('prompt_multiselect');

            } else if (d.type === 'prompt_select') {
              // ── Radio-button list ──
              addLog(d.text, 'prompt');
              setPendingPrompt(d.text);
              setSelectOptions(d.options ?? []);
              setStage('prompt_select');

            } else if (d.type === 'prompt_text') {
              // ── Text input box ──
              addLog(d.text, 'prompt');
              setPendingPrompt(d.text);
              setSelectOptions([]);
              setStage('prompt_text');

            } else if (d.type === 'done') {
              if (d.success) {
                addLog('✅ Onboarding complete!', 'success');
                const vRes = await systemAPI.status();
                setVersion(vRes.data.openclaw_version ?? '');
                setStage('complete');
              } else {
                addLog(`❌ Onboard exited with code ${d.exit_code}`, 'error');
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

  /* ── Generic input sender ── */
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

  /* ── prompt_confirm: Yes / No ── */
  const handleConfirm = async (yes: boolean) => {
    // Use yes_default from backend to know which direction to move.
    // If Yes is currently highlighted (●Yes): ENTER to confirm, DOWN:1 for No.
    // If No is currently highlighted (●No):  UP:1 for Yes, ENTER for No.
    if (yes) {
      await sendInput(confirmYesDefault ? 'ENTER' : 'UP:1', '[Selected: Yes]');
    } else {
      await sendInput(confirmYesDefault ? 'DOWN:1' : 'ENTER', '[Selected: No]');
    }
  };

  /* ── prompt_multiselect: send space-toggles for each selected index ── */
  const handleMultiSelect = async (indices: number[]) => {
    const cmd = indices.length === 0
      ? 'ENTER'
      : `MULTISELECT:${indices.join(',')}`;
    await sendInput(cmd, `[Selected: ${indices.length} item(s)]`);
  };

  /* ── prompt_select: chosen index relative to default ── */
  const handleSelect = async (chosenIdx: number) => {
    const defaultIdx = selectOptions.findIndex((o) => o.selected);
    const diff = chosenIdx - (defaultIdx >= 0 ? defaultIdx : 0);
    let cmd: string;
    if (diff === 0)       cmd = 'ENTER';
    else if (diff > 0)    cmd = `DOWN:${diff}`;
    else                  cmd = `UP:${Math.abs(diff)}`;
    await sendInput(cmd, `[Selected: ${selectOptions[chosenIdx]?.label}]`);
  };

  /* ── prompt_text: free-text ── */
  const handleTextInput = async (value: string) => {
    await sendInput(value, '[Input sent]');
  };

  /* ── Retry helpers ── */
  const handleRetryInstall = () => { setLogs([]); handleInstall(); };
  const handleRetryOnboard = async () => { setLogs([]); setStage('onboarding'); await startOnboard(); };

  /* ─────────────── render ─────────────── */
  const isOnboarding =
    stage === 'onboarding' ||
    stage === 'prompt_confirm' ||
    stage === 'prompt_select' ||
    stage === 'prompt_multiselect' ||
    stage === 'prompt_text';

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-xl">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-accent/25">
            S
          </div>
          <div className="text-center">
            <p className="text-[22px] font-bold text-text-primary tracking-tight">SafeClaw</p>
            <p className="text-[13px] text-text-muted mt-0.5">Keeping Your Claw Safe.</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <StepBar stage={stage} />

          {/* ── checking ── */}
          {stage === 'checking' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="w-10 h-10 text-accent animate-spin" />
              <p className="text-text-secondary font-medium">Detecting OpenClaw…</p>
            </div>
          )}

          {/* ── not installed ── */}
          {stage === 'not_installed' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4 p-4 bg-warning/10 border border-warning/30 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">OpenClaw not found</p>
                  <p className="text-[12px] text-text-muted mt-1">
                    SafeClaw requires the{' '}
                    <span className="text-accent font-mono">openclaw</span> CLI.
                    Click below to install it automatically.
                  </p>
                </div>
              </div>
              <div className="bg-surface-2 rounded-xl p-4 text-[12px] font-mono text-text-secondary space-y-1">
                <p className="text-text-muted text-[11px] mb-2 font-sans">Commands that will be run:</p>
                <p><span className="text-text-muted">1.</span> npm install -g openclaw@latest</p>
                <p><span className="text-text-muted">2.</span> openclaw onboard --install-daemon</p>
              </div>
              <button
                onClick={handleInstall}
                className="w-full flex items-center justify-center gap-2.5 py-3 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/25"
              >
                <Download className="w-4 h-4" />
                Install OpenClaw
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ── installing ── */}
          {stage === 'installing' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-accent animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">Installing OpenClaw…</p>
                  <p className="text-[12px] text-text-muted">This may take a minute.</p>
                </div>
              </div>
              <TerminalLog lines={logs} />
            </div>
          )}

          {/* ── install failed ── */}
          {stage === 'install_failed' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">Installation failed</p>
                  <p className="text-[12px] text-text-muted mt-1">Check the log for details.</p>
                </div>
              </div>
              <TerminalLog lines={logs} />
              <button
                onClick={handleRetryInstall}
                className="w-full py-2.5 bg-surface-2 hover:bg-surface-1 border border-border text-text-primary font-medium rounded-xl transition-all text-sm"
              >
                Retry Installation
              </button>
            </div>
          )}

          {/* ── onboarding (streaming, prompts, failed) ── */}
          {isOnboarding && (
            <div className="flex flex-col gap-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                {stage === 'onboarding' ? (
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin flex-shrink-0" />
                ) : (
                  <Terminal className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                )}
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    {stage === 'onboarding' ? 'Configuring daemon…' : 'Interactive prompt'}
                  </p>
                  <p className="text-[12px] text-text-muted font-mono">
                    openclaw onboard --install-daemon
                  </p>
                </div>
              </div>

              {/* Terminal log */}
              <TerminalLog lines={logs} />

              {/* Confirm prompt */}
              {stage === 'prompt_confirm' && (
                <SelectPrompt
                  promptText={pendingPrompt}
                  options={[
                    { label: 'Yes, Continue', selected: confirmYesDefault },
                    { label: 'No, Cancel',    selected: !confirmYesDefault },
                  ]}
                  onChoice={(idx) => handleConfirm(idx === 0)}
                  disabled={interacting}
                />
              )}

              {/* Multi-select prompt (checkboxes) */}
              {stage === 'prompt_multiselect' && selectOptions.length > 0 && (
                <MultiSelectPrompt
                  promptText={pendingPrompt}
                  options={selectOptions}
                  onConfirm={handleMultiSelect}
                  disabled={interacting}
                />
              )}

              {/* Select prompt (radio-button list) */}
              {stage === 'prompt_select' && selectOptions.length > 0 && (
                <SelectPrompt
                  promptText={pendingPrompt}
                  options={selectOptions}
                  onChoice={handleSelect}
                  disabled={interacting}
                />
              )}

              {/* Text input prompt */}
              {stage === 'prompt_text' && (
                <TextPrompt
                  promptText={pendingPrompt}
                  onSubmit={handleTextInput}
                  disabled={interacting}
                />
              )}
            </div>
          )}

          {/* ── onboard failed ── */}
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
                onClick={handleRetryOnboard}
                className="w-full py-2.5 bg-surface-2 hover:bg-surface-1 border border-border text-text-primary font-medium rounded-xl transition-all text-sm"
              >
                Retry Onboard
              </button>
            </div>
          )}

          {/* ── complete ── */}
          {stage === 'complete' && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle className="w-9 h-9 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-text-primary">OpenClaw is ready!</p>
                {version && (
                  <p className="text-[12px] text-text-muted mt-1 font-mono">version: {version}</p>
                )}
                <p className="text-[13px] text-text-secondary mt-2">
                  SafeClaw is fully configured and ready to use.
                </p>
              </div>
              <button
                onClick={onComplete}
                className="flex items-center gap-2 px-8 py-3 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/25"
              >
                <Settings2 className="w-4 h-4" />
                Enter Dashboard
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* footer */}
        <p className="text-center text-[11px] text-text-muted mt-6">
          Powered by{' '}
          <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            OpenClaw
          </a>{' '}
          · SafeClaw V1.0
        </p>
      </div>
    </div>
  );
}
