/**
 * Setup page — detect and install OpenClaw CLI and/or Nanobot CLI.
 * If at least one platform is installed, user can skip to the main app.
 * After installation completes, redirects to the platform-specific configure wizard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle, Download, Loader2, XCircle, ChevronRight, Terminal,
  ArrowDownToLine, Zap, Bot, Code2, Settings2, MapPin, Activity,
} from 'lucide-react';
import { systemAPI } from '../services/api';
import { useI18n } from '../i18n';

type Stage = 'checking' | 'selecting' | 'downloading_node' | 'installing_openclaw' | 'installing_nanobot' | 'installing_hermes' | 'install_failed' | 'install_hermes_failed';
type Platform = 'openclaw' | 'nanobot' | 'hermes';
type HostOs = 'windows' | 'macos' | 'linux';

interface PlatformInfo {
  installed: boolean | null;
  version?: string;
  configured?: boolean;
}

interface LogLine { id: number; text: string; kind: 'output' | 'info' | 'success' | 'error'; }
let _lid = 0;

function detectClientOs(): HostOs {
  if (typeof navigator === 'undefined') return 'linux';
  const fingerprint = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (fingerprint.includes('win')) return 'windows';
  if (fingerprint.includes('mac')) return 'macos';
  return 'linux';
}

function uvInstallCommand(hostOs: HostOs): string {
  if (hostOs === 'windows') {
    return 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"';
  }
  return 'curl -LsSf https://astral.sh/uv/install.sh | sh';
}

function nanobotManualSteps(hostOs: HostOs) {
  return {
    uv: uvInstallCommand(hostOs),
    install: 'uv tool install nanobot-ai',
    onboard: 'nanobot onboard',
  };
}

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

interface SetupCardProps {
  platform: Platform;
  info: PlatformInfo;
  installing: boolean;
  onInstall: () => void;
  // §50 — when the framework is already installed, clicking the card (or
  // its primary CTA button) jumps straight to that platform's Configure
  // wizard. Optional so a caller that doesn't want this behaviour (e.g.
  // a future read-only summary view) can simply omit the prop.
  onConfigure?: () => void;
  t: any;
}

function SetupCard({ platform, info, installing, onInstall, onConfigure, t }: SetupCardProps) {
  const isOpenClaw = platform === 'openclaw';
  const isHermes = platform === 'hermes';
  const name = isOpenClaw ? 'OpenClaw' : isHermes ? 'Hermes Agent' : 'Nanobot';
  const Icon = isOpenClaw ? Zap : isHermes ? Code2 : Bot;
  const isInstalled = info.installed === true;
  const isUnknown = info.installed === null;
  const accentColor = isOpenClaw ? 'border-blue-500/30 bg-blue-500/5' : isHermes ? 'border-violet-500/30 bg-violet-500/5' : 'border-cyan-500/30 bg-cyan-500/5';
  const iconBg = isOpenClaw ? 'bg-blue-500/15 text-blue-400' : isHermes ? 'bg-violet-500/15 text-violet-400' : 'bg-cyan-500/15 text-cyan-400';
  const badgeInstalled = isOpenClaw ? 'bg-blue-500/15 text-blue-400' : isHermes ? 'bg-violet-500/15 text-violet-400' : 'bg-cyan-500/15 text-cyan-400';
  const badgeNotInstalled = 'bg-surface-2 text-text-muted';

  // §50 — installed cards become a single big click target that opens the
  // matching Configure wizard. We only enable card-level clicking when
  // ``onConfigure`` is wired (caller decides) AND no install is in flight
  // for this card (so a stray click while the loader spins can't accidentally
  // navigate away from a running install). The CTA button at the bottom
  // also calls ``onConfigure``; we ``stopPropagation`` there so React
  // doesn't fire the parent click twice.
  const cardClickable = isInstalled && !installing && Boolean(onConfigure);
  const handleCardClick = cardClickable ? onConfigure : undefined;
  const handleCardKey = cardClickable
    ? (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onConfigure?.();
        }
      }
    : undefined;

  return (
    <div
      className={`border rounded-2xl p-6 transition-all ${isInstalled ? 'border-emerald-500/30 bg-emerald-500/5' : accentColor} ${cardClickable ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/10' : ''}`}
      role={cardClickable ? 'button' : undefined}
      tabIndex={cardClickable ? 0 : undefined}
      onClick={handleCardClick}
      onKeyDown={handleCardKey}
      aria-label={cardClickable ? `${t.setup.openConfigureAria || 'Open configure wizard for'} ${name}` : undefined}
    >
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isInstalled ? 'bg-emerald-500/15' : iconBg}`}>
          {isInstalled ? (
            <CheckCircle className="w-6 h-6 text-emerald-400" />
          ) : installing ? (
            <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
          ) : isUnknown ? (
            <XCircle className="w-6 h-6 text-text-muted" />
          ) : (
            <Icon className="w-6 h-6" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-text-primary">{name}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${isInstalled ? badgeInstalled : badgeNotInstalled}`}>
              {isInstalled
                ? (info.configured ? (t.setup.badgeReady || 'ready') : (t.setup.badgeInstalled || 'installed'))
                : isUnknown
                  ? (t.setup.badgeUnknown || 'unknown')
                  : (t.setup.badgeNotInstalled || 'not installed')}
            </span>
          </div>
          <p className="text-[12px] text-text-muted leading-relaxed">
            {isOpenClaw
              ? t.setup.openclawDesc
              : isHermes
                ? (t.setup as any).hermesDesc
                : t.setup.nanobotDesc}
          </p>
          {isInstalled && info.version && (
            <p className="text-[11px] text-text-muted mt-1 font-mono">
              v{info.version}
            </p>
          )}
        </div>
      </div>

      {info.installed === false && !installing && (
        <button
          onClick={onInstall}
          className={`w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-[13px] transition-all shadow ${
            isOpenClaw
              ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/25'
              : isHermes
                ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-600/25'
                : 'bg-cyan-500 hover:bg-cyan-600 text-white shadow-cyan-500/25'
          }`}
        >
          <Download className="w-4 h-4" />
          {isOpenClaw ? t.setup.installOpenClaw : isHermes ? ((t.setup as any).hermesGuideTitle || 'Install Hermes Agent') : t.setup.installNanobot}
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* §50 — installed → show explicit "Open Configure" CTA. The whole
          card is also clickable above; this button is for users who scan
          for buttons rather than realizing the card is interactive. */}
      {isInstalled && !installing && onConfigure && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onConfigure();
          }}
          className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-[13px] transition-all shadow bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25"
        >
          <Settings2 className="w-4 h-4" />
          {t.setup.openConfigure || 'Open Configure'}
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* §57 — installed → also show quick shortcuts to Agent Town and the
          Backend monitor. Kept as a secondary (outline) style so the primary
          "Open Configure" CTA remains visually dominant for first-time setup. */}
      {isInstalled && !installing && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              window.location.replace('/agent-valley');
            }}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
          >
            <MapPin className="w-3.5 h-3.5" />
            {t.setup.enterTown || 'Enter Town'}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              window.location.replace('/monitor');
            }}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
          >
            <Activity className="w-3.5 h-3.5" />
            {t.setup.enterBackend || 'Enter Backend'}
          </button>
        </div>
      )}

      {installing && (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          {isOpenClaw ? t.setup.installing : isHermes ? ((t.setup as any).hermesInstalling || 'Installing Hermes Agent...') : t.setup.nanobotInstalling}
        </div>
      )}
    </div>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const hostOs = detectClientOs();
  const manualNanobot = nanobotManualSteps(hostOs);
  const [stage, setStage] = useState<Stage>('checking');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null);
  const [openclawInfo, setOpenclawInfo] = useState<PlatformInfo>({ installed: null });
  const [nanobotInfo, setNanobotInfo] = useState<PlatformInfo>({ installed: null, configured: false });
  const [hermesInfo, setHermesInfo] = useState<PlatformInfo>({ installed: null, configured: false });
  const [installingPlatform, setInstallingPlatform] = useState<Platform | null>(null);
  const [detectionError, setDetectionError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const addLog = (text: string, kind: LogLine['kind'] = 'output') => {
    if (!text.trim()) return;
    setLogs(prev => [...prev, { id: ++_lid, text, kind }]);
  };

  const detectInstallStatus = useCallback(async () => {
    setStage('checking');
    setDetectionError('');
    try {
      const res = await systemAPI.installStatus();
      const d = res.data as any;
      const openclawOk = Boolean(d.openclaw_installed);
      const nanobotOk = Boolean(d.nanobot_installed);
      const hermesOk = Boolean(d.hermes_installed);

      setOpenclawInfo({
        installed: openclawOk,
        version: d.openclaw_version || undefined,
        configured: d.config_exists || false,
      });
      setNanobotInfo({
        installed: nanobotOk,
        version: d.nanobot_version || undefined,
        configured: nanobotOk && !Boolean(d.requires_nanobot_configure),
      });
      setHermesInfo({
        installed: hermesOk,
        version: d.hermes_version || undefined,
        configured: hermesOk && Boolean(d.config_exists),
      });
    } catch {
      setOpenclawInfo({ installed: null });
      setNanobotInfo({ installed: null, configured: false });
      setHermesInfo({ installed: null, configured: false });
      setDetectionError(t.setup.detectFailed || 'Runtime detection failed. Check the backend and retry.');
    } finally {
      setStage('selecting');
    }
  }, [t]);

  // Initial detection
  useEffect(() => {
    detectInstallStatus();
  }, [detectInstallStatus]);

  // OpenClaw install (existing SSE flow)
  const handleInstallOpenClaw = async () => {
    setInstallingPlatform('openclaw');
    setStage('installing_openclaw');
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
              setStage('installing_openclaw');
              setNodeStatus(null);
            } else if (d.type === 'output' && d.text) {
              addLog(d.text);
            } else if (d.type === 'done') {
              if (d.success) {
                addLog(t.setup.openclawInstallComplete, 'success');
                setOpenclawInfo(prev => ({ ...prev, installed: true, version: d.version, configured: false }));
                setTimeout(() => navigate('/openclaw_configure', { replace: true }), 1500);
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
    } finally {
      setInstallingPlatform(null);
    }
  };

  // Nanobot install (SSE flow only; config is created later in /nanobot_configure)
  const handleInstallNanobot = async () => {
    setInstallingPlatform('nanobot');
    setStage('installing_nanobot');
    setLogs([]);
    addLog(t.setup.nanobotInitStart, 'info');

    try {
      const resp = await fetch('/api/system/nanobot/install', { method: 'POST' });
      if (!resp.ok || !resp.body) {
        addLog(`HTTP ${resp.status} ${resp.statusText}`, 'error');
        addLog(t.setup.nanobotInstallFailedHint, 'info');
        setStage('install_failed');
        return;
      }
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let success = false;

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
              success = d.success;
              if (success) addLog(t.setup.nanobotInitSuccess, 'success');
              else addLog(`uv exited with code ${d.exit_code}`, 'error');
            } else if (d.type === 'error') {
              addLog(d.message, 'error');
              success = false;
            }
          } catch {}
        }
      }

      if (success) {
        addLog(t.setup.nanobotCliInstallComplete || t.setup.nanobotInitSuccess, 'success');
        setNanobotInfo(prev => ({ ...prev, installed: true, configured: false }));
        setTimeout(() => navigate('/nanobot_configure', { replace: true }), 1200);
      } else {
        // Show manual install hint
        addLog(t.setup.nanobotInstallFailedHint, 'info');
        setStage('install_failed');
      }
    } catch (err: any) {
      addLog(String(err), 'error');
      setStage('install_failed');
    } finally {
      setInstallingPlatform(null);
    }
  };

  const handleInstallHermes = async () => {
    setInstallingPlatform('hermes');
    setStage('installing_hermes');
    setLogs([]);

    abortRef.current = new AbortController();
    try {
      const resp = await fetch('/api/system/install-hermes', { method: 'POST', signal: abortRef.current.signal });
      if (!resp.ok || !resp.body) {
        addLog(`HTTP ${resp.status} ${resp.statusText}`, 'error');
        setStage('install_hermes_failed');
        return;
      }
      const reader = resp.body.getReader();
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
                setHermesInfo(prev => ({ ...prev, installed: true, configured: true }));
                try { localStorage.setItem('xsafeclaw_setup_platform', 'hermes'); } catch {}
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
    } finally {
      setInstallingPlatform(null);
    }
  };

  const handleRetry = () => {
    setLogs([]);
    setNodeStatus(null);
    detectInstallStatus();
  };

  const steps = [
    { id: 1, label: t.setup.steps.detect },
    { id: 2, label: t.setup.steps.environment },
    { id: 3, label: t.setup.steps.install },
  ];

  const stepActive =
    stage === 'checking' || stage === 'selecting' ? 1
    : stage === 'downloading_node' ? 2
    : 3;

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

          {/* Selecting platform */}
          {(stage === 'selecting' || stage === 'install_failed' || stage === 'install_hermes_failed') && (
            <div className="flex flex-col gap-5">
              <div className="text-center mb-2">
                <p className="text-[14px] font-semibold text-text-primary">{t.setup.selectTitle}</p>
                <p className="text-[12px] text-text-muted mt-1">{t.setup.selectDesc}</p>
              </div>

              {detectionError && (
                <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                  <XCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{t.setup.detectFailedTitle || 'Detection failed'}</p>
                    <p className="text-[12px] text-text-muted mt-1">{detectionError}</p>
                  </div>
                </div>
              )}

              <SetupCard
                platform="openclaw"
                info={openclawInfo}
                installing={installingPlatform === 'openclaw'}
                onInstall={handleInstallOpenClaw}
                onConfigure={() => navigate('/openclaw_configure', { replace: true })}
                t={t}
              />
              <SetupCard
                platform="nanobot"
                info={nanobotInfo}
                installing={installingPlatform === 'nanobot'}
                onInstall={handleInstallNanobot}
                onConfigure={() => navigate('/nanobot_configure', { replace: true })}
                t={t}
              />
              <SetupCard
                platform="hermes"
                info={hermesInfo}
                installing={installingPlatform === 'hermes'}
                onInstall={handleInstallHermes}
                onConfigure={() => navigate('/hermes_configure', { replace: true })}
                t={t}
              />

              {(stage === 'install_failed' || stage === 'install_hermes_failed') && (
                <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{t.setup.installFailed}</p>
                    <p className="text-[12px] text-text-muted mt-1">{t.setup.installFailedDesc}</p>
                  </div>
                </div>
              )}

              {(stage === 'install_failed' || stage === 'install_hermes_failed') && logs.length > 0 && (
                <TerminalLog lines={logs} waitingText={t.setup.waiting} />
              )}

              {(stage === 'install_failed' || stage === 'install_hermes_failed') && (
                <div className="bg-[#0d0d0d] border border-border rounded-xl p-4 space-y-2">
                  <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" /> {t.setup.manualCommands}
                  </p>
                  <div className="space-y-1.5 font-mono text-[12px]">
                    <p className="text-text-secondary"><span className="text-text-muted select-none"># </span><span className="text-sky-400">{t.setup.commentNode}</span></p>
                    <p className="text-emerald-400 select-all">curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && nvm install 22</p>
                    <p className="text-text-secondary mt-2"><span className="text-text-muted select-none"># </span><span className="text-sky-400">{t.setup.commentOpenClaw}</span></p>
                    <p className="text-emerald-400 select-all">npm install -g openclaw@latest</p>
                    <p className="text-text-secondary mt-2"><span className="text-text-muted select-none"># </span><span className="text-sky-400">{t.setup.commentNanobot}</span></p>
                    <p className="text-emerald-400 select-all break-all">{manualNanobot.uv}</p>
                    <p className="text-emerald-400 select-all">{manualNanobot.install}</p>
                    <p className="text-emerald-400 select-all">{manualNanobot.onboard}</p>
                    <p className="text-text-secondary mt-1 leading-5 not-italic font-sans">{t.setup.nanobotOfficialFlowHint}</p>
                    <p className="text-text-secondary mt-2"><span className="text-text-muted select-none"># </span><span className="text-sky-400">{(t.setup as any).commentHermes}</span></p>
                    <p className="text-emerald-400 select-all break-all">curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash</p>
                  </div>
                </div>
              )}

              {stage === 'install_failed' && nanobotInfo.installed === true && nanobotInfo.configured === false && (
                <button
                  onClick={() => navigate('/nanobot_configure', { replace: true })}
                  className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-600 text-white font-medium rounded-xl transition-all text-sm shadow-lg shadow-cyan-500/25"
                >
                  {t.setup.nanobotContinueConfigure || 'Continue to Nanobot Configure'}
                </button>
              )}

              {(stage === 'install_failed' || stage === 'install_hermes_failed' || detectionError) && (
                <button onClick={handleRetry}
                  className="w-full py-2.5 bg-accent hover:bg-accent/90 text-white font-medium rounded-xl transition-all text-sm shadow-lg shadow-accent/25">
                  {detectionError ? (t.setup.retryDetect || 'Retry detection') : t.setup.retryInstall}
                </button>
              )}
            </div>
          )}

          {/* Downloading / installing Node.js */}
          {stage === 'downloading_node' && nodeStatus && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-4 p-4 bg-sky-500/10 border border-sky-500/30 rounded-xl">
                <ArrowDownToLine className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.setup.nodeSetup}</p>
                  <p className="text-[12px] text-text-muted mt-1">
                    {t.setup.nodeSetupDesc}
                  </p>
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
          {stage === 'installing_openclaw' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-accent animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.setup.installingOpenClaw}</p>
                  <p className="text-[12px] text-text-muted">{t.setup.installingDesc}</p>
                </div>
              </div>
              <TerminalLog lines={logs} waitingText={t.setup.waiting} />
            </div>
          )}

          {/* Installing Nanobot */}
          {stage === 'installing_nanobot' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.setup.nanobotInstalling}</p>
                  <p className="text-[12px] text-text-muted">{t.setup.nanobotInstallingDesc}</p>
                </div>
              </div>
              <TerminalLog lines={logs} waitingText={t.setup.waiting} />
            </div>
          )}

          {/* Installing Hermes */}
          {stage === 'installing_hermes' && (
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
        </div>

        <p className="text-center text-[11px] text-text-muted mt-6">
          {t.common.poweredBy}
        </p>
      </div>
    </div>
  );
}
