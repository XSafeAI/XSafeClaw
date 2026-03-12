/**
 * Setup page — detect and install OpenClaw CLI.
 * If npm/Node.js is missing, auto-downloads Node.js first.
 * After installation completes, redirects to /configure for onboard wizard.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle, Download, Loader2, XCircle, ChevronRight, AlertTriangle, Terminal,
  ArrowDownToLine,
} from 'lucide-react';
import { systemAPI } from '../services/api';

type Stage =
  | 'checking'
  | 'not_installed'
  | 'downloading_node'
  | 'installing'
  | 'install_failed';

interface LogLine { id: number; text: string; kind: 'output' | 'info' | 'success' | 'error'; }
let _lid = 0;

const STEPS = [
  { id: 1, label: 'Detect' },
  { id: 2, label: 'Environment' },
  { id: 3, label: 'Install' },
];

function StepBar({ active }: { active: number }) {
  return (
    <div className="flex items-center mx-auto w-fit mb-8">
      {STEPS.map((step, i) => (
        <div key={step.id} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all
              ${active > step.id ? 'bg-emerald-500 text-white' : active === step.id ? 'bg-accent text-white ring-2 ring-accent/40' : 'bg-surface-2 text-text-muted'}`}>
              {active > step.id ? <CheckCircle className="w-4 h-4" /> : step.id}
            </div>
            <span className={`text-[11px] font-medium whitespace-nowrap ${active === step.id ? 'text-accent' : active > step.id ? 'text-emerald-400' : 'text-text-muted'}`}>
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && <div className={`w-16 h-0.5 mx-2 mb-5 ${active > step.id ? 'bg-emerald-500/60' : 'bg-border'}`} />}
        </div>
      ))}
    </div>
  );
}

function TerminalLog({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [lines]);
  return (
    <div ref={ref} className="bg-[#0d0d0d] border border-border rounded-xl p-4 font-mono text-[12px] leading-5 h-40 overflow-y-auto space-y-0.5">
      {lines.length === 0 && <span className="text-text-muted">Waiting...</span>}
      {lines.map(l => (
        <div key={l.id} className={l.kind === 'success' ? 'text-emerald-400' : l.kind === 'error' ? 'text-red-400' : l.kind === 'info' ? 'text-sky-400' : 'text-text-secondary'}>
          <span className="text-text-muted select-none">$ </span>{l.text}
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-text-secondary font-medium">{label}</span>
        <span className="text-text-muted font-mono">{percent}%</span>
      </div>
      <div className="w-full h-2 bg-surface-2 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent to-emerald-400 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface NodeStatus {
  step: 'resolving' | 'downloading' | 'extracting' | 'done';
  version?: string;
  percent?: number;
  progressText?: string;
}

export default function Setup() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('checking');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = (text: string, kind: LogLine['kind'] = 'output') => {
    if (!text.trim()) return;
    setLogs(prev => [...prev, { id: ++_lid, text, kind }]);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await systemAPI.status();
        if (res.data.openclaw_installed) {
          navigate('/configure', { replace: true });
        } else {
          setStage('not_installed');
        }
      } catch {
        setStage('not_installed');
      }
    })();
  }, [navigate]);

  const handleInstall = async () => {
    setStage('installing');
    setLogs([]);
    setNodeStatus(null);

    abortRef.current = new AbortController();
    try {
      const resp = await fetch('/api/system/install', { method: 'POST', signal: abortRef.current.signal });
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

            if (d.type === 'node_status') {
              setStage('downloading_node');
              if (d.step === 'resolving') {
                setNodeStatus({ step: 'resolving' });
              } else if (d.step === 'downloading') {
                setNodeStatus({ step: 'downloading', version: d.version, percent: 0 });
              } else if (d.step === 'extracting') {
                setNodeStatus(prev => ({ ...prev!, step: 'extracting' }));
              } else if (d.step === 'done') {
                setNodeStatus(prev => ({ ...prev!, step: 'done', version: d.version }));
              }
            } else if (d.type === 'node_progress') {
              setNodeStatus(prev => prev ? { ...prev, percent: d.percent, progressText: d.text } : prev);
            } else if (d.type === 'npm_install_start') {
              setStage('installing');
              setNodeStatus(null);
            } else if (d.type === 'output' && d.text) {
              addLog(d.text);
            } else if (d.type === 'done') {
              if (d.success) {
                addLog('Installation complete!', 'success');
                setTimeout(() => navigate('/configure', { replace: true }), 1000);
              } else {
                addLog(`npm exited with code ${d.exit_code}`, 'error');
                setStage('install_failed');
              }
            } else if (d.type === 'error') {
              addLog(d.message, 'error');
              setStage('install_failed');
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addLog(String(err), 'error');
        setStage('install_failed');
      }
    }
  };

  const stepActive =
    stage === 'checking' || stage === 'not_installed' ? 1
    : stage === 'downloading_node' ? 2
    : 3;

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src="/logo.png" alt="SafeClaw" className="w-16 h-16 rounded-xl shadow-lg shadow-accent/25" />
          <div className="text-center">
            <p className="text-[22px] font-bold text-text-primary tracking-tight">SafeClaw</p>
            <p className="text-[13px] text-text-muted mt-0.5">Keeping Your Claw Safe.</p>
          </div>
        </div>

        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <StepBar active={stepActive} />

          {/* Checking */}
          {stage === 'checking' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="w-10 h-10 text-accent animate-spin" />
              <p className="text-text-secondary font-medium">Detecting OpenClaw...</p>
            </div>
          )}

          {/* Not installed — prompt to start */}
          {stage === 'not_installed' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4 p-4 bg-warning/10 border border-warning/30 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">OpenClaw not found</p>
                  <p className="text-[12px] text-text-muted mt-1">
                    SafeClaw requires the <span className="text-accent font-mono">openclaw</span> CLI.
                    Click below to install — Node.js will be set up automatically if needed.
                  </p>
                </div>
              </div>
              <button onClick={handleInstall}
                className="w-full flex items-center justify-center gap-2.5 py-3 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/25">
                <Download className="w-4 h-4" /> Install OpenClaw <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Downloading / installing Node.js */}
          {stage === 'downloading_node' && nodeStatus && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-4 p-4 bg-sky-500/10 border border-sky-500/30 rounded-xl">
                <ArrowDownToLine className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">Setting up Node.js</p>
                  <p className="text-[12px] text-text-muted mt-1">
                    npm was not found on your system. Automatically downloading a portable Node.js runtime...
                  </p>
                </div>
              </div>

              <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
                {/* Resolving version */}
                <div className="flex items-center gap-3">
                  {nodeStatus.step === 'resolving' ? (
                    <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  )}
                  <span className={`text-[13px] ${nodeStatus.step === 'resolving' ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                    {nodeStatus.step === 'resolving' ? 'Resolving latest LTS version...' : `Node.js ${nodeStatus.version ?? ''} (LTS)`}
                  </span>
                </div>

                {/* Downloading */}
                {nodeStatus.step !== 'resolving' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      {nodeStatus.step === 'downloading' ? (
                        <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      )}
                      <span className={`text-[13px] ${nodeStatus.step === 'downloading' ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                        {nodeStatus.step === 'downloading' ? 'Downloading...' : 'Download complete'}
                      </span>
                    </div>
                    {nodeStatus.step === 'downloading' && nodeStatus.percent !== undefined && (
                      <div className="ml-7">
                        <ProgressBar
                          percent={nodeStatus.percent}
                          label={nodeStatus.progressText ?? 'Downloading...'}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Extracting */}
                {(nodeStatus.step === 'extracting' || nodeStatus.step === 'done') && (
                  <div className="flex items-center gap-3">
                    {nodeStatus.step === 'extracting' ? (
                      <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    )}
                    <span className={`text-[13px] ${nodeStatus.step === 'extracting' ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                      {nodeStatus.step === 'extracting' ? 'Extracting files...' : 'Node.js ready'}
                    </span>
                  </div>
                )}
              </div>

              {/* Terminal log underneath for verbose output */}
              {logs.length > 0 && <TerminalLog lines={logs} />}
            </div>
          )}

          {/* Installing OpenClaw via npm */}
          {stage === 'installing' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-accent animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">Installing OpenClaw...</p>
                  <p className="text-[12px] text-text-muted">Running <span className="font-mono text-accent">npm install -g openclaw@latest</span>. This may take a minute.</p>
                </div>
              </div>
              <TerminalLog lines={logs} />
            </div>
          )}

          {/* Failed */}
          {stage === 'install_failed' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">Installation failed</p>
                  <p className="text-[12px] text-text-muted mt-1">Check the log for details. You can also install Node.js and OpenClaw manually.</p>
                </div>
              </div>
              <TerminalLog lines={logs} />

              <div className="bg-[#0d0d0d] border border-border rounded-xl p-4 space-y-2">
                <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" /> Manual install commands
                </p>
                <div className="space-y-1.5 font-mono text-[12px]">
                  <p className="text-text-secondary"><span className="text-text-muted select-none"># </span><span className="text-sky-400">Install Node.js (if needed)</span></p>
                  <p className="text-emerald-400 select-all">curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && nvm install 22</p>
                  <p className="text-text-secondary mt-2"><span className="text-text-muted select-none"># </span><span className="text-sky-400">Install OpenClaw</span></p>
                  <p className="text-emerald-400 select-all">npm install -g openclaw@latest</p>
                </div>
              </div>

              <button onClick={() => { setLogs([]); setNodeStatus(null); handleInstall(); }}
                className="w-full py-2.5 bg-accent hover:bg-accent/90 text-white font-medium rounded-xl transition-all text-sm shadow-lg shadow-accent/25">
                Retry Installation
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-text-muted mt-6">
          Powered by SafeClaw
        </p>
      </div>
    </div>
  );
}
