import type { GuardToolPolicies, GuardToolPolicy } from '../services/api';
import type { GuardPendingApproval } from '../services/api';

export type RuntimeGuardToolPermission = 'Allowed' | 'Guard' | 'Asked';
export type RuntimeGuardToolId = 'shell' | 'fileSystem' | 'browser' | 'network' | 'git';
export type RuntimeGuardToolPermissions = Record<RuntimeGuardToolId, RuntimeGuardToolPermission>;
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

export const defaultToolPermissions: RuntimeGuardToolPermissions = {
  shell: 'Guard',
  fileSystem: 'Guard',
  browser: 'Guard',
  network: 'Guard',
  git: 'Guard',
};

const runtimeGuardToolPolicyCategoryById: Record<RuntimeGuardToolId, keyof GuardToolPolicies> = {
  shell: 'shell',
  fileSystem: 'file_system',
  browser: 'browser',
  network: 'network',
  git: 'git',
};

const runtimeGuardToolIdByPolicyCategory: Record<keyof GuardToolPolicies, RuntimeGuardToolId> = {
  shell: 'shell',
  file_system: 'fileSystem',
  browser: 'browser',
  network: 'network',
  git: 'git',
};

const permissionToPolicy: Record<RuntimeGuardToolPermission, GuardToolPolicy> = {
  Allowed: 'allow',
  Guard: 'guard',
  Asked: 'ask',
};

const policyToPermission: Record<GuardToolPolicy, RuntimeGuardToolPermission> = {
  allow: 'Allowed',
  guard: 'Guard',
  ask: 'Asked',
};

function guardStatusFromScore(score: number, guardMode: RuntimeGuardMode): Pick<GuardStatusSummary, 'label' | 'tone'> {
  if (guardMode === 'Off') return { label: 'Manual', tone: 'off' };
  if (score >= 96) return { label: 'Secure', tone: 'secure' };
  if (score >= 88) return { label: 'Guarded', tone: 'guarded' };
  return { label: 'Review', tone: 'attention' };
}

export function runtimeGuardToolPermissionLabel(permission: RuntimeGuardToolPermission): string {
  if (permission === 'Allowed') return 'Allow';
  if (permission === 'Asked') return 'Ask';
  return 'Guard';
}

export function toolPermissionsFromPolicies(
  policies: Partial<GuardToolPolicies> | null | undefined,
): RuntimeGuardToolPermissions {
  const permissions = { ...defaultToolPermissions };
  if (!policies) return permissions;

  Object.entries(policies).forEach(([category, policy]) => {
    const toolId = runtimeGuardToolIdByPolicyCategory[category as keyof GuardToolPolicies];
    const permission = policyToPermission[policy as GuardToolPolicy];
    if (toolId && permission) {
      permissions[toolId] = permission;
    }
  });
  return permissions;
}

export function toolPoliciesFromPermissions(
  permissions: RuntimeGuardToolPermissions,
): GuardToolPolicies {
  return Object.fromEntries(
    Object.entries(runtimeGuardToolPolicyCategoryById).map(([toolId, category]) => [
      category,
      permissionToPolicy[permissions[toolId as RuntimeGuardToolId]],
    ]),
  ) as GuardToolPolicies;
}

export function calculateGuardStatusSummary(
  guardMode: RuntimeGuardMode,
  _permissions: RuntimeGuardToolPermissions,
  _unresolvedApprovals: GuardPendingApproval[],
): GuardStatusSummary {
  const score = guardMode === 'On' ? 100 : 80;
  return { score, ...guardStatusFromScore(score, guardMode) };
}

export function buildGuardStatusRows(
  guardMode: RuntimeGuardMode,
  _permissions: RuntimeGuardToolPermissions,
  _pendingCount: number,
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
