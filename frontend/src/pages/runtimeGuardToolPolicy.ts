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

const allowPenalties: Record<RuntimeGuardToolId, number> = {
  shell: 2,
  fileSystem: 3,
  browser: 1,
  network: 2,
  git: 2,
};

function clampGuardScore(score: number): number {
  return Math.min(100, Math.max(75, Math.round(score)));
}

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

function toolPermissionTone(permission: RuntimeGuardToolPermission): GuardStatusRowTone {
  if (permission === 'Allowed') return 'success';
  if (permission === 'Asked') return 'asked';
  return 'warning';
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
  permissions: RuntimeGuardToolPermissions,
  unresolvedApprovals: GuardPendingApproval[],
): GuardStatusSummary {
  const baseScore = guardMode === 'On' ? 100 : 90;
  const allowPenalty = Object.entries(permissions).reduce((total, [toolId, permission]) => {
    if (permission !== 'Allowed') return total;
    return total + allowPenalties[toolId as RuntimeGuardToolId];
  }, 0);
  const pendingPenalty = Math.min(unresolvedApprovals.length, 3);
  const score = clampGuardScore(baseScore - allowPenalty - pendingPenalty);
  return { score, ...guardStatusFromScore(score, guardMode) };
}

export function buildGuardStatusRows(
  guardMode: RuntimeGuardMode,
  permissions: RuntimeGuardToolPermissions,
  pendingCount: number,
): GuardStatusRow[] {
  const networkLabel = runtimeGuardToolPermissionLabel(permissions.network);
  const gitLabel = runtimeGuardToolPermissionLabel(permissions.git);
  const networkGitStatus = networkLabel === gitLabel ? networkLabel : `${networkLabel}/${gitLabel}`;
  const networkGitTone = permissions.network === 'Guard' || permissions.git === 'Guard'
    ? 'warning'
    : permissions.network === 'Asked' || permissions.git === 'Asked'
      ? 'asked'
      : 'success';

  return [
    {
      label: 'Guard Mode',
      status: guardMode === 'On' ? 'on' : 'off',
      tone: guardMode === 'On' ? 'success' : 'warning',
    },
    {
      label: 'Pending',
      status: pendingCount > 0 ? `${pendingCount} waiting` : 'Clear',
      tone: pendingCount > 0 ? 'warning' : 'success',
    },
    {
      label: 'Shell',
      status: runtimeGuardToolPermissionLabel(permissions.shell),
      tone: toolPermissionTone(permissions.shell),
    },
    {
      label: 'File System',
      status: runtimeGuardToolPermissionLabel(permissions.fileSystem),
      tone: toolPermissionTone(permissions.fileSystem),
    },
    {
      label: 'Browser',
      status: runtimeGuardToolPermissionLabel(permissions.browser),
      tone: toolPermissionTone(permissions.browser),
    },
    {
      label: 'Network/Git',
      status: networkGitStatus,
      tone: networkGitTone,
    },
  ];
}
