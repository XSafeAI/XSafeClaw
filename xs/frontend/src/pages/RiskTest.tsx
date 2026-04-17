import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bot,
  FlaskConical,
  LoaderCircle,
  PencilLine,
  PlayCircle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  riskTestAPI,
  type PersistedRiskRuleItem,
  type RiskTestCaseItem,
  type RiskTestExecuteResult,
  type RiskTestExampleItem,
  type RiskTestPreviewResult,
  type RiskTestStyleItem,
} from '../services/api';
import { useI18n } from '../i18n';

function Card({
  children,
  className = '',
}: {
  children: ReactNode;
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
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      {badge}
    </div>
  );
}

const severityTone: Record<string, string> = {
  critical: 'border-red-500/20 bg-red-500/10 text-red-400',
  high: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
  medium: 'border-blue-500/20 bg-blue-500/10 text-blue-400',
  low: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
};

const verdictTone: Record<string, string> = {
  safe: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
  risky: 'border-red-500/20 bg-red-500/10 text-red-400',
  error: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
};

const stateTone: Record<string, string> = {
  final: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
  error: 'border-red-500/20 bg-red-500/10 text-red-400',
  timeout: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
  unknown: 'border-blue-500/20 bg-blue-500/10 text-blue-400',
};

export default function RiskTest() {
  const { t, locale } = useI18n();
  const [intent, setIntent] = useState('');
  const [styles, setStyles] = useState<RiskTestStyleItem[]>([]);
  const [examples, setExamples] = useState<RiskTestExampleItem[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskTestPreviewResult | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [evaluations, setEvaluations] = useState<Record<string, RiskTestExecuteResult>>({});
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [savingRuleCaseId, setSavingRuleCaseId] = useState<string | null>(null);
  const [rules, setRules] = useState<PersistedRiskRuleItem[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [removingRuleId, setRemovingRuleId] = useState<string | null>(null);

  const currentLang = locale === 'en' ? 'en' : 'zh';
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(currentLang === 'en' ? 'en-US' : 'zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [currentLang],
  );

  const signalLabels = t.riskTest.signalLabels as Record<string, string>;
  const formatAgentOutput = useCallback((value?: string) => (value || '').replace(/\*\*/g, ''), []);

  const getSeverityClass = useCallback(
    (severity?: string) => severityTone[(severity || 'high').toLowerCase()] || severityTone.high,
    [],
  );

  const getVerdictClass = useCallback(
    (verdict?: string) => verdictTone[(verdict || 'error').toLowerCase()] || verdictTone.error,
    [],
  );

  const getVerdictText = useCallback((verdict?: string) => {
    switch ((verdict || '').toLowerCase()) {
      case 'safe':
        return t.riskTest.verdictSafe;
      case 'risky':
        return t.riskTest.verdictRisky;
      default:
        return t.riskTest.verdictError;
    }
  }, [t.riskTest.verdictError, t.riskTest.verdictRisky, t.riskTest.verdictSafe]);

  const getStateClass = useCallback(
    (state?: string) => stateTone[(state || 'unknown').toLowerCase()] || stateTone.unknown,
    [],
  );

  const loadSeeds = useCallback(async (lang: 'zh' | 'en') => {
    const [stylesRes, examplesRes] = await Promise.all([
      riskTestAPI.styles(lang),
      riskTestAPI.examples(lang),
    ]);
    setStyles(stylesRes.data);
    setExamples(examplesRes.data);
    setSelectedStyles((prev) => {
      const allowed = stylesRes.data.map((item) => item.key);
      const kept = prev.filter((key) => allowed.includes(key));
      return kept.length > 0 ? kept : allowed.slice(0, 4);
    });
  }, []);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const res = await riskTestAPI.rules();
      setRules(res.data);
    } catch (error) {
      console.error('load risk-test rules failed', error);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSeeds(currentLang).catch((error) => {
      console.error('load risk test seeds failed', error);
    });
  }, [currentLang, loadSeeds]);

  useEffect(() => {
    loadRules().catch((error) => {
      console.error('load risk rules failed', error);
    });
  }, [loadRules]);

  const toggleStyle = useCallback((key: string) => {
    setSelectedStyles((prev) => (
      prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key]
    ));
  }, []);

  const runPreview = useCallback(async () => {
    if (!intent.trim()) return;
    setLoading(true);
    try {
      const res = await riskTestAPI.preview(intent.trim(), selectedStyles, currentLang);
      setResult(res.data);
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Risk test failed');
    } finally {
      setLoading(false);
    }
  }, [currentLang, intent, selectedStyles]);

  useEffect(() => {
    if (!result || !intent.trim()) return;
    riskTestAPI.preview(intent.trim(), selectedStyles, currentLang)
      .then((res) => setResult(res.data))
      .catch((error) => {
        console.error('refresh localized risk preview failed', error);
      });
  }, [currentLang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!result) {
      setDrafts({});
      setEvaluations({});
      setRunningCaseId(null);
      return;
    }

    const nextDrafts: Record<string, string> = {};
    result.cases.forEach((item) => {
      nextDrafts[item.id] = item.wrapped_prompt;
    });
    setDrafts(nextDrafts);
    setEvaluations({});
    setRunningCaseId(null);
    setSavingRuleCaseId(null);
  }, [result]);

  const updateDraft = useCallback((caseId: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [caseId]: value }));
  }, []);

  const runDryRun = useCallback(async (item: RiskTestCaseItem) => {
    const prompt = (drafts[item.id] ?? item.wrapped_prompt).trim();
    if (!prompt) return;

    setRunningCaseId(item.id);
    try {
      const res = await riskTestAPI.execute(prompt, currentLang);
      setEvaluations((prev) => ({ ...prev, [item.id]: res.data }));
    } catch (error: any) {
      setEvaluations((prev) => ({
        ...prev,
        [item.id]: {
          session_key: '',
          prompt,
          state: 'error',
          response_text: error.response?.data?.detail || t.riskTest.executeFailed,
          usage: null,
          stop_reason: null,
          dry_run: true,
          verdict: 'error',
          analysis: error.response?.data?.detail || t.riskTest.executeFailed,
          risk_signals: [],
          tool_attempt_count: 0,
          tool_attempts: [],
          rule_written: false,
          persisted_rule: null,
        },
      }));
    } finally {
      setRunningCaseId((current) => (current === item.id ? null : current));
    }
  }, [currentLang, drafts, t.riskTest.executeFailed]);

  const saveRuleForCase = useCallback(async (item: RiskTestCaseItem) => {
    const evaluation = evaluations[item.id];
    if (!evaluation?.persisted_rule) return;

    setSavingRuleCaseId(item.id);
    try {
      const res = await riskTestAPI.createRule({
        category_key: evaluation.persisted_rule.category_key,
        category: evaluation.persisted_rule.category,
        severity: evaluation.persisted_rule.severity,
        intent: evaluation.persisted_rule.intent,
        keywords: evaluation.persisted_rule.keywords,
        blocked_tools: evaluation.persisted_rule.blocked_tools,
        risk_signals: evaluation.persisted_rule.risk_signals,
        reason: evaluation.persisted_rule.reason,
      });
      setEvaluations((prev) => ({
        ...prev,
        [item.id]: {
          ...evaluation,
          rule_written: true,
          persisted_rule: res.data,
        },
      }));
      await loadRules();
    } catch (error) {
      console.error('save risk rule failed', error);
    } finally {
      setSavingRuleCaseId((current) => (current === item.id ? null : current));
    }
  }, [evaluations, loadRules]);

  const removeRule = useCallback(async (ruleId: string) => {
    setRemovingRuleId(ruleId);
    try {
      const res = await riskTestAPI.removeRule(ruleId);
      setRules(res.data);
    } catch (error) {
      console.error('remove risk rule failed', error);
    } finally {
      setRemovingRuleId((current) => (current === ruleId ? null : current));
    }
  }, []);

  return (
    <div className="min-h-screen">
      <div className="border-b border-border">
        <div className="px-8 py-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-text-primary">{t.riskTest.title}</h1>
            <span className="text-[11px] font-semibold border border-success/40 text-success px-3 py-1 rounded-full uppercase tracking-wider">
              {t.common.active}
            </span>
            <span className="text-[11px] font-semibold border border-accent/30 bg-accent/10 text-accent px-3 py-1 rounded-full uppercase tracking-wider">
              {t.riskTest.dryRunBadge}
            </span>
          </div>
          <p className="mt-2 max-w-4xl text-[13px] text-text-muted">{t.riskTest.subtitle}</p>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1.32fr_0.88fr] gap-6">
          <Card>
            <CardHeader icon={FlaskConical} title={t.riskTest.setupTitle} />
            <div className="p-5 space-y-5">
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {t.riskTest.intentLabel}
                </label>
                <textarea
                  value={intent}
                  onChange={(event) => setIntent(event.target.value)}
                  placeholder={t.riskTest.intentPlaceholder}
                  className="w-full min-h-[132px] rounded-xl border border-border bg-surface-0 px-4 py-3 text-[14px] text-text-primary placeholder-text-muted transition-all resize-y focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-400" />
                  <p className="text-[12px] font-semibold text-text-primary">{t.riskTest.dryRunTitle}</p>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
                  {t.riskTest.dryRunDesc}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    {t.riskTest.exampleLabel}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {examples.length} {t.riskTest.examplesCount}
                  </span>
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {examples.map((example) => (
                    <button
                      key={example.title}
                      onClick={() => setIntent(example.intent)}
                      className="flex min-h-[108px] h-full flex-col justify-between rounded-xl border border-border bg-surface-0 px-3 py-3 text-left transition-all hover:border-accent/40 hover:bg-accent/5"
                    >
                      <p className="text-[12px] font-medium text-text-primary">{example.title}</p>
                      <p className="mt-2 line-clamp-3 text-[11px] text-text-muted">{example.intent}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {t.riskTest.stylesLabel}
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {styles.map((style) => {
                    const active = selectedStyles.includes(style.key);
                    return (
                      <button
                        key={style.key}
                        onClick={() => toggleStyle(style.key)}
                        className={`rounded-xl border p-4 text-left transition-all ${
                          active
                            ? 'border-accent/40 bg-accent/10 shadow-lg shadow-accent/10'
                            : 'border-border bg-surface-0 hover:border-accent/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[13px] font-semibold text-text-primary">{style.label}</p>
                          <span className={`h-4 w-4 rounded-full border ${active ? 'border-accent bg-accent' : 'border-border bg-transparent'}`} />
                        </div>
                        <p className="mt-2 text-[12px] leading-relaxed text-text-muted">{style.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={runPreview}
                  disabled={loading || !intent.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-medium text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-dim disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" />
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
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${getSeverityClass(result.severity)}`}>
                    {result.severity}
                  </span>
                ) : undefined
              }
            />
            <div className="p-5">
              {!result ? (
                <div className="flex min-h-[356px] flex-col items-center justify-center text-center">
                  <Bot className="mb-4 h-10 w-10 text-text-muted/50" />
                  <p className="mb-2 text-sm font-medium text-text-secondary">{t.riskTest.emptyTitle}</p>
                  <p className="max-w-sm text-[12px] leading-relaxed text-text-muted">{t.riskTest.emptyDesc}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {t.riskTest.summaryMode}
                    </p>
                    <p className="text-[13px] leading-relaxed text-text-secondary">{result.summary}</p>
                    <p className="mt-2 text-[12px] leading-relaxed text-text-muted">{t.riskTest.verdictRuleNote}</p>
                  </div>
                  {result.severity?.toLowerCase() === 'low' ? (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                      <p className="text-[12px] leading-relaxed text-text-secondary">{t.riskTest.lowRiskNote}</p>
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {t.riskTest.summaryCategory}
                    </p>
                    <p className="text-[14px] font-semibold text-text-primary">{result.category}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {t.riskTest.summaryWhy}
                    </p>
                    <p className="text-[13px] leading-relaxed text-text-secondary">{result.harm}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {t.riskTest.summaryAdvice}
                    </p>
                    <p className="text-[13px] leading-relaxed text-text-secondary">{result.recommendation}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {t.riskTest.persistedRulesTitle}
                    </p>
                    <p className="text-2xl font-bold text-text-primary">{rules.length}</p>
                    <p className="mt-1 text-[12px] text-text-muted">{t.riskTest.persistedRulesCountDesc}</p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-text-primary">{t.riskTest.resultsTitle}</h2>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {result.cases.map((item) => {
                const evaluation = evaluations[item.id];
                return (
                  <Card key={item.id}>
                    <CardHeader
                      icon={ShieldAlert}
                      title={item.style_label}
                      badge={
                        <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-red-400">
                          {t.riskTest.blockedBadge}
                        </span>
                      }
                    />
                    <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-[1.08fr_0.92fr]">
                      <div className="space-y-4">
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                {t.riskTest.wrappedPrompt}
                              </p>
                              <span className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                                <PencilLine className="h-3 w-3" />
                                {t.riskTest.editable}
                              </span>
                            </div>
                            <button
                              onClick={() => runDryRun(item)}
                              disabled={runningCaseId === item.id || !(drafts[item.id] ?? item.wrapped_prompt).trim()}
                              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {runningCaseId === item.id ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <PlayCircle className="h-3.5 w-3.5" />
                              )}
                              {runningCaseId === item.id ? t.riskTest.sending : t.riskTest.runDryRun}
                            </button>
                          </div>
                          <textarea
                            value={drafts[item.id] ?? item.wrapped_prompt}
                            onChange={(event) => updateDraft(item.id, event.target.value)}
                            className="min-h-[260px] w-full rounded-xl border border-border bg-surface-0 px-4 py-3 text-[12px] leading-relaxed text-text-secondary transition-all focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/25"
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-border bg-surface-0 px-4 py-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                            {t.riskTest.expectedBehavior}
                          </p>
                          <p className="text-[13px] leading-relaxed text-text-secondary">{item.expected_behavior}</p>
                        </div>

                        <div className="min-h-[260px] rounded-xl border border-border bg-surface-0 px-4 py-3">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-accent" />
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                {t.riskTest.evaluationTitle}
                              </p>
                            </div>
                            {evaluation ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${getVerdictClass(evaluation.verdict)}`}>
                                  {getVerdictText(evaluation.verdict)}
                                </span>
                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${getStateClass(evaluation.state)}`}>
                                  {evaluation.state}
                                </span>
                              </div>
                            ) : null}
                          </div>

                          {evaluation ? (
                            <div className="space-y-4">
                              <div className="rounded-xl border border-border/80 bg-surface-1 px-4 py-3">
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                  {t.riskTest.agentOutputTitle}
                                </p>
                                <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-text-secondary">
                                  {formatAgentOutput(evaluation.response_text)}
                                </pre>
                              </div>

                              <div className="rounded-xl border border-border/80 bg-surface-1 px-4 py-3">
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                  {t.riskTest.analysisTitle}
                                </p>
                                <p className="text-[12px] leading-relaxed text-text-secondary">{evaluation.analysis}</p>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="rounded-xl border border-border/80 bg-surface-1 px-4 py-3">
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                    {t.riskTest.signalsTitle}
                                  </p>
                                  {evaluation.risk_signals.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                      {evaluation.risk_signals.map((signal) => (
                                        <span
                                          key={`${item.id}-${signal.key}`}
                                          className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400"
                                        >
                                          {signal.label}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-[12px] text-text-muted">{t.riskTest.noSignals}</p>
                                  )}
                                </div>

                                <div className="rounded-xl border border-border/80 bg-surface-1 px-4 py-3">
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                                    {t.riskTest.toolAttemptTitle}
                                  </p>
                                  <p className="text-[18px] font-semibold text-text-primary">
                                    {evaluation.tool_attempt_count}
                                  </p>
                                  <p className="mt-1 text-[12px] text-text-muted">
                                    {evaluation.tool_attempt_count > 0
                                      ? t.riskTest.toolAttemptDetected
                                      : t.riskTest.toolAttemptClear}
                                  </p>
                                </div>
                              </div>

                              {evaluation.persisted_rule ? (
                                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                      <ShieldAlert className="h-4 w-4 text-amber-400" />
                                      <p className="text-[12px] font-semibold text-text-primary">
                                        {evaluation.rule_written ? t.riskTest.ruleWrittenTitle : t.riskTest.ruleCandidateTitle}
                                      </p>
                                    </div>
                                    {!evaluation.rule_written ? (
                                      <button
                                        onClick={() => saveRuleForCase(item)}
                                        disabled={savingRuleCaseId === item.id}
                                        className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-[11px] font-semibold text-white shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-600 disabled:opacity-40"
                                      >
                                        {savingRuleCaseId === item.id ? (
                                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <ShieldCheck className="h-3.5 w-3.5" />
                                        )}
                                        {savingRuleCaseId === item.id ? t.riskTest.writingRule : t.riskTest.writeRule}
                                      </button>
                                    ) : null}
                                  </div>
                                  <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
                                    {evaluation.rule_written ? t.riskTest.ruleWrittenDesc : t.riskTest.ruleCandidateDesc}
                                  </p>
                                  <p className="mt-3 text-[12px] font-medium text-text-primary">
                                    {evaluation.persisted_rule.reason}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="flex h-[188px] items-center justify-center text-center">
                              <div>
                                <Bot className="mx-auto mb-3 h-8 w-8 text-text-muted/50" />
                                <p className="text-[13px] font-medium text-text-secondary">
                                  {t.riskTest.evaluationEmptyTitle}
                                </p>
                                <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
                                  {t.riskTest.evaluationEmptyDesc}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">{t.riskTest.persistedRulesTitle}</h2>
          </div>

          <Card>
            <div className="border-b border-border px-5 py-4">
              <p className="text-[13px] text-text-secondary">{t.riskTest.persistedRulesDesc}</p>
            </div>
            <div className="p-5">
              {rulesLoading ? (
                <div className="flex min-h-[160px] items-center justify-center">
                  <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
                </div>
              ) : rules.length === 0 ? (
                <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
                  <ShieldX className="mb-4 h-10 w-10 text-text-muted/50" />
                  <p className="text-sm font-medium text-text-secondary">{t.riskTest.persistedRulesEmptyTitle}</p>
                  <p className="mt-2 max-w-md text-[12px] leading-relaxed text-text-muted">
                    {t.riskTest.persistedRulesEmptyDesc}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {rules.map((rule) => (
                    <div key={rule.id} className="rounded-xl border border-border bg-surface-0 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[14px] font-semibold text-text-primary">{rule.category}</p>
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${getSeverityClass(rule.severity)}`}>
                              {rule.severity}
                            </span>
                          </div>
                          <p className="mt-2 text-[12px] text-text-muted">
                            {t.riskTest.ruleCreatedAt}: {formatter.format(new Date(rule.created_at * 1000))}
                          </p>
                        </div>
                        <button
                          onClick={() => removeRule(rule.id)}
                          disabled={removingRuleId === rule.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-[11px] font-semibold text-text-secondary transition-all hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400 disabled:opacity-40"
                        >
                          {removingRuleId === rule.id ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          {removingRuleId === rule.id ? t.riskTest.removingRule : t.riskTest.removeRule}
                        </button>
                      </div>

                      <div className="mt-4 space-y-3">
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                            {t.riskTest.ruleIntent}
                          </p>
                          <p className="text-[12px] leading-relaxed text-text-secondary">{rule.intent}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                            {t.riskTest.ruleReason}
                          </p>
                          <p className="text-[12px] leading-relaxed text-text-secondary">{rule.reason}</p>
                        </div>
                        <div>
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                            {t.riskTest.ruleSignals}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {rule.risk_signals.length > 0 ? (
                              rule.risk_signals.map((signal) => (
                                <span
                                  key={`${rule.id}-${signal}`}
                                  className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400"
                                >
                                  {signalLabels[signal] || signal}
                                </span>
                              ))
                            ) : (
                              <span className="text-[12px] text-text-muted">{t.riskTest.noSignals}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
