/**
 * Setup page — detect and install an agent framework (OpenClaw or Hermes).
 * If no framework is found, the user chooses which one to install.
 * - OpenClaw: auto-installed via npm (Node.js bootstrapped if needed).
 * - Hermes: manual install guide (pip install).
 * After installation completes, redirects to /configure for onboard wizard.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle, Download, Loader2, XCircle, ChevronRight, AlertTriangle, Terminal,
  ArrowDownToLine, Box, Code2,
} from 'lucide-react';
import { systemAPI } from '../services/api';
import { useI18n } from '../i18n';

type Stage =
  | 'checking'
  | 'not_installed'
  | 'hermes_guide'
  | 'hermes_verifying'
  | 'downloading_node'
  | 'installing'
  | 'installing_hermes'
  | 'install_failed'
  | 'install_hermes_failed';

interface LogLine { id: number; text: string; kind: 'output' | 'info' | 'success' | 'error'; }
let _lid = 0;

function StepBar({ active, steps }: { active: number; steps: { id: number; label: string }[] }) {
  return (
    <div className="flex items-center mx-auto w-fit mb-8">
      {steps.map((step, i) => (
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
          {i < steps.length - 1 && <div className={`w-16 h-0.5 mx-2 mb-5 ${active > step.id ? 'bg-emerald-500/60' : 'bg-border'}`} />}
        </div>
      ))}
    </div>
  );
}

function TerminalLog({ lines, waitingText }: { lines: LogLine[]; waitingText?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [lines]);
  return (
    <div ref={ref} className="bg-[#0d0d0d] border border-border rounded-xl p-4 font-mono text-[12px] leading-5 h-40 overflow-y-auto space-y-0.5">
      {lines.length === 0 && <span className="text-text-muted">{waitingText}</span>}
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
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>('checking');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null);
  const [hermesError, setHermesError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const addLog = (text: string, kind: LogLine['kind'] = 'output') => {
    if (!text.trim()) return;
    setLogs(prev => [...prev, { id: ++_lid, text, kind }]);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await systemAPI.status();
        const d = res.data as any;
        if (d.openclaw_installed || d.hermes_installed) {
          navigate('/configure', { replace: true });
        } else {
          setStage('not_installed');
        }
      } catch {
        setStage('not_installed');
      }
    })();
  }, [navigate]);

  const handleInstallOpenClaw = async () => {
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
                addLog(t.setup.installComplete, 'success');
                try { localStorage.setItem('xsafeclaw_setup_platform', 'openclaw'); } catch { /* ignore */ }
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

  const handleInstallHermes = async () => {
    setStage('installing_hermes');
    setLogs([]);

    abortRef.current = new AbortController();
    try {
      const resp = await fetch('/api/system/install-hermes', { method: 'POST', signal: abortRef.current.signal });
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
            if (d.type === 'output' && d.text) {
              addLog(d.text);
            } else if (d.type === 'done') {
              if (d.success) {
                addLog((t.setup as any).hermesInstallComplete ?? 'Hermes installation complete!', 'success');
                try { localStorage.setItem('xsafeclaw_setup_platform', 'hermes'); } catch { /* ignore */ }
                setTimeout(() => navigate('/configure', { replace: true }), 1000);
              } else {
                addLog(`Install exited with code ${d.exit_code}`, 'error');
                setStage('install_hermes_failed');
              }
            } else if (d.type === 'error') {
              addLog(d.message, 'error');
              setStage('install_hermes_failed');
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addLog(String(err), 'error');
        setStage('install_hermes_failed');
      }
    }
  };

  const handleVerifyHermes = async () => {
    setStage('hermes_verifying');
    setHermesError('');
    try {
      const res = await systemAPI.status();
      const d = res.data as any;
      if (d.hermes_installed) {
        navigate('/configure', { replace: true });
      } else {
        setHermesError((t.setup as any).hermesNotDetected ?? 'Hermes not detected');
        setStage('hermes_guide');
      }
    } catch {
      setHermesError((t.setup as any).hermesNotDetected ?? 'Hermes not detected');
      setStage('hermes_guide');
    }
  };

  const steps = [
    { id: 1, label: t.setup.steps.detect },
    { id: 2, label: t.setup.steps.environment },
    { id: 3, label: t.setup.steps.install },
  ];

  const stepActive =
    stage === 'checking' || stage === 'not_installed' ? 1
    : stage === 'hermes_guide' || stage === 'hermes_verifying' || stage === 'downloading_node' ? 2
    : 3;

  const isHermesInstalling = stage === 'installing_hermes';
  const isHermesFailed = stage === 'install_hermes_failed';

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src="/logo.png" alt="XSafeClaw" className="w-16 h-16 object-contain rounded-xl shadow-lg shadow-accent/25" />
          <div className="text-center">
            <p className="text-[22px] font-bold text-text-primary tracking-tight">{t.setup.title}</p>
            <p className="text-[13px] text-text-muted mt-0.5">{t.setup.subtitle}</p>
          </div>
        </div>

        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          <StepBar active={stepActive} steps={steps} />

          {/* Checking */}
          {stage === 'checking' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="w-10 h-10 text-accent animate-spin" />
              <p className="text-text-secondary font-medium">{t.setup.detecting}</p>
            </div>
          )}

          {/* Not installed — choose framework */}
          {stage === 'not_installed' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4 p-4 bg-warning/10 border border-warning/30 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.setup.notFound}</p>
                  <p className="text-[12px] text-text-muted mt-1">{t.setup.notFoundDesc}</p>
                </div>
              </div>

              <p className="text-[13px] font-semibold text-text-primary text-center">
                {(t.setup as any).chooseTitle}
              </p>

              <div className="grid grid-cols-2 gap-4">
                {/* OpenClaw card */}
                <button
                  onClick={handleInstallOpenClaw}
                  className="flex flex-col items-center gap-3 p-5 bg-surface-2 hover:bg-surface-2/80 border border-border hover:border-accent/50 rounded-xl transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl bg-sky-500/15 flex items-center justify-center">
                    <Box className="w-6 h-6 text-sky-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">
                      {(t.setup as any).openclawName}
                    </p>
                    <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                      {(t.setup as any).openclawDesc}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-accent font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    <Download className="w-3 h-3" /> {t.setup.installBtn} <ChevronRight className="w-3 h-3" />
                  </div>
                </button>

                {/* Hermes card */}
                <button
                  onClick={handleInstallHermes}
                  className="flex flex-col items-center gap-3 p-5 bg-surface-2 hover:bg-surface-2/80 border border-border hover:border-violet-500/50 rounded-xl transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center">
                    <Code2 className="w-6 h-6 text-violet-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-text-primary group-hover:text-violet-400 transition-colors">
                      {(t.setup as any).hermesName}
                    </p>
                    <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                      {(t.setup as any).hermesDesc}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-violet-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    <Download className="w-3 h-3" /> {(t.setup as any).hermesGuideTitle} <ChevronRight className="w-3 h-3" />
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Hermes install guide */}
          {(stage === 'hermes_guide' || stage === 'hermes_verifying') && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-4 p-4 bg-violet-500/10 border border-violet-500/30 rounded-xl">
                <Code2 className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{(t.setup as any).hermesGuideTitle}</p>
                  <p className="text-[12px] text-text-muted mt-1">{(t.setup as any).hermesGuideDesc}</p>
                </div>
              </div>

              <div className="bg-[#0d0d0d] border border-border rounded-xl p-4 space-y-2">
                <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" /> {t.setup.manualCommands}
                </p>
                <div className="space-y-1.5 font-mono text-[12px]">
                  <p className="text-text-secondary">
                    <span className="text-text-muted select-none"># </span>
                    <span className="text-sky-400">{(t.setup as any).commentHermes}</span>
                  </p>
                  <p className="text-emerald-400 select-all break-all">curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash</p>
                  <p className="text-text-secondary mt-2">
                    <span className="text-text-muted select-none"># </span>
                    <span className="text-sky-400">GitHub</span>
                  </p>
                  <p className="text-emerald-400 select-all">https://github.com/NousResearch/hermes-agent</p>
                </div>
              </div>

              {hermesError && (
                <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[12px] text-red-400">{hermesError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setHermesError(''); setStage('not_installed'); }}
                  className="flex-1 py-2.5 border border-border hover:bg-surface-2 text-text-secondary font-medium rounded-xl transition-all text-sm"
                >
                  {t.setup.steps.detect}
                </button>
                <button
                  onClick={handleVerifyHermes}
                  disabled={stage === 'hermes_verifying'}
                  className="flex-[2] flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-medium rounded-xl transition-all text-sm shadow-lg shadow-violet-600/25"
                >
                  {stage === 'hermes_verifying' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> {(t.setup as any).hermesVerifying}</>
                  ) : (
                    <><CheckCircle className="w-4 h-4" /> {(t.setup as any).hermesVerifyBtn}</>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Downloading / installing Node.js (OpenClaw path) */}
          {stage === 'downloading_node' && nodeStatus && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-4 p-4 bg-sky-500/10 border border-sky-500/30 rounded-xl">
                <ArrowDownToLine className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.setup.nodeSetup}</p>
                  <p className="text-[12px] text-text-muted mt-1">{t.setup.nodeSetupDesc}</p>
                </div>
              </div>

              <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-3">
                  {nodeStatus.step === 'resolving' ? (
                    <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  )}
                  <span className={`text-[13px] ${nodeStatus.step === 'resolving' ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                    {nodeStatus.step === 'resolving' ? t.setup.resolvingLTS : t.setup.nodeLTS.replace('{v}', nodeStatus.version ?? '')}
                  </span>
                </div>

                {nodeStatus.step !== 'resolving' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      {nodeStatus.step === 'downloading' ? (
                        <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      )}
                      <span className={`text-[13px] ${nodeStatus.step === 'downloading' ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                        {nodeStatus.step === 'downloading' ? t.setup.downloading : t.setup.downloadComplete}
                      </span>
                    </div>
                    {nodeStatus.step === 'downloading' && nodeStatus.percent !== undefined && (
                      <div className="ml-7">
                        <ProgressBar
                          percent={nodeStatus.percent}
                          label={nodeStatus.progressText ?? t.setup.downloading}
                        />
                      </div>
                    )}
                  </div>
                )}

                {(nodeStatus.step === 'extracting' || nodeStatus.step === 'done') && (
                  <div className="flex items-center gap-3">
                    {nodeStatus.step === 'extracting' ? (
                      <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    )}
                    <span className={`text-[13px] ${nodeStatus.step === 'extracting' ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                      {nodeStatus.step === 'extracting' ? t.setup.extracting : t.setup.nodeReady}
                    </span>
                  </div>
                )}
              </div>

              {logs.length > 0 && <TerminalLog lines={logs} waitingText={t.setup.waiting} />}
            </div>
          )}

          {/* Installing OpenClaw via npm */}
          {stage === 'installing' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-accent animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.setup.installing}</p>
                  <p className="text-[12px] text-text-muted">{t.setup.installingDesc}</p>
                </div>
              </div>
              <TerminalLog lines={logs} waitingText={t.setup.waiting} />
            </div>
          )}

          {/* Installing Hermes via pip */}
          {isHermesInstalling && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-violet-400 animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{(t.setup as any).hermesInstalling}</p>
                  <p className="text-[12px] text-text-muted">{(t.setup as any).hermesInstallingDesc}</p>
                </div>
              </div>
              <TerminalLog lines={logs} waitingText={t.setup.waiting} />
            </div>
          )}

          {/* OpenClaw install failed */}
          {stage === 'install_failed' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.setup.installFailed}</p>
                  <p className="text-[12px] text-text-muted mt-1">{t.setup.installFailedDesc}</p>
                </div>
              </div>
              <TerminalLog lines={logs} waitingText={t.setup.waiting} />

              <div className="bg-[#0d0d0d] border border-border rounded-xl p-4 space-y-2">
                <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" /> {t.setup.manualCommands}
                </p>
                <div className="space-y-1.5 font-mono text-[12px]">
                  <p className="text-text-secondary"><span className="text-text-muted select-none"># </span><span className="text-sky-400">{t.setup.commentNode}</span></p>
                  <p className="text-emerald-400 select-all">curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && nvm install 22</p>
                  <p className="text-text-secondary mt-2"><span className="text-text-muted select-none"># </span><span className="text-sky-400">{t.setup.commentOpenClaw}</span></p>
                  <p className="text-emerald-400 select-all">npm install -g openclaw@latest</p>
                </div>
              </div>

              <button onClick={() => { setLogs([]); setNodeStatus(null); setStage('not_installed'); }}
                className="w-full py-2.5 bg-accent hover:bg-accent/90 text-white font-medium rounded-xl transition-all text-sm shadow-lg shadow-accent/25">
                {t.setup.retryInstall}
              </button>
            </div>
          )}

          {/* Hermes install failed */}
          {isHermesFailed && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.setup.installFailed}</p>
                  <p className="text-[12px] text-text-muted mt-1">{t.setup.installFailedDesc}</p>
                </div>
              </div>
              <TerminalLog lines={logs} waitingText={t.setup.waiting} />

              <div className="bg-[#0d0d0d] border border-border rounded-xl p-4 space-y-2">
                <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" /> {t.setup.manualCommands}
                </p>
                <div className="space-y-1.5 font-mono text-[12px]">
                  <p className="text-text-secondary"><span className="text-text-muted select-none"># </span><span className="text-sky-400">{(t.setup as any).commentHermes}</span></p>
                  <p className="text-emerald-400 select-all break-all">curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash</p>
                  <p className="text-text-secondary mt-2">
                    <span className="text-text-muted select-none"># </span>
                    <span className="text-sky-400">GitHub</span>
                  </p>
                  <p className="text-emerald-400 select-all">https://github.com/NousResearch/hermes-agent</p>
                </div>
              </div>

              <button onClick={() => { setLogs([]); setStage('not_installed'); }}
                className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-xl transition-all text-sm shadow-lg shadow-violet-600/25">
                {t.setup.retryInstall}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-text-muted mt-6">
          {t.common.poweredBy}
        </p>
      </div>
    </div>
  );
}
