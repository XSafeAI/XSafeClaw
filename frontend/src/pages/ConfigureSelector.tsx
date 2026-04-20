import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, ChevronRight, Loader2, Settings2, Zap, type LucideIcon } from 'lucide-react';
import { systemAPI, type InstallStatusResponse } from '../services/api';
import { useI18n } from '../i18n';

const copy = {
  zh: {
    eyebrow: '运行时配置',
    title: '选择要配置的平台',
    subtitle: 'OpenClaw 和 Nanobot 现在是独立运行时。只配置你实际要使用的平台即可。',
    loading: '正在读取安装状态...',
    openclawTitle: 'OpenClaw 配置向导',
    openclawDesc: '配置 OpenClaw 模型、网关、插件、渠道和 Guard 能力。',
    nanobotTitle: 'Nanobot 配置向导',
    nanobotDesc: '写入 ~/.nanobot/config.json，配置模型、API Key、gateway、WebSocket 和 Guard hook。',
    installed: '已安装',
    missing: '未安装',
    configured: '已配置',
    needsConfig: '待配置',
    enter: '进入配置',
    setup: '返回安装向导',
  },
  en: {
    eyebrow: 'Runtime Configuration',
    title: 'Choose a platform to configure',
    subtitle: 'OpenClaw and Nanobot are independent runtimes. Configure only the platform you plan to use.',
    loading: 'Reading install status...',
    openclawTitle: 'OpenClaw Configure',
    openclawDesc: 'Configure OpenClaw models, gateway, plugins, channels, and Guard capabilities.',
    nanobotTitle: 'Nanobot Configure',
    nanobotDesc: 'Write ~/.nanobot/config.json for model, API key, gateway, WebSocket, and Guard hook settings.',
    installed: 'Installed',
    missing: 'Missing',
    configured: 'Configured',
    needsConfig: 'Needs config',
    enter: 'Configure',
    setup: 'Back to Setup',
  },
};

interface ConfigureCardProps {
  title: string;
  desc: string;
  installed: boolean;
  configured: boolean;
  accent: 'blue' | 'cyan';
  icon: LucideIcon;
  onClick: () => void;
  labels: typeof copy.zh;
}

function ConfigureCard({ title, desc, installed, configured, accent, icon: Icon, onClick, labels }: ConfigureCardProps) {
  const accentClasses = accent === 'blue'
    ? 'border-blue-500/30 bg-blue-500/5 text-blue-300'
    : 'border-cyan-500/30 bg-cyan-500/5 text-cyan-300';
  const buttonClasses = accent === 'blue'
    ? 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/25'
    : 'bg-cyan-500 hover:bg-cyan-600 shadow-cyan-500/25';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left border rounded-3xl p-6 transition-all hover:-translate-y-1 hover:shadow-2xl ${accentClasses}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="w-12 h-12 rounded-2xl bg-surface-0/70 border border-white/10 flex items-center justify-center">
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${installed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
            {installed ? labels.installed : labels.missing}
          </span>
          <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${configured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {configured ? labels.configured : labels.needsConfig}
          </span>
        </div>
      </div>
      <h2 className="mt-6 text-xl font-black text-text-primary">{title}</h2>
      <p className="mt-3 min-h-[54px] text-[13px] leading-6 text-text-secondary">{desc}</p>
      <div className={`mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold text-white shadow-lg ${buttonClasses}`}>
        {labels.enter}
        <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
      </div>
    </button>
  );
}

export default function ConfigureSelector() {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const labels = copy[locale];
  const [status, setStatus] = useState<InstallStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await systemAPI.installStatus();
        if (!cancelled) setStatus(res.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const openclawInstalled = Boolean(status?.openclaw_installed);
  const nanobotInstalled = Boolean(status?.nanobot_installed);

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#070b10] text-text-primary">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 left-1/3 w-[520px] h-[520px] rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute top-1/3 right-0 w-[420px] h-[420px] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_25%),linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,44px_44px,44px_44px]" />
      </div>
      <div className="relative z-10 max-w-5xl mx-auto px-6 py-14">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-200">
              <Settings2 className="w-3.5 h-3.5" />
              {labels.eyebrow}
            </div>
            <h1 className="mt-5 text-4xl md:text-5xl font-black tracking-tight text-text-primary">{labels.title}</h1>
            <p className="mt-4 max-w-2xl text-sm md:text-base leading-7 text-text-secondary">{labels.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/setup', { replace: true })}
            className="hidden md:inline-flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-2 text-[13px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2"
          >
            {labels.setup}
          </button>
        </div>

        {loading ? (
          <div className="mt-12 flex items-center gap-3 rounded-2xl border border-border bg-surface-1/80 p-5 text-text-secondary">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            {labels.loading}
          </div>
        ) : (
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <ConfigureCard
              title={labels.openclawTitle}
              desc={labels.openclawDesc}
              installed={openclawInstalled}
              configured={Boolean(status?.config_exists)}
              accent="blue"
              icon={Zap}
              onClick={() => navigate(openclawInstalled ? '/openclaw_configure' : '/setup', { replace: true })}
              labels={labels}
            />
            <ConfigureCard
              title={labels.nanobotTitle}
              desc={labels.nanobotDesc}
              installed={nanobotInstalled}
              configured={Boolean(status?.nanobot_config_exists)}
              accent="cyan"
              icon={Bot}
              onClick={() => navigate(nanobotInstalled ? '/nanobot_configure' : '/setup', { replace: true })}
              labels={labels}
            />
          </div>
        )}
      </div>
    </div>
  );
}
