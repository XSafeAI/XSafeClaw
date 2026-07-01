import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Loader2,
  LogIn,
  LogOut,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n';
import {
  assetsAPI,
  systemAPI,
  type CodexAuthStatusResponse,
  type CodexModelCatalogItem,
  type CodexRuntimeStatusResponse,
  type DirectoryBrowseEntry,
} from '../services/api';
import {
  catalogModelsOrFallback,
  codexReasoningOptionsForModel,
  codexSpeedOptionsForModel,
  FALLBACK_CODEX_MODEL_CATALOG,
  findCodexModel,
  normalizeCodexSelection,
} from './codexModelCatalog';

export const CODEX_CONFIG_STORAGE_KEY = 'xsafeclaw:codex_config';
const CODEX_CONFIG_VERSION = 2;

export type CodexCliPathMode = 'auto' | 'manual';
export type CodexPermissionMode = 'read_only' | 'workspace_write' | 'full_access';
export type CodexDefaultModel = string;
export type CodexReasoningLevel = string;
export type CodexSpeedOption = string;

export interface CodexLocalConfig {
  configVersion: number;
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
  configVersion: CODEX_CONFIG_VERSION,
  chatgptLoggedIn: false,
  chatgptAccount: '',
  workspaceDir: '',
  cliPathMode: 'auto',
  cliPath: 'codex',
  permissionMode: 'workspace_write',
  defaultModel: 'gpt-5.5',
  defaultReasoning: 'xhigh',
  defaultSpeed: 'standard',
};

const reasoningOptions: CodexReasoningLevel[] = ['low', 'medium', 'high', 'xhigh'];
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
    const isLegacyImplicitWorkspace = parsed.configVersion !== CODEX_CONFIG_VERSION
      && parsed.workspaceDir === '~/workspace';
    return normalizeCodexSelection({
      configVersion: CODEX_CONFIG_VERSION,
      chatgptLoggedIn: typeof parsed.chatgptLoggedIn === 'boolean'
        ? parsed.chatgptLoggedIn
        : DEFAULT_CODEX_CONFIG.chatgptLoggedIn,
      chatgptAccount: typeof parsed.chatgptAccount === 'string'
        ? parsed.chatgptAccount
        : DEFAULT_CODEX_CONFIG.chatgptAccount,
      workspaceDir: typeof parsed.workspaceDir === 'string' && parsed.workspaceDir.trim() && !isLegacyImplicitWorkspace
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
      defaultModel: typeof parsed.defaultModel === 'string' && parsed.defaultModel.trim()
        ? parsed.defaultModel
        : DEFAULT_CODEX_CONFIG.defaultModel,
      defaultReasoning: isOneOf(parsed.defaultReasoning, reasoningOptions)
        ? parsed.defaultReasoning
        : DEFAULT_CODEX_CONFIG.defaultReasoning,
      defaultSpeed: typeof parsed.defaultSpeed === 'string' && parsed.defaultSpeed.trim()
        ? parsed.defaultSpeed
        : DEFAULT_CODEX_CONFIG.defaultSpeed,
    }, FALLBACK_CODEX_MODEL_CATALOG);
  } catch {
    return DEFAULT_CODEX_CONFIG;
  }
}

export function saveCodexConfig(config: CodexLocalConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CODEX_CONFIG_STORAGE_KEY, JSON.stringify({
    ...config,
    configVersion: CODEX_CONFIG_VERSION,
  }));
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
    runtimeDesc: '通过 Codex CLI 官方诊断命令检测安装、认证和运行环境状态。',
    runtimeReady: '已就绪',
    runtimeWarning: '警告',
    runtimeNeedsLogin: '需要登录',
    runtimeInstalled: '已安装',
    runtimeMissing: '未检测到',
    runtimeError: '错误',
    unknownValue: '未获取',
    version: '版本',
    path: '路径',
    autoPath: 'PATH 自动检测',
    manualPath: '手动路径',
    cliPathLabel: 'Codex CLI 路径',
    redetect: '重新检测',
    detecting: '检测中',
    workspaceTitle: '工作区目录',
    workspaceDesc: '新建 Codex 会话时默认使用的目录。本轮仅保存文本路径。',
    workspaceLabel: '默认工作区目录',
    restoreDefault: '恢复默认',
    permissionTitle: '默认权限模式',
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
    runtimeDesc: 'Detected through official Codex CLI diagnostics for installation, auth, and runtime health.',
    runtimeReady: 'Ready',
    runtimeWarning: 'Warning',
    runtimeNeedsLogin: 'Needs login',
    runtimeInstalled: 'Installed',
    runtimeMissing: 'Not detected',
    runtimeError: 'Error',
    unknownValue: 'Unavailable',
    version: 'Version',
    path: 'Path',
    autoPath: 'Auto detect from PATH',
    manualPath: 'Manual path',
    cliPathLabel: 'Codex CLI path',
    redetect: 'Refresh detection',
    detecting: 'Checking',
    workspaceTitle: 'Workspace directory',
    workspaceDesc: 'The directory used when a new Codex session is created. This version stores a text path only.',
    workspaceLabel: 'Default workspace directory',
    restoreDefault: 'Restore default',
    permissionTitle: 'Default permission mode',
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

const workspaceBrowseCopy = {
  zh: {
    desc: '新建 Codex 会话时使用的目录。',
    browseWorkspace: '选择目录',
    browseTitle: '选择工作区目录',
    browseDesc: '从本机目录中选择 Codex 会话默认工作区。',
    currentFolder: '当前目录',
    upOneLevel: '上一级',
    refresh: '刷新',
    browseHint: '点击目录继续浏览，确认后写入工作区输入框。',
    browseEmpty: '当前目录没有可浏览的子目录',
    browseError: '目录读取失败，请检查路径后重试。',
    useThisFolder: '使用当前目录',
    cancel: '取消',
    pathPlaceholder: '尚未选择目录',
    hidden: '隐藏',
  },
  en: {
    desc: 'The directory used when a new Codex session is created.',
    browseWorkspace: 'Browse folders',
    browseTitle: 'Select workspace directory',
    browseDesc: 'Choose the default workspace folder for new Codex sessions.',
    currentFolder: 'Current folder',
    upOneLevel: 'Up one level',
    refresh: 'Refresh',
    browseHint: 'Open a folder to keep browsing, then confirm to fill the workspace field.',
    browseEmpty: 'No browsable folders here',
    browseError: 'Could not read this folder. Check the path and try again.',
    useThisFolder: 'Use this folder',
    cancel: 'Cancel',
    pathPlaceholder: 'No folder selected',
    hidden: 'hidden',
  },
};

function reasoningLabel(level: CodexReasoningLevel, labels: typeof copy.en) {
  if (level === 'low') return labels.reasoningLow;
  if (level === 'medium') return labels.reasoningMedium;
  if (level === 'high') return labels.reasoningHigh;
  if (level === 'xhigh') return labels.reasoningXhigh;
  return level;
}

function speedLabel(speed: CodexSpeedOption, labels: typeof copy.en) {
  if (speed === 'standard') return labels.speedStandard;
  if (speed === 'fast' || speed === 'priority') return labels.speedFast;
  return speed;
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
  const workspaceLabels = workspaceBrowseCopy[locale] ?? workspaceBrowseCopy.en;
  const initialConfig = useMemo(() => loadCodexConfig(), []);
  const [config, setConfig] = useState<CodexLocalConfig>(initialConfig);
  const [detecting, setDetecting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [authStatus, setAuthStatus] = useState<CodexAuthStatusResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authAction, setAuthAction] = useState<'login' | 'logout' | null>(null);
  const [authError, setAuthError] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<CodexRuntimeStatusResponse | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState('');
  const [codexModels, setCodexModels] = useState<CodexModelCatalogItem[]>(FALLBACK_CODEX_MODEL_CATALOG);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [browsePath, setBrowsePath] = useState('');
  const [browseParentPath, setBrowseParentPath] = useState<string | null>(null);
  const [browseRootPath, setBrowseRootPath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<DirectoryBrowseEntry[]>([]);

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

  const refreshCodexRuntimeStatus = useCallback(async (refresh?: boolean) => {
    if (refresh) {
      setDetecting(true);
    } else {
      setRuntimeLoading(true);
    }
    setRuntimeError('');
    try {
      const response = refresh
        ? await systemAPI.getCodexRuntimeStatus(true)
        : await systemAPI.getCodexRuntimeStatus();
      setRuntimeStatus(response.data);
    } catch (error) {
      setRuntimeError(extractApiError(error));
    } finally {
      setRuntimeLoading(false);
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    void refreshCodexAuthStatus();
    void refreshCodexRuntimeStatus();
  }, [refreshCodexAuthStatus, refreshCodexRuntimeStatus]);

  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      try {
        const response = await systemAPI.getCodexModels();
        const models = catalogModelsOrFallback(response.data.models);
        if (cancelled) return;
        setCodexModels(models);
        setConfig(current => normalizeCodexSelection(current, models));
      } catch {
        if (cancelled) return;
        setCodexModels(FALLBACK_CODEX_MODEL_CATALOG);
        setConfig(current => normalizeCodexSelection(current, FALLBACK_CODEX_MODEL_CATALOG));
      }
    }
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateConfig = (patch: Partial<CodexLocalConfig>) => {
    setConfig(current => normalizeCodexSelection({ ...current, ...patch }, codexModels));
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
    void refreshCodexRuntimeStatus(true);
  };

  const loadBrowse = useCallback(async (path?: string) => {
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const response = await assetsAPI.browseDirectories(path);
      setBrowsePath(response.data.current_path);
      setBrowseParentPath(response.data.parent_path);
      setBrowseRootPath(response.data.root_path);
      setBrowseEntries(response.data.entries);
    } catch (error) {
      setBrowseError(extractApiError(error) || workspaceLabels.browseError);
    } finally {
      setBrowseLoading(false);
    }
  }, [workspaceLabels.browseError]);

  const handleOpenBrowse = () => {
    setBrowseOpen(true);
    const seedPath = config.workspaceDir.trim();
    void loadBrowse(seedPath || undefined);
  };

  const handleCloseBrowse = () => {
    setBrowseOpen(false);
    setBrowseError('');
  };

  const handleSelectBrowsePath = () => {
    if (!browsePath) return;
    updateConfig({ workspaceDir: browsePath });
    setBrowseOpen(false);
  };

  const handleSave = () => {
    saveCodexConfig(normalizeCodexSelection(config, codexModels));
    setSaved(true);
  };

  const selectedCodexModel = findCodexModel(codexModels, config.defaultModel);
  const dynamicReasoningOptions = codexReasoningOptionsForModel(selectedCodexModel);
  const dynamicSpeedOptions = codexSpeedOptionsForModel(selectedCodexModel);

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
  const runtimeVisualStatus = runtimeLoading
    ? 'checking'
    : runtimeError
      ? 'error'
      : runtimeStatus?.status ?? 'error';
  const runtimeBadgeLabel = runtimeVisualStatus === 'checking'
    ? labels.detecting
    : runtimeVisualStatus === 'ready'
      ? labels.runtimeReady
      : runtimeVisualStatus === 'warning'
        ? labels.runtimeWarning
        : runtimeVisualStatus === 'needs_login'
          ? labels.runtimeNeedsLogin
          : runtimeVisualStatus === 'installed'
            ? labels.runtimeInstalled
            : runtimeVisualStatus === 'missing'
              ? labels.runtimeMissing
              : labels.runtimeError;
  const runtimeBadgeClass = runtimeVisualStatus === 'checking'
    ? 'bg-blue-500/15 text-blue-300'
    : runtimeVisualStatus === 'ready'
      ? 'bg-emerald-500/15 text-emerald-300'
      : runtimeVisualStatus === 'warning' || runtimeVisualStatus === 'needs_login' || runtimeVisualStatus === 'installed'
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-rose-500/15 text-rose-300';
  const runtimeVersion = runtimeLoading ? labels.detecting : runtimeStatus?.version || labels.unknownValue;
  const runtimePath = runtimeLoading ? labels.detecting : runtimeStatus?.path || runtimeStatus?.entry_path || labels.unknownValue;
  const runtimeWarnings = runtimeStatus?.warnings ?? [];
  const runtimeProblem = runtimeError || runtimeStatus?.error || '';

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
                  {!codexLoggedIn && (
                    <button
                      type="button"
                      onClick={handleLogin}
                      disabled={authBusy}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {authAction === 'login' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      {authAction === 'login' ? labels.loginOpening : labels.login}
                    </button>
                  )}
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
                    {codexModels.map(option => (
                      <option key={option.id} value={option.id}>{option.display_name || option.model || option.id}</option>
                    ))}
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
                    {dynamicReasoningOptions.map(option => (
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
                    {dynamicSpeedOptions.map(option => (
                      <option key={option.id} value={option.id}>{speedLabel(option.id, labels)}</option>
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
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${runtimeBadgeClass}`}>
                  {runtimeVisualStatus === 'checking'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {runtimeBadgeLabel}
                </span>
              </div>
              <div className="mt-5 grid gap-3 text-[13px] sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-surface-1 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">{labels.version}</p>
                  <p className="mt-2 font-mono font-semibold text-text-primary">{runtimeVersion}</p>
                </div>
                <div className="rounded-xl border border-border bg-surface-1 p-3 sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">{labels.path}</p>
                  <p className="mt-2 truncate font-mono font-semibold text-text-primary">{runtimePath}</p>
                </div>
              </div>
              {(runtimeProblem || runtimeWarnings.length > 0) && (
                <div className={`mt-3 rounded-xl border px-3 py-2 text-[12px] leading-5 ${runtimeProblem ? 'border-rose-500/25 bg-rose-500/10 text-rose-200' : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}`}>
                  {runtimeProblem && <p>{runtimeProblem}</p>}
                  {runtimeWarnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
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
                  disabled={detecting || runtimeLoading}
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
              <p className="mt-1 text-[12px] leading-5 text-text-muted">{workspaceLabels.desc}</p>
              <div className="mt-5 flex gap-2">
                <input
                  id="codex-workspace-dir"
                  aria-label={labels.workspaceLabel}
                  value={config.workspaceDir}
                  onChange={(event) => updateConfig({ workspaceDir: event.target.value })}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleOpenBrowse}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface-2 px-3 py-2 text-[12px] font-semibold text-text-secondary transition hover:border-border-active hover:text-text-primary"
                >
                  <FolderOpen className="h-4 w-4" />
                  {workspaceLabels.browseWorkspace}
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

        {browseOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-3xl rounded-2xl border border-border bg-surface-1 shadow-2xl shadow-black/40">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div>
                  <p className="text-sm font-semibold text-text-primary">{workspaceLabels.browseTitle}</p>
                  <p className="mt-1 text-[12px] text-text-muted">{workspaceLabels.browseDesc}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCloseBrowse}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-muted transition hover:border-border-active hover:text-text-primary"
                  aria-label={workspaceLabels.cancel}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5 p-6">
                <div className="rounded-xl border border-border bg-surface-0 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase text-text-muted">{workspaceLabels.currentFolder}</span>
                    {browseRootPath && (
                      <button
                        type="button"
                        onClick={() => void loadBrowse(browseRootPath)}
                        disabled={browseLoading}
                        className="inline-flex items-center rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
                      >
                        {browseRootPath}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => browseParentPath && void loadBrowse(browseParentPath)}
                      disabled={!browseParentPath || browseLoading}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition hover:border-border-active hover:text-text-primary disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      {workspaceLabels.upOneLevel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadBrowse(browsePath || undefined)}
                      disabled={browseLoading}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition hover:border-border-active hover:text-text-primary disabled:opacity-40"
                    >
                      <RotateCcw className={`h-3.5 w-3.5 ${browseLoading ? 'animate-spin' : ''}`} />
                      {workspaceLabels.refresh}
                    </button>
                  </div>
                  <div className="mt-3 rounded-lg border border-border/80 bg-surface-1 px-3 py-2 text-[12px] text-text-secondary break-all">
                    {browsePath || workspaceLabels.pathPlaceholder}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface-0">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-[12px] font-medium text-text-secondary">{workspaceLabels.browseHint}</p>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto">
                    {browseLoading ? (
                      <div className="flex min-h-[220px] items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-accent" />
                      </div>
                    ) : browseError ? (
                      <div className="p-6 text-center text-[12px] text-rose-300">{browseError}</div>
                    ) : browseEntries.length === 0 ? (
                      <div className="p-6 text-center text-[12px] text-text-muted">{workspaceLabels.browseEmpty}</div>
                    ) : (
                      <div className="divide-y divide-border">
                        {browseEntries.map((entry) => (
                          <button
                            key={entry.path}
                            type="button"
                            onClick={() => void loadBrowse(entry.path)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/50"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
                                <FolderOpen className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-medium text-text-primary">
                                  {entry.name}
                                  {entry.is_hidden ? <span className="ml-1 text-[11px] text-text-muted">- {workspaceLabels.hidden}</span> : null}
                                </p>
                                <p className="truncate text-[11px] text-text-muted">{entry.path}</p>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-text-muted" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCloseBrowse}
                    className="rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium text-text-secondary transition hover:border-border-active hover:text-text-primary"
                  >
                    {workspaceLabels.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectBrowsePath}
                    disabled={!browsePath}
                    className="rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white shadow-lg shadow-accent/20 transition hover:bg-accent-dim disabled:opacity-40"
                  >
                    {workspaceLabels.useThisFolder}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
