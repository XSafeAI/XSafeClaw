import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronLeft,
  Loader2,
  LogIn,
  LogOut,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { systemAPI, type CodexAuthStatusResponse } from '../services/api';

export const CODEX_CONFIG_STORAGE_KEY = 'xsafeclaw:codex_config';

export type CodexCliPathMode = 'auto' | 'manual';
export type CodexPermissionMode = 'read_only' | 'workspace_write' | 'full_access';
export type CodexDefaultModel = 'GPT-5.5' | 'GPT-5.4' | 'GPT-5.4-Mini' | 'GPT-5.3-Codex-Spark';
export type CodexReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh';
export type CodexSpeedOption = 'standard' | 'fast';

export interface CodexLocalConfig {
  chatgptLoggedIn: boolean;
  chatgptAccount: string;
  workspaceDir: string;
  cliPathMode: CodexCliPathMode;
  cliPath: string;
  permissionMode: CodexPermissionMode;
  defaultModel: CodexDefaultModel;
  defaultReasoning: CodexReasoningLevel;
  defaultSpeed: CodexSpeedOption;
}

export const DEFAULT_CODEX_CONFIG: CodexLocalConfig = {
  chatgptLoggedIn: false,
  chatgptAccount: '',
  workspaceDir: '~/workspace',
  cliPathMode: 'auto',
  cliPath: 'codex',
  permissionMode: 'workspace_write',
  defaultModel: 'GPT-5.5',
  defaultReasoning: 'xhigh',
  defaultSpeed: 'standard',
};

const modelOptions: CodexDefaultModel[] = ['GPT-5.5', 'GPT-5.4', 'GPT-5.4-Mini', 'GPT-5.3-Codex-Spark'];
const reasoningOptions: CodexReasoningLevel[] = ['low', 'medium', 'high', 'xhigh'];
const speedOptions: CodexSpeedOption[] = ['standard', 'fast'];
const permissionOptions: CodexPermissionMode[] = ['read_only', 'workspace_write', 'full_access'];

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

export function loadCodexConfig(): CodexLocalConfig {
  if (typeof window === 'undefined') return DEFAULT_CODEX_CONFIG;
  try {
    const raw = window.localStorage.getItem(CODEX_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CODEX_CONFIG;
    const parsed = JSON.parse(raw) as Partial<CodexLocalConfig>;
    return {
      chatgptLoggedIn: typeof parsed.chatgptLoggedIn === 'boolean'
        ? parsed.chatgptLoggedIn
        : DEFAULT_CODEX_CONFIG.chatgptLoggedIn,
      chatgptAccount: typeof parsed.chatgptAccount === 'string'
        ? parsed.chatgptAccount
        : DEFAULT_CODEX_CONFIG.chatgptAccount,
      workspaceDir: typeof parsed.workspaceDir === 'string' && parsed.workspaceDir.trim()
        ? parsed.workspaceDir
        : DEFAULT_CODEX_CONFIG.workspaceDir,
      cliPathMode: isOneOf(parsed.cliPathMode, ['auto', 'manual'])
        ? parsed.cliPathMode
        : DEFAULT_CODEX_CONFIG.cliPathMode,
      cliPath: typeof parsed.cliPath === 'string' && parsed.cliPath.trim()
        ? parsed.cliPath
        : DEFAULT_CODEX_CONFIG.cliPath,
      permissionMode: isOneOf(parsed.permissionMode, permissionOptions)
        ? parsed.permissionMode
        : DEFAULT_CODEX_CONFIG.permissionMode,
      defaultModel: isOneOf(parsed.defaultModel, modelOptions)
        ? parsed.defaultModel
        : DEFAULT_CODEX_CONFIG.defaultModel,
      defaultReasoning: isOneOf(parsed.defaultReasoning, reasoningOptions)
        ? parsed.defaultReasoning
        : DEFAULT_CODEX_CONFIG.defaultReasoning,
      defaultSpeed: isOneOf(parsed.defaultSpeed, speedOptions)
        ? parsed.defaultSpeed
        : DEFAULT_CODEX_CONFIG.defaultSpeed,
    };
  } catch {
    return DEFAULT_CODEX_CONFIG;
  }
}

export function saveCodexConfig(config: CodexLocalConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CODEX_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

const copy = {
  zh: {
    eyebrow: 'Codex 配置',
    title: '配置 Codex',
    subtitle: '连接 ChatGPT 账号，设置 Codex CLI、默认工作区和新会话偏好。',
    accountTitle: 'ChatGPT 账号',
    accountDesc: 'Codex 使用 ChatGPT 登录态运行。状态由本机 Codex CLI 检测。',
    checkingAuth: '检查登录状态',
    loginOpening: '正在打开浏览器',
    logoutRunning: '正在退出',
    loginHint: '请在系统默认浏览器中完成 ChatGPT 登录。',
    notSignedIn: '未登录 ChatGPT',
    signedIn: '已登录',
    login: '登录 ChatGPT 账号',
    relogin: '重新登录',
    logout: '退出登录',
    runtimeTitle: '运行环境',
    runtimeDesc: 'Codex CLI 状态先使用前端 mock 展示，后续再接入真实检测。',
    detected: '已检测',
    version: '版本',
    path: '路径',
    autoPath: 'PATH 自动检测',
    manualPath: '手动路径',
    cliPathLabel: 'Codex CLI 路径',
    redetect: '重新检测',
    detecting: '检测中',
    workspaceTitle: '默认工作区',
    workspaceDesc: '新建 Codex 会话时默认使用的目录。本轮仅保存文本路径。',
    workspaceLabel: '默认工作区目录',
    restoreDefault: '恢复默认',
    permissionTitle: '默认权限模式',
    permissionDesc: '采用 Codex CLI 的三档权限语义，作为新会话默认值。',
    readOnly: '只读',
    workspaceWrite: '工作区写入',
    fullAccess: '完全访问',
    readOnlyHint: '只能读取文件和上下文',
    workspaceWriteHint: '可写入工作区内文件',
    fullAccessHint: '完全访问本机环境',
    defaultsTitle: '新会话默认设置',
    defaultsDesc: '这些设置会作为 Codex 对话框的新会话默认模型偏好。',
    modelLabel: '默认模型',
    reasoningLabel: '默认推理',
    speedLabel: '默认速度',
    reasoningLow: '低',
    reasoningMedium: '中',
    reasoningHigh: '高',
    reasoningXhigh: '超高',
    speedStandard: '标准',
    speedFast: '快速',
    save: '保存配置',
    back: '返回后台',
    saved: 'Codex 配置已保存到本地。',
    localOnly: '仅保存到 localStorage',
  },
  en: {
    eyebrow: 'Codex Configuration',
    title: 'Configure Codex',
    subtitle: 'Connect ChatGPT, set Codex CLI behavior, choose a workspace, and define new-session defaults.',
    accountTitle: 'ChatGPT account',
    accountDesc: 'Codex runs through the ChatGPT signed-in account. Status is detected through the local Codex CLI.',
    checkingAuth: 'Checking status',
    loginOpening: 'Opening browser',
    logoutRunning: 'Logging out',
    loginHint: 'Complete ChatGPT login in the system browser.',
    notSignedIn: 'Not signed in',
    signedIn: 'Signed in',
    login: 'Log in to ChatGPT',
    relogin: 'Re-login',
    logout: 'Log out',
    runtimeTitle: 'Runtime environment',
    runtimeDesc: 'Codex CLI detection is shown as frontend mock data until the backend integration lands.',
    detected: 'Detected',
    version: 'Version',
    path: 'Path',
    autoPath: 'Auto detect from PATH',
    manualPath: 'Manual path',
    cliPathLabel: 'Codex CLI path',
    redetect: 'Refresh detection',
    detecting: 'Checking',
    workspaceTitle: 'Default workspace',
    workspaceDesc: 'The directory used when a new Codex session is created. This version stores a text path only.',
    workspaceLabel: 'Default workspace directory',
    restoreDefault: 'Restore default',
    permissionTitle: 'Default permission mode',
    permissionDesc: 'Uses Codex CLI permission semantics as the default for new sessions.',
    readOnly: 'Read only',
    workspaceWrite: 'Workspace write',
    fullAccess: 'Full access',
    readOnlyHint: 'Read files and context only',
    workspaceWriteHint: 'Write files inside the workspace',
    fullAccessHint: 'Full access to the local environment',
    defaultsTitle: 'New session defaults',
    defaultsDesc: 'These values become the default model preferences for the Codex composer.',
    modelLabel: 'Default model',
    reasoningLabel: 'Default reasoning',
    speedLabel: 'Default speed',
    reasoningLow: 'Low',
    reasoningMedium: 'Medium',
    reasoningHigh: 'High',
    reasoningXhigh: 'X-high',
    speedStandard: 'Standard',
    speedFast: 'Fast',
    save: 'Save configuration',
    back: 'Back to Backend',
    saved: 'Codex configuration saved locally.',
    localOnly: 'localStorage only',
  },
};

function reasoningLabel(level: CodexReasoningLevel, labels: typeof copy.en) {
  if (level === 'low') return labels.reasoningLow;
  if (level === 'medium') return labels.reasoningMedium;
  if (level === 'high') return labels.reasoningHigh;
  return labels.reasoningXhigh;
}

function speedLabel(speed: CodexSpeedOption, labels: typeof copy.en) {
  return speed === 'fast' ? labels.speedFast : labels.speedStandard;
}

function permissionLabel(mode: CodexPermissionMode, labels: typeof copy.en) {
  if (mode === 'read_only') return labels.readOnly;
  if (mode === 'full_access') return labels.fullAccess;
  return labels.workspaceWrite;
}

function permissionHint(mode: CodexPermissionMode, labels: typeof copy.en) {
  if (mode === 'read_only') return labels.readOnlyHint;
  if (mode === 'full_access') return labels.fullAccessHint;
  return labels.workspaceWriteHint;
}

function extractApiError(error: unknown): string {
  const maybeError = error as {
    response?: { data?: { detail?: unknown } };
    message?: unknown;
  };
  const detail = maybeError?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (typeof maybeError?.message === 'string' && maybeError.message.trim()) return maybeError.message;
  return 'Codex CLI request failed.';
}

export default function CodexConfigure() {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const labels = copy[locale] ?? copy.en;
  const initialConfig = useMemo(() => loadCodexConfig(), []);
  const [config, setConfig] = useState<CodexLocalConfig>(initialConfig);
  const [detecting, setDetecting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [authStatus, setAuthStatus] = useState<CodexAuthStatusResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authAction, setAuthAction] = useState<'login' | 'logout' | null>(null);
  const [authError, setAuthError] = useState('');

  const refreshCodexAuthStatus = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const response = await systemAPI.getCodexAuthStatus();
      setAuthStatus(response.data);
    } catch (error) {
      setAuthStatus(null);
      setAuthError(extractApiError(error));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCodexAuthStatus();
  }, [refreshCodexAuthStatus]);

  const updateConfig = (patch: Partial<CodexLocalConfig>) => {
    setConfig(current => ({ ...current, ...patch }));
    setSaved(false);
  };

  const handleLogin = async () => {
    setAuthAction('login');
    setAuthError('');
    try {
      const response = await systemAPI.loginCodexAuth();
      setAuthStatus(response.data);
    } catch (error) {
      setAuthError(extractApiError(error));
    } finally {
      setAuthAction(null);
    }
  };

  const handleLogout = async () => {
    setAuthAction('logout');
    setAuthError('');
    try {
      const response = await systemAPI.logoutCodexAuth();
      setAuthStatus(response.data);
    } catch (error) {
      setAuthError(extractApiError(error));
    } finally {
      setAuthAction(null);
    }
  };

  const handleRefreshDetection = () => {
    setDetecting(true);
    window.setTimeout(() => setDetecting(false), 520);
  };

  const handleSave = () => {
    saveCodexConfig(config);
    setSaved(true);
  };

  const codexLoggedIn = Boolean(authStatus?.logged_in);
  const authBusy = authLoading || authAction !== null;
  const authBadgeLabel = authLoading
    ? labels.checkingAuth
    : codexLoggedIn
      ? labels.signedIn
      : labels.notSignedIn;
  const authBadgeClass = authLoading
    ? 'bg-blue-500/15 text-blue-300'
    : codexLoggedIn
      ? 'bg-emerald-500/15 text-emerald-300'
      : 'bg-amber-500/15 text-amber-300';
  const authMessage = authError || (authAction === 'login' ? labels.loginHint : authStatus?.message || '');

  return (
    <div className="min-h-screen bg-surface-0 text-text-primary px-5 py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="XSafeClaw" className="h-12 w-12 rounded-xl object-contain shadow-lg shadow-accent/20" />
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
                <Sparkles className="h-3.5 w-3.5" />
                {labels.eyebrow}
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-text-primary">{labels.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{labels.subtitle}</p>
            </div>
          </div>
        </div>

        <main className="rounded-2xl border border-border bg-surface-1 p-6 shadow-xl shadow-black/20">
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-surface-0/70 p-5 lg:col-span-2">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-base font-bold text-text-primary">{labels.accountTitle}</h2>
                    <div
                      className={`inline-flex min-w-max flex-shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${authBadgeClass}`}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {authBadgeLabel}
                    </div>
                  </div>
                  <p className="mt-1 max-w-2xl text-[12px] leading-5 text-text-muted">{labels.accountDesc}</p>
                  {authMessage && (
                    <p className={`mt-2 max-w-2xl text-[12px] leading-5 ${authError ? 'text-rose-300' : 'text-text-muted'}`}>
                      {authMessage}
                    </p>
                  )}
                </div>
                <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:flex-shrink-0 lg:justify-end">
                  <button
                    type="button"
                    onClick={handleLogin}
                    disabled={authBusy}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {authAction === 'login' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    {authAction === 'login' ? labels.loginOpening : codexLoggedIn ? labels.relogin : labels.login}
                  </button>
                  {codexLoggedIn && (
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={authBusy}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-[13px] font-semibold text-text-secondary transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {authAction === 'logout' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                      {authAction === 'logout' ? labels.logoutRunning : labels.logout}
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="flex h-full flex-col rounded-xl border border-border bg-surface-0/70 p-5">
              <h2 className="text-base font-bold text-text-primary">{labels.defaultsTitle}</h2>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">{labels.defaultsDesc}</p>
              <div className="mt-5 grid gap-3">
                <label className="grid gap-2 text-[12px] font-semibold text-text-secondary sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center" htmlFor="codex-default-model">
                  {labels.modelLabel}
                  <select
                    id="codex-default-model"
                    aria-label={labels.modelLabel}
                    value={config.defaultModel}
                    onChange={(event) => updateConfig({ defaultModel: event.target.value as CodexDefaultModel })}
                    className="block w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                  >
                    {modelOptions.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-[12px] font-semibold text-text-secondary sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center" htmlFor="codex-default-reasoning">
                  {labels.reasoningLabel}
                  <select
                    id="codex-default-reasoning"
                    aria-label={labels.reasoningLabel}
                    value={config.defaultReasoning}
                    onChange={(event) => updateConfig({ defaultReasoning: event.target.value as CodexReasoningLevel })}
                    className="block w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                  >
                    {reasoningOptions.map(option => (
                      <option key={option} value={option}>{reasoningLabel(option, labels)}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-[12px] font-semibold text-text-secondary sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center" htmlFor="codex-default-speed">
                  {labels.speedLabel}
                  <select
                    id="codex-default-speed"
                    aria-label={labels.speedLabel}
                    value={config.defaultSpeed}
                    onChange={(event) => updateConfig({ defaultSpeed: event.target.value as CodexSpeedOption })}
                    className="block w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                  >
                    {speedOptions.map(option => (
                      <option key={option} value={option}>{speedLabel(option, labels)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface-0/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-text-primary">{labels.runtimeTitle}</h2>
                  <p className="mt-1 text-[12px] leading-5 text-text-muted">{labels.runtimeDesc}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {labels.detected}
                </span>
              </div>
              <div className="mt-5 grid gap-3 text-[13px] sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-surface-1 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">{labels.version}</p>
                  <p className="mt-2 font-mono font-semibold text-text-primary">0.14.0</p>
                </div>
                <div className="rounded-xl border border-border bg-surface-1 p-3 sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">{labels.path}</p>
                  <p className="mt-2 truncate font-mono font-semibold text-text-primary">{config.cliPath}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={config.cliPathMode === 'auto'}
                  onClick={() => updateConfig({ cliPathMode: 'auto', cliPath: config.cliPath || 'codex' })}
                  className={`rounded-xl px-4 py-2 text-[13px] font-semibold transition ${config.cliPathMode === 'auto' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'border border-border bg-surface-2 text-text-secondary hover:text-text-primary'}`}
                >
                  {labels.autoPath}
                </button>
                <button
                  type="button"
                  aria-pressed={config.cliPathMode === 'manual'}
                  onClick={() => updateConfig({ cliPathMode: 'manual' })}
                  className={`rounded-xl px-4 py-2 text-[13px] font-semibold transition ${config.cliPathMode === 'manual' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'border border-border bg-surface-2 text-text-secondary hover:text-text-primary'}`}
                >
                  {labels.manualPath}
                </button>
                <button
                  type="button"
                  onClick={handleRefreshDetection}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 text-[13px] font-semibold text-text-secondary transition hover:text-text-primary"
                >
                  {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {detecting ? labels.detecting : labels.redetect}
                </button>
              </div>
              <label className="mt-4 block text-[12px] font-semibold text-text-secondary" htmlFor="codex-cli-path">
                {labels.cliPathLabel}
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
                <Terminal className="h-4 w-4 text-text-muted" />
                <input
                  id="codex-cli-path"
                  aria-label={labels.cliPathLabel}
                  value={config.cliPath}
                  disabled={config.cliPathMode === 'auto'}
                  onChange={(event) => updateConfig({ cliPath: event.target.value })}
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text-primary outline-none disabled:text-text-muted"
                />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface-0/70 p-5">
              <h2 className="text-base font-bold text-text-primary">{labels.workspaceTitle}</h2>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">{labels.workspaceDesc}</p>
              <label className="mt-5 block text-[12px] font-semibold text-text-secondary" htmlFor="codex-workspace-dir">
                {labels.workspaceLabel}
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="codex-workspace-dir"
                  aria-label={labels.workspaceLabel}
                  value={config.workspaceDir}
                  onChange={(event) => updateConfig({ workspaceDir: event.target.value })}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => updateConfig({ workspaceDir: DEFAULT_CODEX_CONFIG.workspaceDir })}
                  className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-[12px] font-semibold text-text-secondary transition hover:text-text-primary"
                >
                  {labels.restoreDefault}
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface-0/70 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-text-primary">{labels.permissionTitle}</h2>
                  <p className="mt-1 text-[12px] leading-5 text-text-muted">{labels.permissionDesc}</p>
                </div>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {permissionOptions.map(option => (
                  <button
                    key={option}
                    type="button"
                    aria-label={permissionLabel(option, labels)}
                    aria-pressed={config.permissionMode === option}
                    onClick={() => updateConfig({ permissionMode: option })}
                    className={`min-h-24 rounded-xl border p-3 text-left transition ${config.permissionMode === option ? 'border-blue-500/50 bg-blue-500/10 text-text-primary' : 'border-border bg-surface-2 text-text-secondary hover:text-text-primary'}`}
                  >
                    <span className="block text-sm font-bold">{permissionLabel(option, labels)}</span>
                    <span className="mt-2 block text-[11px] leading-4 text-text-muted">{permissionHint(option, labels)}</span>
                  </button>
                ))}
              </div>
            </section>

          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <div className="min-h-5 text-[12px] font-semibold text-emerald-300">
              {saved ? labels.saved : ''}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/backend', { replace: true })}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-[13px] font-semibold text-text-secondary transition hover:text-text-primary"
              >
                <ChevronLeft className="h-4 w-4" />
                {labels.back}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-700"
              >
                <Save className="h-4 w-4" />
                {labels.save}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
