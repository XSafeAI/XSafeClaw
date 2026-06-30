export type RuntimeGuardMode = 'On' | 'Off';
export type GuardStatusTone = 'secure' | 'guarded' | 'attention' | 'off';
export type GuardStatusRowTone = 'success' | 'warning' | 'asked' | 'muted';

export type GuardStatusSummary = {
  score: number;
  label: string;
  tone: GuardStatusTone;
};

export type GuardStatusRow = {
  label: string;
  status: string;
  tone: GuardStatusRowTone;
};

function guardStatusFromScore(score: number, guardMode: RuntimeGuardMode): Pick<GuardStatusSummary, 'label' | 'tone'> {
  if (guardMode === 'Off') return { label: 'Manual', tone: 'off' };
  if (score >= 96) return { label: 'Secure', tone: 'secure' };
  if (score >= 88) return { label: 'Guarded', tone: 'guarded' };
  return { label: 'Review', tone: 'attention' };
}

export function calculateGuardStatusSummary(
  guardMode: RuntimeGuardMode,
): GuardStatusSummary {
  const score = guardMode === 'On' ? 100 : 80;
  return { score, ...guardStatusFromScore(score, guardMode) };
}

export function buildGuardStatusRows(
  guardMode: RuntimeGuardMode,
): GuardStatusRow[] {
  const status = guardMode === 'On' ? 'on' : 'off';
  const tone: GuardStatusRowTone = guardMode === 'On' ? 'success' : 'muted';

  return [
    { label: 'Prompt Injection', status, tone },
    { label: 'Data Leakage', status, tone },
    { label: 'Tool Call', status, tone },
    { label: 'Skill Injection', status, tone },
  ];
}
