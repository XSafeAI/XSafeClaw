import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Copy,
  FlaskConical,
  Shield,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  riskTestAPI,
  type RiskTestCaseItem,
  type RiskTestExampleItem,
  type RiskTestPreviewResult,
  type RiskTestStyleItem,
} from '../services/api';
import { useI18n } from '../i18n';

function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`bg-surface-1 border border-border rounded-xl ${className}`}>{children}</div>;
}

function CardHeader({
  icon: Icon,
  title,
  badge,
}: {
  icon: typeof Shield;
  title: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      {badge}
    </div>
  );
}

const severityTone: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  high: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  medium: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

export default function RiskTest() {
  const { t, locale } = useI18n();
  const [intent, setIntent] = useState('');
  const [styles, setStyles] = useState<RiskTestStyleItem[]>([]);
  const [examples, setExamples] = useState<RiskTestExampleItem[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskTestPreviewResult | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadSeeds = useCallback(async (lang: 'zh' | 'en') => {
    const [stylesRes, examplesRes] = await Promise.all([
      riskTestAPI.styles(lang),
      riskTestAPI.examples(lang),
    ]);
    setStyles(stylesRes.data);
    setExamples(examplesRes.data);
    setSelectedStyles((prev) => {
      const allowed = stylesRes.data.map(item => item.key);
      const kept = prev.filter(key => allowed.includes(key));
      return kept.length > 0 ? kept : allowed.slice(0, 4);
    });
  }, []);

  useEffect(() => {
    loadSeeds(locale)
      .catch((error) => {
        console.error('load risk test seeds failed', error);
      });
  }, [locale, loadSeeds]);

  const toggleStyle = useCallback((key: string) => {
    setSelectedStyles(prev => (
      prev.includes(key)
        ? prev.filter(item => item !== key)
        : [...prev, key]
    ));
  }, []);

  const runPreview = useCallback(async () => {
    if (!intent.trim()) return;
    setLoading(true);
    try {
      const res = await riskTestAPI.preview(intent.trim(), selectedStyles, locale);
      setResult(res.data);
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Risk test failed');
    } finally {
      setLoading(false);
    }
  }, [intent, selectedStyles, locale]);

  useEffect(() => {
    if (!result || !intent.trim()) return;
    riskTestAPI.preview(intent.trim(), selectedStyles, locale)
      .then((res) => setResult(res.data))
      .catch((error) => {
        console.error('refresh localized risk preview failed', error);
      });
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const severityClass = useMemo(
    () => severityTone[result?.severity || 'high'] || severityTone.high,
    [result?.severity],
  );

  const copyPrompt = useCallback(async (item: RiskTestCaseItem) => {
    try {
      await navigator.clipboard.writeText(item.wrapped_prompt);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(current => (current === item.id ? null : current)), 1500);
    } catch (error) {
      console.error('copy failed', error);
    }
  }, []);

  return (
    <div className="min-h-screen">
      <div className="border-b border-border">
        <div className="px-8 py-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-text-primary">{t.riskTest.title}</h1>
            <span className="text-[11px] font-semibold border border-success/40 text-success px-3 py-1 rounded-full uppercase tracking-wider">
              {t.common.active}
            </span>
          </div>
          <p className="text-[13px] text-text-muted mt-2">{t.riskTest.subtitle}</p>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.9fr] gap-6">
          <Card>
            <CardHeader icon={FlaskConical} title={t.riskTest.setupTitle} />
            <div className="p-5 space-y-5">
              <div>
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2 block">
                  {t.riskTest.intentLabel}
                </label>
                <textarea
                  value={intent}
                  onChange={e => setIntent(e.target.value)}
                  placeholder={t.riskTest.intentPlaceholder}
                  className="w-full min-h-[132px] px-4 py-3 bg-surface-0 border border-border rounded-xl text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all resize-y"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    {t.riskTest.exampleLabel}
                  </span>
                  <span className="text-[11px] text-text-muted">{examples.length} {t.riskTest.examplesCount}</span>
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {examples.map(example => (
                    <button
                      key={example.title}
                      onClick={() => setIntent(example.intent)}
                      className="h-full min-h-[96px] px-3 py-3 rounded-lg border border-border bg-surface-0 hover:border-accent/40 hover:bg-accent/5 text-left transition-all flex flex-col justify-between"
                    >
                      <p className="text-[12px] font-medium text-text-primary">{example.title}</p>
                      <p className="text-[11px] text-text-muted mt-2 line-clamp-3">{example.intent}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider block">
                  {t.riskTest.stylesLabel}
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {styles.map(style => {
                    const active = selectedStyles.includes(style.key);
                    return (
                      <button
                        key={style.key}
                        onClick={() => toggleStyle(style.key)}
                        className={`text-left rounded-xl border p-4 transition-all ${
                          active
                            ? 'border-accent/40 bg-accent/10 shadow-lg shadow-accent/10'
                            : 'border-border bg-surface-0 hover:border-accent/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[13px] font-semibold text-text-primary">{style.label}</p>
                          <span className={`w-4 h-4 rounded-full border ${active ? 'bg-accent border-accent' : 'border-border bg-transparent'}`} />
                        </div>
                        <p className="text-[12px] text-text-muted mt-2">{style.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={runPreview}
                  disabled={loading || !intent.trim()}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-accent text-white font-medium hover:bg-accent-dim disabled:opacity-40 transition-all shadow-lg shadow-accent/20"
                >
                  <Sparkles className="w-4 h-4" />
                  {loading ? t.riskTest.testing : t.riskTest.run}
                </button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={Shield}
              title={t.riskTest.summaryTitle}
              badge={
                result ? (
                  <span className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold uppercase tracking-wider ${severityClass}`}>
                    {result.severity}
                  </span>
                ) : undefined
              }
            />
            <div className="p-5 h-full">
              {!result ? (
                <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center">
                  <Bot className="w-10 h-10 text-text-muted/50 mb-4" />
                  <p className="text-sm font-medium text-text-secondary mb-2">{t.riskTest.emptyTitle}</p>
                  <p className="text-[12px] text-text-muted max-w-sm">{t.riskTest.emptyDesc}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                    <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">{t.riskTest.summaryCategory}</p>
                    <p className="text-[14px] font-semibold text-text-primary">{result.category}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                    <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">{t.riskTest.summaryWhy}</p>
                    <p className="text-[13px] text-text-secondary leading-relaxed">{result.harm}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                    <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">{t.riskTest.summaryAdvice}</p>
                    <p className="text-[13px] text-text-secondary leading-relaxed">{result.recommendation}</p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-accent" />
              <h2 className="text-sm font-semibold text-text-primary">{t.riskTest.resultsTitle}</h2>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {result.cases.map(item => (
                <Card key={item.id}>
                  <CardHeader
                    icon={ShieldAlert}
                    title={item.style_label}
                    badge={
                      <span className="px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10 text-red-400 text-[11px] font-semibold uppercase tracking-wider">
                        {t.riskTest.blockedBadge}
                      </span>
                    }
                  />
                  <div className="p-5 grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5">
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{t.riskTest.wrappedPrompt}</p>
                          <button
                            onClick={() => copyPrompt(item)}
                            className="inline-flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            {copiedId === item.id ? t.riskTest.copied : t.riskTest.copy}
                          </button>
                        </div>
                        <pre className="rounded-xl bg-surface-0 border border-border px-4 py-3 text-[12px] text-text-secondary whitespace-pre-wrap break-words leading-relaxed">
                          {item.wrapped_prompt}
                        </pre>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">{t.riskTest.expectedBehavior}</p>
                        <p className="text-[13px] text-text-secondary leading-relaxed">{item.expected_behavior}</p>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
