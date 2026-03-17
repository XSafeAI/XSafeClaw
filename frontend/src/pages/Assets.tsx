import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Shield, Cpu, HardDrive, MemoryStick, Wifi, Package,
  AlertTriangle, CheckCircle, XCircle, Info,
  FolderOpen, FileText, Loader2, Play, Layers,
  RefreshCw, ChevronRight, ChevronDown, Zap, Server,
  Search, Lock, Check, X, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { assetsAPI, type SoftwareItem } from '../services/api';
import { useI18n } from '../i18n';

/* ==================== Types ==================== */
interface HardwareInfo {
  cpu_info: { model: string; physical_cores: number; logical_cores: number; current_freq_mhz: number; usage_percent: number; };
  memory_info: { total_gb: number; used_gb: number; free_gb: number; usage_percent: number; };
  disk_info: Array<{ device: string; mountpoint: string; fstype: string; total_gb: number; used_gb: number; free_gb: number; usage_percent: number; }>;
  system_info: { os_name: string; os_release: string; architecture: string; hostname: string; platform: string; boot_time: string; uptime_seconds: number; };
  network_info: Array<{ interface: string; is_up: boolean; speed_mbps: number; addresses: Array<{ family: string; address: string }>; }>;
  gpu_info?: { available: boolean; gpus: Array<{ name: string; vendor: string }>; detection_method: string | null; };
}

interface AssetDetail {
  path: string; file_type: string; owner: string; risk_level: number;
  size: number | null; direct_size: number | null; permissions: string | null;
  real_path: string | null; resolved_risk: number | null; metadata: Record<string, any> | null;
}
interface RiskGroupDetail {
  count: number; percentage: number; description: string; assets: AssetDetail[]; total_in_level: number;
}
interface ScanResult {
  status: string; total_scanned: number; total_ignored: number;
  total_assets: number; risk_distribution: Record<string, RiskGroupDetail>; message: string;
}
interface SafetyResult {
  status: 'ALLOWED' | 'DENIED' | 'CONFIRM';
  risk_level: number;
  reason: string;
  path: string;
  operation: string;
  timestamp: Date;
}

/* ==================== Constants ==================== */
const riskConfig: Record<number, { bg: string; border: string; text: string; dot: string; icon: typeof Shield; label: string; shortLabel: string }> = {
  0: { bg: 'bg-red-500/8', border: 'border-red-500/20', text: 'text-red-400', dot: 'bg-red-500', icon: XCircle, label: 'LEVEL 0 · System Critical', shortLabel: 'Critical' },
  1: { bg: 'bg-orange-500/8', border: 'border-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-500', icon: AlertTriangle, label: 'LEVEL 1 · Sensitive Credentials', shortLabel: 'Sensitive' },
  2: { bg: 'bg-yellow-500/8', border: 'border-yellow-500/20', text: 'text-yellow-400', dot: 'bg-yellow-500', icon: Info, label: 'LEVEL 2 · User Data', shortLabel: 'User Data' },
  3: { bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-500', icon: CheckCircle, label: 'LEVEL 3 · Cleanable Content', shortLabel: 'Cleanable' },
};

const safetyStatusConfig = {
  ALLOWED:  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', icon: Check, label: 'Allowed' },
  DENIED:   { bg: 'bg-red-500/10',     border: 'border-red-500/30',     text: 'text-red-400',     icon: X,     label: 'Denied' },
  CONFIRM:  { bg: 'bg-yellow-500/10',  border: 'border-yellow-500/30',  text: 'text-yellow-400',  icon: AlertTriangle, label: 'Confirm' },
};

type TabId = 'scan' | 'software' | 'hardware' | 'safety';

const OPERATIONS = ['read', 'write', 'delete', 'modify', 'create'] as const;

/* ==================== Helpers ==================== */
function formatUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function ProgressBar({ percent, colorClass = 'bg-accent' }: { percent: number; colorClass?: string }) {
  return (
    <div className="w-full bg-surface-0 rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${colorClass}`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, s = bytes;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

/* ==================== Sub Components ==================== */
function SummaryRow({ label, value, valueColor = 'text-text-primary' }: { label: string; value: string | number; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <span className={`text-[13px] font-semibold tabular-nums ${valueColor}`}>{value}</span>
    </div>
  );
}
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-surface-1 border border-border rounded-xl ${className}`}>{children}</div>;
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

/* ==================== Main Page ==================== */
export default function Assets() {
  const { t } = useI18n();

  const tabItems = [
    { id: 'scan' as const, name: t.assets.tabs.files, icon: FolderOpen },
    { id: 'software' as const, name: t.assets.tabs.softwares, icon: Package },
    { id: 'hardware' as const, name: t.assets.tabs.hardwares, icon: Server },
    { id: 'safety' as const, name: t.assets.tabs.permissions, icon: ShieldCheck },
  ];

  const riskLabels: Record<number, { label: string; short: string }> = {
    0: { label: t.assets.risk.level0, short: t.assets.risk.short0 },
    1: { label: t.assets.risk.level1, short: t.assets.risk.short1 },
    2: { label: t.assets.risk.level2, short: t.assets.risk.short2 },
    3: { label: t.assets.risk.level3, short: t.assets.risk.short3 },
  };

  const safetyLabels: Record<string, string> = {
    ALLOWED: t.assets.safety.allowed,
    DENIED: t.assets.safety.denied,
    CONFIRM: t.assets.safety.confirm,
  };

  const [activeTab, setActiveTab] = useState<TabId>('scan');

  /* --- Hardware --- */
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [hwLoading, setHwLoading] = useState(false);

  /* --- File Scan --- */
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanPath, setScanPath] = useState('');
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set());
  const [scanProgress, setScanProgress] = useState<{ scanned: number; ignored: number }>({ scanned: 0, ignored: 0 });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* --- Software Scan --- */
  const [softwareList, setSoftwareList] = useState<SoftwareItem[]>([]);
  const [softScanning, setSoftScanning] = useState(false);
  const [softSearch, setSoftSearch] = useState('');
  const [softSource, setSoftSource] = useState('');
  const [, setSoftScanId] = useState<string | null>(null);
  const softPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* --- Safety Check --- */
  const [safetyPath, setSafetyPath] = useState('');
  const [safetyOp, setSafetyOp] = useState<string>('delete');
  const [safetyChecking, setSafetyChecking] = useState(false);
  const [safetyHistory, setSafetyHistory] = useState<SafetyResult[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (softPollRef.current) clearInterval(softPollRef.current);
    };
  }, []);

  const toggleLevel = useCallback((level: number) => {
    setExpandedLevels(prev => { const n = new Set(prev); n.has(level) ? n.delete(level) : n.add(level); return n; });
  }, []);

  /* --- Hardware load --- */
  const loadHardware = useCallback(async () => {
    setHwLoading(true);
    try { const res = await assetsAPI.hardware(); setHardware(res.data.hardware_info as any); }
    catch (err: any) { alert(err.response?.data?.detail || 'Hardware scan failed'); }
    finally { setHwLoading(false); }
  }, []);

  /* --- File Scan --- */
  const runScan = useCallback(async () => {
    setScanning(true); setScanProgress({ scanned: 0, ignored: 0 }); setScanResult(null);
    try {
      const startRes = await assetsAPI.startScan({ path: scanPath || undefined, scan_system_root: !scanPath });
      const scanId = startRes.data.scan_id;
      pollingRef.current = setInterval(async () => {
        try {
          const prog = await assetsAPI.scanProgress(scanId);
          setScanProgress({ scanned: prog.data.scanned_count, ignored: prog.data.ignored_count });
          if (prog.data.status === 'completed' && prog.data.result) {
            clearInterval(pollingRef.current!); pollingRef.current = null;
            setScanResult(prog.data.result as ScanResult); setScanning(false);
          } else if (prog.data.status === 'failed') {
            clearInterval(pollingRef.current!); pollingRef.current = null;
            alert(prog.data.error || 'Scan failed'); setScanning(false);
          }
        } catch { /* keep polling */ }
      }, 800);
    } catch (err: any) { alert(err.response?.data?.detail || 'Scan failed'); setScanning(false); }
  }, [scanPath]);

  /* --- Software Scan --- */
  const runSoftwareScan = useCallback(async () => {
    setSoftScanning(true); setSoftwareList([]);
    try {
      const res = await assetsAPI.startSoftwareScan();
      const id = res.data.scan_id;
      setSoftScanId(id);
      softPollRef.current = setInterval(async () => {
        try {
          const prog = await assetsAPI.softwareScanProgress(id);
          if (prog.data.status === 'completed' && prog.data.result) {
            clearInterval(softPollRef.current!); softPollRef.current = null;
            setSoftwareList(prog.data.result.software_list); setSoftScanning(false);
          } else if (prog.data.status === 'failed') {
            clearInterval(softPollRef.current!); softPollRef.current = null;
            alert(prog.data.error || 'Software scan failed'); setSoftScanning(false);
          }
        } catch { /* keep polling */ }
      }, 1000);
    } catch (err: any) { alert(err.response?.data?.detail || 'Failed'); setSoftScanning(false); }
  }, []);

  /* --- Safety Check --- */
  const runSafetyCheck = useCallback(async () => {
    if (!safetyPath.trim()) return;
    setSafetyChecking(true);
    try {
      const res = await assetsAPI.checkSafety(safetyPath.trim(), safetyOp);
      setSafetyHistory(prev => [{
        ...res.data, path: safetyPath.trim(), operation: safetyOp, timestamp: new Date(),
        status: res.data.status as SafetyResult['status'],
      }, ...prev].slice(0, 20));
    } catch (err: any) { alert(err.response?.data?.detail || 'Check failed'); }
    finally { setSafetyChecking(false); }
  }, [safetyPath, safetyOp]);

  /* --- Derived software list --- */
  const filteredSoftware = softwareList.filter(s => {
    const q = softSearch.toLowerCase();
    const matchSearch = !q || s.name.toLowerCase().includes(q) || (s.publisher || '').toLowerCase().includes(q);
    const matchSource = !softSource || s.source === softSource;
    return matchSearch && matchSource;
  });
  const softSources = [...new Set(softwareList.map(s => s.source))].sort();

  return (
    <div className="min-h-screen">
      {/* ===== Header ===== */}
      <div className="border-b border-border">
        <div className="px-8 py-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-text-primary">{t.assets.title}</h1>
            <span className="text-[11px] font-semibold border border-success/40 text-success px-3 py-1 rounded-full uppercase tracking-wider">{t.common.active}</span>
          </div>
          <p className="text-[13px] text-text-muted mt-2">{t.assets.subtitle}</p>
        </div>
        <div className="px-8 flex items-center gap-1">
          {tabItems.map((tab) => {
            const Icon = tab.icon; const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${isActive ? 'text-accent border-accent' : 'text-text-muted border-transparent hover:text-text-secondary hover:border-border'}`}>
                <Icon className="w-3.5 h-3.5" />{tab.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-8">
        {/* ========== Files Tab ========== */}
        {activeTab === 'scan' && (
          <div className="grid grid-cols-12 gap-6 items-stretch">
            <div className="col-span-7 flex flex-col gap-5">
              <Card>
                <CardHeader icon={FolderOpen} title={t.assets.fileScan.title} />
                <div className="p-5">
                  <p className="text-[12px] text-text-muted mb-4">{t.assets.fileScan.desc}</p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input type="text" value={scanPath} onChange={e => setScanPath(e.target.value)}
                        placeholder={t.assets.fileScan.pathPlaceholder}
                        className="w-full pl-10 pr-4 py-2.5 bg-surface-0 border border-border rounded-lg text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all" />
                    </div>
                    <button onClick={runScan} disabled={scanning}
                      className="px-5 py-2.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-accent-dim disabled:opacity-40 transition-all flex items-center gap-2 shadow-lg shadow-accent/20">
                      {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      {scanning ? t.assets.fileScan.scanning : t.assets.fileScan.startScan}
                    </button>
                  </div>
                </div>
              </Card>

              {scanning && (
                <Card>
                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-accent animate-spin" />
                      </div>
                      <div><p className="text-sm font-semibold text-text-primary">{t.assets.fileScan.inProgress}</p>
                        <p className="text-[11px] text-text-muted">{t.assets.fileScan.classifying}</p></div>
                    </div>
                    <div className="w-full bg-surface-0 rounded-full h-2 overflow-hidden mb-4">
                      <div className="h-full rounded-full bg-gradient-to-r from-accent via-purple-400 to-accent bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" />
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-accent" /></span>
                        <span className="text-[13px] text-text-secondary">{t.assets.fileScan.scanned} <span className="font-bold text-text-primary tabular-nums">{scanProgress.scanned.toLocaleString()}</span></span>
                      </div>
                      <div className="text-[13px] text-text-secondary">{t.assets.fileScan.ignored} <span className="font-semibold text-text-muted tabular-nums">{scanProgress.ignored.toLocaleString()}</span></div>
                    </div>
                  </div>
                </Card>
              )}

              {scanResult && !scanning && (
                <Card>
                  <CardHeader icon={Shield} title={t.assets.risk.title} />
                  <div className="divide-y divide-border">
                    {Object.entries(scanResult.risk_distribution).map(([key, dist]) => {
                      const level = parseInt(key.replace('LEVEL_', '')); const config = riskConfig[level];
                      const isExpanded = expandedLevels.has(level); const hasAssets = dist.assets?.length > 0;
                      return (
                        <div key={key}>
                          <button className="w-full text-left px-5 py-4 hover:bg-surface-2/50 transition-colors" onClick={() => hasAssets && toggleLevel(level)}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2.5">
                                {hasAssets ? (isExpanded ? <ChevronDown className={`w-3.5 h-3.5 ${config.text}`} /> : <ChevronRight className={`w-3.5 h-3.5 ${config.text}`} />) : <span className={`w-2 h-2 rounded-full ${config.dot}`} />}
                                <span className="text-[13px] text-text-primary font-medium">{riskLabels[level]?.label ?? config.label}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-[13px] text-text-secondary tabular-nums">{dist.count.toLocaleString()}</span>
                                <span className={`text-[12px] font-semibold tabular-nums ${config.text}`}>{dist.percentage}%</span>
                              </div>
                            </div>
                            <ProgressBar percent={dist.percentage} colorClass={level === 0 ? 'bg-red-500' : level === 1 ? 'bg-orange-500' : level === 2 ? 'bg-yellow-500' : 'bg-emerald-500'} />
                          </button>
                          {isExpanded && hasAssets && (
                            <div className="bg-surface-0/60 border-t border-border">
                              <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold border-b border-border/50">
                                <div className="col-span-6">{t.assets.fileTable.path}</div><div className="col-span-2">{t.assets.fileTable.type}</div><div className="col-span-2">{t.assets.fileTable.size}</div><div className="col-span-2">{t.assets.fileTable.permissions}</div>
                              </div>
                              <div className="max-h-[360px] overflow-y-auto">
                                {dist.assets.map((asset, idx) => (
                                  <div key={idx} className="grid grid-cols-12 gap-2 px-5 py-2 text-[12px] border-b border-border/30 last:border-b-0 hover:bg-surface-2/40 transition-colors">
                                    <div className="col-span-6 flex items-center gap-1.5 min-w-0">
                                      {asset.file_type === 'directory' ? <FolderOpen className="w-3.5 h-3.5 text-accent flex-shrink-0" /> : <FileText className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />}
                                      <span className="font-mono text-text-primary truncate" title={asset.path}>{asset.path}</span>
                                    </div>
                                    <div className="col-span-2 text-text-secondary capitalize">{asset.file_type}</div>
                                    <div className="col-span-2 text-text-secondary tabular-nums">{formatBytes(asset.size ?? asset.direct_size)}</div>
                                    <div className="col-span-2 font-mono text-text-muted">{asset.permissions ?? '—'}</div>
                                  </div>
                                ))}
                              </div>
                              {dist.total_in_level > dist.assets.length && (
                                <div className="px-5 py-2 text-[11px] text-text-muted text-center border-t border-border/50">
                                  {t.assets.fileTable.showingOf.replace('{shown}', String(dist.assets.length)).replace('{total}', dist.total_in_level.toLocaleString())}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {!scanResult && !scanning && (
                <Card>
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mb-4"><Layers className="w-7 h-7 text-text-muted" /></div>
                    <p className="text-sm font-medium text-text-secondary mb-1">{t.assets.emptyScan.title}</p>
                    <p className="text-[12px] text-text-muted max-w-xs">{t.assets.emptyScan.desc}</p>
                  </div>
                </Card>
              )}
            </div>

            <div className="col-span-5 flex flex-col gap-5">
              <Card className="flex-1 flex flex-col">
                <CardHeader icon={Shield} title={t.assets.summary.title} />
                <div className="p-5">
                  {scanResult ? (
                    <>
                      <div className="space-y-2 mb-5">
                        <SummaryRow label={t.assets.summary.totalAssets} value={scanResult.total_assets.toLocaleString()} valueColor="text-accent" />
                        <SummaryRow label={t.assets.summary.scanned} value={scanResult.total_scanned.toLocaleString()} />
                        <SummaryRow label={t.assets.summary.ignored} value={scanResult.total_ignored.toLocaleString()} />
                      </div>
                      <div className="border-t border-border pt-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t.assets.summary.riskBreakdown}</p>
                        <div className="space-y-3">
                          {Object.entries(scanResult.risk_distribution).map(([key, dist]) => {
                            const level = parseInt(key.replace('LEVEL_', '')); const config = riskConfig[level];
                            return (
                              <button key={key} className="flex items-center gap-3 w-full text-left hover:bg-surface-2 rounded-md px-1 -mx-1 py-0.5 transition-colors" onClick={() => dist.count > 0 && toggleLevel(level)}>
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
                                <span className="text-[13px] text-text-secondary flex-1">{riskLabels[level]?.short ?? config.shortLabel}</span>
                                <span className={`text-[13px] font-bold tabular-nums ${dist.count > 0 ? config.text : 'text-text-muted'}`}>{dist.count.toLocaleString()}</span>
                                {dist.count > 0 && (expandedLevels.has(level) ? <ChevronDown className="w-3 h-3 text-text-muted" /> : <ChevronRight className="w-3 h-3 text-text-muted" />)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8"><Layers className="w-8 h-8 text-text-muted mx-auto mb-3" /><p className="text-[12px] text-text-muted">{t.assets.summary.runScan}</p></div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ========== Softwares Tab ========== */}
        {activeTab === 'software' && (
          <div className="space-y-5">
            {/* Controls bar */}
            <div className="flex items-center gap-3">
              <button onClick={runSoftwareScan} disabled={softScanning}
                className="px-5 py-2.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-accent-dim disabled:opacity-40 transition-all flex items-center gap-2 shadow-lg shadow-accent/20">
                {softScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                {softScanning ? t.assets.fileScan.scanning : softwareList.length > 0 ? t.assets.software.rescan : t.assets.software.scan}
              </button>
              {softwareList.length > 0 && (
                <>
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                    <input type="text" value={softSearch} onChange={e => setSoftSearch(e.target.value)}
                      placeholder={t.assets.software.searchPlaceholder}
                      className="w-full pl-9 pr-3 py-2 bg-surface-1 border border-border rounded-lg text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all" />
                  </div>
                  <select value={softSource} onChange={e => setSoftSource(e.target.value)}
                    className="px-3 py-2 text-[13px] bg-surface-1 border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent/50 appearance-none cursor-pointer">
                    <option value="">{t.assets.software.allSources}</option>
                    {softSources.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="text-[12px] text-text-muted ml-auto">{t.assets.software.apps.replace('{f}', String(filteredSoftware.length)).replace('{t}', String(softwareList.length))}</span>
                </>
              )}
            </div>

            {/* Scanning progress */}
            {softScanning && (
              <Card>
                <div className="p-6 flex flex-col items-center justify-center">
                  <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center mb-4"><Loader2 className="w-5 h-5 text-accent animate-spin" /></div>
                  <p className="text-sm font-semibold text-text-primary mb-1">{t.assets.software.scanningTitle}</p>
                  <p className="text-[12px] text-text-muted">{t.assets.software.scanningDesc}</p>
                  <div className="w-48 bg-surface-0 rounded-full h-1.5 overflow-hidden mt-4">
                    <div className="h-full rounded-full bg-gradient-to-r from-accent via-purple-400 to-accent bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" />
                  </div>
                </div>
              </Card>
            )}

            {/* Software table */}
            {!softScanning && softwareList.length > 0 && (
              <Card>
                <CardHeader icon={Package} title={t.assets.software.tableTitle} badge={
                  <span className="text-[11px] text-text-muted bg-surface-2 px-2 py-0.5 rounded-full">{filteredSoftware.length}</span>
                } />
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        {[t.assets.software.name, t.assets.software.version, t.assets.software.publisher, t.assets.software.source, t.assets.software.installLocation, t.assets.software.relatedPaths].map(h => (
                          <th key={h} className="text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider px-4 py-2.5 border-b border-border bg-surface-0/50 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSoftware.map((sw, idx) => (
                        <tr key={idx} className="hover:bg-surface-0/50 transition-colors border-b border-border/50 last:border-b-0">
                          <td className="px-4 py-2.5">
                            <span className="text-[13px] font-medium text-text-primary truncate max-w-[160px] block" title={sw.name}>{sw.name}</span>
                          </td>
                          <td className="px-4 py-2.5 text-[12px] font-mono text-text-secondary whitespace-nowrap">{sw.version || '—'}</td>
                          <td className="px-4 py-2.5 text-[12px] text-text-secondary whitespace-nowrap">{sw.publisher || '—'}</td>
                          <td className="px-4 py-2.5">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-accent/10 text-accent">{sw.source}</span>
                          </td>
                          <td className="px-4 py-2.5 text-[11px] font-mono text-text-muted max-w-[200px]">
                            <span className="truncate block" title={sw.install_location || ''}>{sw.install_location || '—'}</span>
                          </td>
                          <td className="px-4 py-2.5 text-[12px] text-text-muted text-center">
                            {sw.related_paths?.length > 0 ? (
                              <span className="text-[11px] bg-surface-2 px-1.5 py-0.5 rounded-md">{sw.related_paths.length}</span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {!softScanning && softwareList.length === 0 && (
              <Card>
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mb-4"><Package className="w-7 h-7 text-text-muted" /></div>
                  <p className="text-sm font-medium text-text-secondary mb-1">{t.assets.software.emptyTitle}</p>
                  <p className="text-[12px] text-text-muted max-w-xs">{t.assets.software.emptyDesc}</p>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ========== Safety Check Tab ========== */}
        {activeTab === 'safety' && (
          <div className="grid grid-cols-12 gap-6">
            {/* Left: input */}
            <div className="col-span-6 space-y-5">
              <Card>
                <CardHeader icon={ShieldCheck} title={t.assets.safety.title} />
                <div className="p-5 space-y-4">
                  <p className="text-[12px] text-text-muted">
                    {t.assets.safety.desc}
                  </p>

                  {/* Path input */}
                  <div>
                    <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">{t.assets.safety.targetPath}</label>
                    <div className="relative">
                      <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input type="text" value={safetyPath} onChange={e => setSafetyPath(e.target.value)}
                        placeholder={t.assets.safety.pathPlaceholder}
                        className="w-full pl-10 pr-4 py-2.5 bg-surface-0 border border-border rounded-lg text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all"
                        onKeyDown={e => e.key === 'Enter' && runSafetyCheck()} />
                    </div>
                  </div>

                  {/* Operation selector */}
                  <div>
                    <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">{t.assets.safety.operation}</label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {OPERATIONS.map(op => (
                        <button key={op} onClick={() => setSafetyOp(op)}
                          className={`py-2 rounded-lg text-[12px] font-medium capitalize transition-all border ${safetyOp === op ? 'bg-accent/15 text-accent border-accent/40' : 'bg-surface-0 text-text-muted border-border hover:border-border-active hover:text-text-secondary'}`}>
                          {op}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button onClick={runSafetyCheck} disabled={safetyChecking || !safetyPath.trim()}
                    className="w-full px-5 py-2.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-accent/20">
                    {safetyChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    {safetyChecking ? t.assets.safety.checking : t.assets.safety.checkSafety}
                  </button>
                </div>
              </Card>

              {/* Latest result */}
              {safetyHistory.length > 0 && (() => {
                const latest = safetyHistory[0];
                const cfg = safetyStatusConfig[latest.status];
                const Icon = cfg.icon;
                return (
                  <Card>
                    <CardHeader icon={ShieldAlert} title={t.assets.safety.latestResult} badge={
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.text}`}>{safetyLabels[latest.status] ?? cfg.label}</span>
                    } />
                    <div className="p-5">
                      <div className={`p-4 rounded-lg border ${cfg.bg} ${cfg.border} mb-4`}>
                        <div className="flex items-start gap-3">
                          <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${cfg.text}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${cfg.text} mb-1`}>{safetyLabels[latest.status] ?? cfg.label} — {latest.operation.toUpperCase()}</p>
                            <p className="text-[13px] font-mono text-text-primary break-all mb-1">{latest.path}</p>
                            <p className="text-[12px] text-text-secondary">{latest.reason}</p>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-surface-2 rounded-lg p-3">
                          <span className="text-[10px] text-text-muted uppercase tracking-wider">{t.assets.safety.riskLevel}</span>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`w-2 h-2 rounded-full ${riskConfig[Math.max(0, latest.risk_level)]?.dot || 'bg-text-muted'}`} />
                            <span className="text-[13px] font-semibold text-text-primary">LEVEL {latest.risk_level}</span>
                          </div>
                        </div>
                        <div className="bg-surface-2 rounded-lg p-3">
                          <span className="text-[10px] text-text-muted uppercase tracking-wider">{t.assets.safety.status}</span>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[13px] font-semibold ${cfg.text}`}>{latest.status}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })()}
            </div>

            {/* Right: history */}
            <div className="col-span-6">
              <Card>
                <CardHeader icon={ShieldCheck} title={t.assets.safety.historyTitle} badge={
                  <span className="text-[11px] text-text-muted bg-surface-2 px-2 py-0.5 rounded-full">{safetyHistory.length}</span>
                } />
                {safetyHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mb-4"><Lock className="w-7 h-7 text-text-muted" /></div>
                    <p className="text-sm font-medium text-text-secondary mb-1">{t.assets.safety.noChecks}</p>
                    <p className="text-[12px] text-text-muted max-w-xs">{t.assets.safety.noChecksDesc}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
                    {safetyHistory.map((item, idx) => {
                      const cfg = safetyStatusConfig[item.status];
                      const Icon = cfg.icon;
                      return (
                        <button key={idx} onClick={() => { setSafetyPath(item.path); setSafetyOp(item.operation); }}
                          className="w-full text-left px-5 py-3 hover:bg-surface-2/50 transition-colors flex items-start gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.bg} border ${cfg.border}`}>
                            <Icon className={`w-3.5 h-3.5 ${cfg.text}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[11px] font-bold ${cfg.text}`}>{item.status}</span>
                              <span className="text-[10px] bg-surface-2 text-text-muted px-1.5 py-0.5 rounded-md capitalize">{item.operation}</span>
                              <span className="text-[10px] text-text-muted ml-auto">{item.timestamp.toLocaleTimeString()}</span>
                            </div>
                            <p className="text-[12px] font-mono text-text-secondary truncate">{item.path}</p>
                            <p className="text-[11px] text-text-muted mt-0.5">{item.reason}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ========== Hardware Tab ========== */}
        {activeTab === 'hardware' && (
          <div className="space-y-5">
            <div className="flex justify-end">
              <button onClick={loadHardware} disabled={hwLoading}
                className="px-4 py-2 bg-surface-1 border border-border text-text-secondary rounded-lg text-[13px] font-medium hover:bg-surface-2 hover:border-border-active disabled:opacity-40 transition-all flex items-center gap-2">
                {hwLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {hardware ? t.assets.hardware.refresh : t.assets.hardware.load}
              </button>
            </div>
            {hwLoading && (<Card><div className="p-12 flex flex-col items-center justify-center"><Loader2 className="w-8 h-8 text-accent animate-spin mb-3" /><p className="text-sm text-text-secondary">{t.assets.hardware.scanningHw}</p></div></Card>)}
            {!hardware && !hwLoading && (
              <Card><div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mb-4"><Cpu className="w-7 h-7 text-text-muted" /></div>
                <p className="text-sm font-medium text-text-secondary mb-1">{t.assets.hardware.emptyTitle}</p>
                <p className="text-[12px] text-text-muted max-w-xs">{t.assets.hardware.emptyDesc}</p>
              </div></Card>
            )}
            {hardware && !hwLoading && (
              <div className="grid grid-cols-12 gap-5 items-stretch">
                {/* System Info */}
                <div className="col-span-12"><Card>
                  <CardHeader icon={Info} title={t.assets.hardware.systemInfo} />
                  <div className="p-5"><div className="grid grid-cols-4 gap-5">
                    {[{ label: t.assets.hardware.hostname, value: hardware.system_info.hostname }, { label: t.assets.hardware.os, value: `${hardware.system_info.os_name} ${hardware.system_info.os_release}` }, { label: t.assets.hardware.architecture, value: hardware.system_info.architecture }, { label: t.assets.hardware.uptime, value: formatUptime(hardware.system_info.uptime_seconds) }].map(item => (
                      <div key={item.label} className="bg-surface-2 rounded-lg p-4">
                        <span className="text-[11px] text-text-muted uppercase tracking-wider">{item.label}</span>
                        <p className="text-[14px] font-semibold text-text-primary mt-1.5 truncate">{item.value}</p>
                      </div>
                    ))}
                  </div></div>
                </Card></div>
                {/* CPU */}
                <div className="col-span-6"><Card>
                  <CardHeader icon={Cpu} title={t.assets.hardware.cpu} badge={<span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${hardware.cpu_info.usage_percent > 80 ? 'bg-red-500/15 text-red-400' : 'bg-accent/15 text-accent'}`}>{hardware.cpu_info.usage_percent}%</span>} />
                  <div className="p-5">
                    <p className="text-[13px] font-medium text-text-primary mb-4 line-clamp-1">{hardware.cpu_info.model}</p>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-surface-2 rounded-lg p-3 text-center"><p className="text-xl font-bold text-text-primary">{hardware.cpu_info.physical_cores}</p><p className="text-[10px] text-text-muted uppercase tracking-wider mt-1">{t.assets.hardware.physical}</p></div>
                      <div className="bg-surface-2 rounded-lg p-3 text-center"><p className="text-xl font-bold text-text-primary">{hardware.cpu_info.logical_cores}</p><p className="text-[10px] text-text-muted uppercase tracking-wider mt-1">{t.assets.hardware.logical}</p></div>
                    </div>
                    <ProgressBar percent={hardware.cpu_info.usage_percent} colorClass={hardware.cpu_info.usage_percent > 80 ? 'bg-red-500' : 'bg-accent'} />
                  </div>
                </Card></div>
                {/* Memory */}
                <div className="col-span-6"><Card>
                  <CardHeader icon={MemoryStick} title={t.assets.hardware.memory} badge={<span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${hardware.memory_info.usage_percent > 80 ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>{hardware.memory_info.usage_percent}%</span>} />
                  <div className="p-5">
                    <div className="flex items-baseline gap-1 mb-4"><span className="text-2xl font-bold text-text-primary">{hardware.memory_info.used_gb}</span><span className="text-[13px] text-text-muted">/ {hardware.memory_info.total_gb} GB</span></div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[{ label: t.assets.hardware.total, value: `${hardware.memory_info.total_gb} GB` }, { label: t.assets.hardware.used, value: `${hardware.memory_info.used_gb} GB` }, { label: t.assets.hardware.free, value: `${hardware.memory_info.free_gb} GB` }].map(item => (
                        <div key={item.label} className="bg-surface-2 rounded-lg p-2.5 text-center"><p className="text-[11px] text-text-muted">{item.label}</p><p className="text-sm font-semibold text-text-primary mt-0.5">{item.value}</p></div>
                      ))}
                    </div>
                    <ProgressBar percent={hardware.memory_info.usage_percent} colorClass={hardware.memory_info.usage_percent > 80 ? 'bg-red-500' : 'bg-emerald-500'} />
                  </div>
                </Card></div>
                {/* GPU — left col, aligned with CPU */}
                <div className="col-span-6 flex flex-col"><Card className="flex-1">
                  <CardHeader icon={Zap} title={t.assets.hardware.gpu} badge={hardware.gpu_info?.available ? <span className="text-[10px] font-semibold bg-success/15 text-success px-2 py-0.5 rounded-full">{t.assets.hardware.gpuAvailable}</span> : <span className="text-[10px] font-semibold bg-surface-2 text-text-muted px-2 py-0.5 rounded-full">{t.assets.hardware.gpuNA}</span>} />
                  <div className="px-5 py-3">
                    {hardware.gpu_info?.available ? (
                      <div className="flex flex-wrap gap-2">
                        {hardware.gpu_info.gpus.map((gpu, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-surface-2 rounded-lg px-3 py-2 min-w-0">
                            <Zap className="w-3.5 h-3.5 text-success flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[12px] font-medium text-text-primary truncate">{gpu.name}</p>
                              <p className="text-[10px] text-text-muted">{gpu.vendor}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 py-2 text-text-muted">
                        <Zap className="w-4 h-4 flex-shrink-0" />
                        <p className="text-[12px]">{t.assets.hardware.noGpu}</p>
                      </div>
                    )}
                  </div>
                </Card></div>
                {/* Network — right col, aligned with Memory */}
                <div className="col-span-6 flex flex-col"><Card className="flex-1">
                  <CardHeader icon={Wifi} title={t.assets.hardware.network} />
                  <div className="divide-y divide-border overflow-y-auto max-h-[260px]">
                    {hardware.network_info.filter(n => n.is_up).map((net, idx) => (
                      <div key={idx} className="px-5 py-3 flex items-center gap-3">
                        <span className="relative flex h-2 w-2 flex-shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-success" /></span>
                        <span className="text-[13px] font-medium text-text-primary flex-1">{net.interface}</span>
                        {net.speed_mbps > 0 && <span className="text-[11px] text-text-muted tabular-nums">{net.speed_mbps} Mbps</span>}
                      </div>
                    ))}
                  </div>
                </Card></div>
                {/* Disk */}
                <div className="col-span-12"><Card>
                  <CardHeader icon={HardDrive} title={t.assets.hardware.disk} badge={<span className="text-[11px] text-text-muted bg-surface-2 px-2 py-0.5 rounded-full">{hardware.disk_info.length}</span>} />
                  <div className="divide-y divide-border">
                    {hardware.disk_info.map((disk, idx) => (
                      <div key={idx} className="px-5 py-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <code className="text-[12px] font-mono text-accent bg-accent/10 px-2 py-0.5 rounded">{disk.mountpoint}</code>
                            <span className="text-[11px] text-text-muted">{disk.device} · {disk.fstype}</span>
                          </div>
                          <span className={`text-[12px] font-bold tabular-nums ${disk.usage_percent > 90 ? 'text-red-400' : disk.usage_percent > 70 ? 'text-yellow-400' : 'text-text-secondary'}`}>{disk.usage_percent}%</span>
                        </div>
                        <div className="flex items-center gap-4 mb-2">
                          <span className="text-[12px] text-text-muted">{t.assets.hardware.diskUsed.replace('{u}', String(disk.used_gb)).replace('{t}', String(disk.total_gb))}</span>
                          <span className="text-[12px] text-text-muted">{t.assets.hardware.diskFree.replace('{f}', String(disk.free_gb))}</span>
                        </div>
                        <ProgressBar percent={disk.usage_percent} colorClass={disk.usage_percent > 90 ? 'bg-red-500' : disk.usage_percent > 70 ? 'bg-yellow-500' : 'bg-accent'} />
                      </div>
                    ))}
                  </div>
                </Card></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
