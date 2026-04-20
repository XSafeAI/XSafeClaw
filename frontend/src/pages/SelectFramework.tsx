/**
 * SelectFramework — §38 framework picker.
 *
 * Renders when the backend was launched in picker mode (XSAFECLAW_PICKER_MODE=1
 * via the CLI supervisor). Every other route in AppRoutes redirects here as
 * long as ``runtime-platform-status.picker_mode === true``.
 *
 * User flow:
 *   1. Page loads → fetch /system/runtime-platform-status.
 *   2. If not in picker mode → show a "you got here by accident" stub with a
 *      "Go home" button.
 *   3. Otherwise render two cards (OpenClaw / Hermes). A card is disabled when
 *      the corresponding framework is not installed on this machine.
 *   4. User clicks a card → POST /system/runtime-platform-pick.
 *      - On 409 (not in picker mode): soft error, ask user to reload.
 *      - On 400 (framework not installed): soft error.
 *      - On 200: the picker backend will exit ~600 ms later.  We poll the
 *        runtime-platform-status endpoint until it either 200s with
 *        ``picker_mode === false`` (the real server came up) or fails long
 *        enough that we surface a manual-reload fallback.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Box, CheckCircle, ChevronRight, Code2, Loader2 } from 'lucide-react';
import { systemAPI } from '../services/api';
import { useI18n } from '../i18n';

type PickerStatus = {
  picker_mode: boolean;
  openclaw_installed: boolean;
  hermes_installed: boolean;
};

type Stage =
  | 'loading'
  | 'ready'           // Picker mode active, awaiting choice
  | 'not_picker'      // Accessed /select-framework but backend is a normal server
  | 'submitting'      // POST /runtime-platform-pick in flight
  | 'waiting_restart' // Pick succeeded, picker server is exiting; polling for real server
  | 'restart_failed'; // Real server never came back within the timeout

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 30_000;

export default function SelectFramework() {
  const { t } = useI18n();
  const tf = t.selectFramework as any;

  const [stage, setStage] = useState<Stage>('loading');
  const [status, setStatus] = useState<PickerStatus | null>(null);
  const [chosen, setChosen] = useState<'openclaw' | 'hermes' | null>(null);
  const [error, setError] = useState<string>('');

  // ── Initial picker-mode probe ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await systemAPI.runtimePlatformStatus();
        if (cancelled) return;
        setStatus(res.data);
        setStage(res.data.picker_mode ? 'ready' : 'not_picker');
      } catch {
        if (cancelled) return;
        // When the backend is wholly unreachable we default to "not picker"
        // rather than locking the UI — the global AppRoutes guard will
        // redirect elsewhere on the next tick anyway.
        setStage('not_picker');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(
    () => [
      {
        id: 'openclaw' as const,
        name: tf.openclawName,
        desc: tf.openclawDesc,
        badge: tf.openclawBadge,
        icon: Box,
        accent: 'sky',
        installed: status?.openclaw_installed ?? false,
      },
      {
        id: 'hermes' as const,
        name: tf.hermesName,
        desc: tf.hermesDesc,
        badge: tf.hermesBadge,
        icon: Code2,
        accent: 'violet',
        installed: status?.hermes_installed ?? false,
      },
    ],
    [status, tf],
  );

  // ── Pick handler ────────────────────────────────────────────────────────
  const handlePick = async (platform: 'openclaw' | 'hermes') => {
    if (stage !== 'ready') return;
    setError('');
    setChosen(platform);
    setStage('submitting');

    try {
      await systemAPI.pickRuntimePlatform(platform);
    } catch (err: any) {
      const code = err?.response?.status;
      const serverDetail: string | undefined = err?.response?.data?.detail;
      let msg = tf.errorNetwork as string;
      if (code === 409) msg = tf.errorNotPickerMode;
      else if (code === 400) msg = tf.errorNotInstalled;
      else if (serverDetail) msg = serverDetail;
      setError(msg);
      setStage('ready');
      setChosen(null);
      return;
    }

    // Picker server will os._exit shortly; poll until the real server shows up.
    setStage('waiting_restart');
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const res = await systemAPI.runtimePlatformStatus();
        if (res.data.picker_mode === false) {
          // Real server is up. Navigate to /setup — AppRoutes' status probe
          // will then forward on to /configure or /agent-valley.
          window.location.replace('/');
          return;
        }
      } catch {
        // Expected while the subprocess is being respawned; keep polling.
      }
    }
    setStage('restart_failed');
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img
            src="/logo.png"
            alt="XSafeClaw"
            className="w-16 h-16 object-contain rounded-xl shadow-lg shadow-accent/25"
          />
          <div className="text-center">
            <p className="text-[22px] font-bold text-text-primary tracking-tight">{tf.title}</p>
            <p className="text-[13px] text-text-muted mt-0.5">{tf.subtitle}</p>
          </div>
        </div>

        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-xl shadow-black/20">
          {stage === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-10">
              <Loader2 className="w-10 h-10 text-accent animate-spin" />
              <p className="text-text-secondary font-medium">{t.common.loading}</p>
            </div>
          )}

          {stage === 'not_picker' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <AlertTriangle className="w-10 h-10 text-warning" />
              <p className="text-sm font-semibold text-text-primary text-center">
                {tf.notInPickerMode}
              </p>
              <p className="text-[12px] text-text-muted text-center max-w-md">
                {tf.notInPickerModeHint}
              </p>
              <button
                onClick={() => window.location.replace('/')}
                className="mt-2 px-5 py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-white text-sm font-semibold transition-colors"
              >
                {tf.goHome}
              </button>
            </div>
          )}

          {(stage === 'ready' || stage === 'submitting') && (
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4 p-4 bg-accent/10 border border-accent/30 rounded-xl">
                <CheckCircle className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{tf.bothInstalled}</p>
                  <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                    {tf.description}
                  </p>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[12px] font-semibold text-red-300">{tf.errorTitle}</p>
                    <p className="text-[11px] text-text-muted mt-0.5">{error}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {cards.map((card) => {
                  const Icon = card.icon;
                  const disabled =
                    !card.installed || stage === 'submitting';
                  const isActive = chosen === card.id && stage === 'submitting';
                  const hoverBorder =
                    card.accent === 'sky'
                      ? 'hover:border-sky-400/60'
                      : 'hover:border-violet-500/60';
                  const iconBg =
                    card.accent === 'sky' ? 'bg-sky-500/15' : 'bg-violet-500/15';
                  const iconColor =
                    card.accent === 'sky' ? 'text-sky-400' : 'text-violet-300';
                  const hoverText =
                    card.accent === 'sky'
                      ? 'group-hover:text-sky-300'
                      : 'group-hover:text-violet-300';

                  return (
                    <button
                      key={card.id}
                      disabled={disabled}
                      onClick={() => handlePick(card.id)}
                      className={[
                        'flex flex-col items-center gap-3 p-5 rounded-xl transition-all group text-left',
                        'bg-surface-2 border border-border',
                        disabled
                          ? 'opacity-60 cursor-not-allowed'
                          : `hover:bg-surface-2/80 ${hoverBorder}`,
                        isActive ? 'border-accent/70 ring-2 ring-accent/40' : '',
                      ].join(' ')}
                    >
                      <div
                        className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center`}
                      >
                        {isActive ? (
                          <Loader2 className="w-6 h-6 text-accent animate-spin" />
                        ) : (
                          <Icon className={`w-6 h-6 ${iconColor}`} />
                        )}
                      </div>
                      <div className="text-center">
                        <p
                          className={`text-sm font-semibold text-text-primary ${hoverText} transition-colors`}
                        >
                          {card.name}
                        </p>
                        <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                          {card.desc}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-surface-0 border border-border text-text-muted">
                        {card.badge}
                      </span>
                      {!card.installed && (
                        <span className="text-[10px] text-warning font-medium">
                          {t.common.noData}
                        </span>
                      )}
                      {card.installed && !disabled && (
                        <span className="flex items-center gap-1 text-[11px] text-accent font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                          {tf.selectBtn} <ChevronRight className="w-3 h-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] text-text-muted text-center">{tf.tip}</p>
            </div>
          )}

          {stage === 'waiting_restart' && (
            <div className="flex flex-col items-center gap-4 py-10">
              <Loader2 className="w-10 h-10 text-accent animate-spin" />
              <p className="text-sm font-semibold text-text-primary">{tf.applied}</p>
              <p className="text-[12px] text-text-muted text-center">{tf.waitingRestart}</p>
            </div>
          )}

          {stage === 'restart_failed' && (
            <div className="flex flex-col items-center gap-4 py-10">
              <AlertTriangle className="w-10 h-10 text-warning" />
              <p className="text-sm font-semibold text-text-primary">{tf.restartFailed}</p>
              <p className="text-[12px] text-text-muted text-center max-w-md">
                {tf.restartFailedHint}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-5 py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-white text-sm font-semibold transition-colors"
              >
                {tf.reloadNow}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
