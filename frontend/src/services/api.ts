import axios from 'axios';
import type {
  Session,
  Message,
  ToolCall,
  Event,
  EventWithMessages,
  AssetRiskAssessment,
  HardwareInfo,
  PaginatedResponse,
  Statistics,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export type ProtectedPathOperation = 'read' | 'modify' | 'delete';

export interface ProtectedPathEntry {
  path: string;
  operations: ProtectedPathOperation[];
}

export interface DirectoryBrowseEntry {
  name: string;
  path: string;
  is_hidden: boolean;
}

export interface DirectoryBrowseResult {
  current_path: string;
  parent_path: string | null;
  root_path: string;
  entries: DirectoryBrowseEntry[];
}

export interface RuntimeInstance {
  instance_id: string;
  platform: 'openclaw' | 'nanobot' | 'hermes';
  display_name: string;
  config_path: string | null;
  workspace_path: string | null;
  sessions_path: string | null;
  serve_base_url: string | null;
  gateway_base_url: string | null;
  discovery_mode: 'auto' | 'manual';
  enabled: boolean;
  is_default: boolean;
  capabilities: Record<string, boolean>;
  attach_state: string;
  health_status: string;
  meta: Record<string, any>;
}

export interface SystemStatusResponse {
  platform?: string;
  openclaw_installed: boolean;
  hermes_installed?: boolean;
  openclaw_version: string | null;
  hermes_path?: string | null;
  hermes_api_port?: number;
  hermes_config_path?: string;
  hermes_home?: string;
  hermes_api_key_configured?: boolean;
  hermes_api_server_enabled?: boolean;
  nanobot_installed: boolean;
  nanobot_version: string | null;
  nanobot_path: string | null;
  nanobot_config_exists: boolean;
  nanobot_model_configured: boolean;
  daemon_running: boolean;
  openclaw_path: string | null;
  node_version: string;
  config_exists: boolean;
  has_instances: boolean;
  requires_setup: boolean;
  requires_configure: boolean;
  requires_nanobot_setup: boolean;
  requires_nanobot_configure: boolean;
  default_instance: RuntimeInstance | null;
  instances: RuntimeInstance[];
  runtime_summary: {
    total: number;
    enabled: number;
    openclaw: number;
    nanobot: number;
    hermes?: number;
    chat_ready: number;
  };
  error?: string;
}

export interface InstallStatusResponse {
  xsafeclaw_version?: string | null;
  openclaw_installed: boolean;
  hermes_installed?: boolean;
  openclaw_version: string | null;
  openclaw_error?: string | null;
  openclaw_path: string | null;
  nanobot_installed: boolean;
  nanobot_version: string | null;
  nanobot_error?: string | null;
  nanobot_path: string | null;
  codex_installed?: boolean;
  codex_version?: string | null;
  codex_error?: string | null;
  codex_path?: string | null;
  codex_configured?: boolean;
  codex_status?: 'missing' | 'installed' | 'needs_login' | 'ready' | 'warning' | 'error' | string;
  codex_warnings?: string[];
  config_exists: boolean;
  nanobot_config_exists: boolean;
  nanobot_model_configured: boolean;
  // §42: surfaced by the backend so the multi-runtime configure selector
  // can mark Hermes the same way it marks OpenClaw / Nanobot.
  hermes_config_exists?: boolean;
  hermes_model_configured?: boolean;
  requires_setup: boolean;
  requires_configure: boolean;
  requires_hermes_configure?: boolean;
  requires_nanobot_setup: boolean;
  requires_nanobot_configure: boolean;
  node_version: string;
}

export type CodexAuthStatus = 'logged_in' | 'logged_out' | 'missing' | 'error';
export type CodexAuthMode = 'chatgpt' | 'api_key' | 'access_token' | 'unknown' | null;
export type CodexRuntimeStatus = 'missing' | 'installed' | 'needs_login' | 'ready' | 'warning' | 'error';

export interface CodexAuthStatusResponse {
  installed: boolean;
  logged_in: boolean;
  auth_mode: CodexAuthMode;
  status: CodexAuthStatus;
  codex_path: string | null;
  message: string;
  error: string | null;
}

export interface CodexRuntimeStatusResponse {
  installed: boolean;
  configured: boolean;
  status: CodexRuntimeStatus;
  version: string | null;
  path: string | null;
  entry_path: string | null;
  install_context: string | null;
  warnings: string[];
  error: string | null;
}

export type CodexModelCatalogStatus = 'ready' | 'missing' | 'error' | string;

export interface CodexSpeedTierOption {
  id: string;
  name: string;
  description: string | null;
  service_tier: string | null;
}

export interface CodexModelCatalogItem {
  id: string;
  model: string;
  display_name: string;
  is_default: boolean;
  default_reasoning_effort: string | null;
  supported_reasoning_efforts: string[];
  service_tiers: CodexSpeedTierOption[];
}

export interface CodexModelCatalogResponse {
  installed: boolean;
  status: CodexModelCatalogStatus;
  source: string | null;
  models: CodexModelCatalogItem[];
  message: string;
  error: string | null;
}

export type CodexRateLimitStatus = 'ready' | 'missing' | 'logged_out' | 'unsupported' | 'error' | string;

export interface CodexRateLimitWindow {
  remaining_percent: number | null;
  used_percent: number | null;
  resets_at: number | null;
}

export interface CodexRateLimitsResponse {
  installed: boolean;
  status: CodexRateLimitStatus;
  five_hour: CodexRateLimitWindow;
  seven_day: CodexRateLimitWindow;
  plan_type: string | null;
  message: string;
  error: string | null;
}

export type CodexSessionListStatus = 'ready' | 'missing' | 'error' | string;

export interface CodexSessionRecord {
  id: string;
  session_id: string | null;
  title: string | null;
  preview: string | null;
  cwd: string | null;
  created_at: string | null;
  updated_at: string | null;
  status: string | null;
  source: string | null;
  originator?: string | null;
  history_kind?: 'cli' | 'xsafeclaw' | string | null;
  deletable?: boolean;
  path: string | null;
  cli_version: string | null;
}

export interface CodexSessionListResponse {
  installed: boolean;
  status: CodexSessionListStatus;
  sessions: CodexSessionRecord[];
  next_cursor: string | null;
  message: string;
  error: string | null;
}

export type CodexSessionMessagesStatus = 'ready' | 'missing' | 'error' | string;

export interface CodexSessionMessageRecord {
  id: string;
  role: 'user' | 'assistant' | 'error' | 'tool_call' | 'trace';
  content: string;
  timestamp: string;
  tool_id?: string;
  tool_name?: string;
  args?: any;
  result?: any;
  is_error?: boolean;
  result_pending?: boolean;
  trace_type?: string;
  trace_phase?: string;
  trace_step?: number;
  trace_summary?: string;
  tool_category?: string;
  tool_action?: string;
  timeline_kind?: string;
  risk_level?: string;
}

export interface CodexSessionMessagesResponse {
  installed: boolean;
  status: CodexSessionMessagesStatus;
  thread_id: string;
  messages: CodexSessionMessageRecord[];
  message: string;
  error: string | null;
}

export interface CodexConversationOpenRequest {
  cwd?: string | null;
  model?: string | null;
  permission_mode?: 'read_only' | 'workspace_write' | 'full_access' | null;
}

export interface CodexConversationResumeRequest extends CodexConversationOpenRequest {
  thread_id: string;
}

export interface CodexConversationOpenResponse {
  installed: boolean;
  status: 'ready' | 'missing' | 'error' | string;
  session_key: string;
  thread_id: string;
  session_id: string | null;
  title: string;
  cwd: string | null;
  instruction_hash: string;
  instruction_bytes: number;
  message: string;
  error: string | null;
}

export interface CodexConversationTurnRequest {
  message: string;
  thread_id?: string | null;
  cwd?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  speed?: string | null;
  permission_mode?: 'read_only' | 'workspace_write' | 'full_access' | null;
  plan_mode?: boolean;
  goal_mode?: boolean;
  goal_objective?: string | null;
}

export interface CodexConversationInterruptRequest {
  thread_id?: string | null;
  turn_id?: string | null;
}

export interface CodexConversationGoalClearRequest {
  thread_id?: string | null;
}

export interface CodexConversationGoalClearResponse {
  status: string;
  thread_id: string | null;
  cleared: boolean;
}

export interface CodexUserInputAnswerPayload {
  answers: string[];
}

export interface CodexRequestUserInputResponseRequest {
  answers: Record<string, CodexUserInputAnswerPayload>;
}

export interface RuntimeInstanceHealth {
  instance_id: string;
  platform: 'openclaw' | 'nanobot' | 'hermes';
  display_name: string;
  health_status: string;
  attach_state: string;
  chat_ready: boolean;
}

export type RuntimeBudgetPlatform = 'openclaw' | 'hermes' | 'nanobot';
export type BudgetPeriodUnit = 'hour' | 'day';

export interface RuntimeBudgetStatus {
  platform: RuntimeBudgetPlatform;
  maxCost: number | null;
  periodValue: number;
  periodUnit: BudgetPeriodUnit;
  periodStartAt: string;
  periodEndAt: string;
  updatedAt: string;
  currentCost: number;
  budgetUsed: number;
  budgetPercent: number;
  overLimit: boolean;
  remainingMs: number;
  estimatedTokens: number;
  costUnknownTokens: number;
  costUnknownModels: number;
  costBreakdown: unknown[];
}

export interface UpdateRuntimeBudgetPayload {
  maxCost: number | null;
  periodValue: number;
  periodUnit: BudgetPeriodUnit;
}

export type RuntimeBudgetAgentName = 'Codex' | 'OpenClaw' | 'Hermes' | 'Nanobot';

export interface StartSessionPayload {
  instance_id?: string;
  label?: string | null;
  label_mode?: 'server_timestamp' | null;
  model_override?: string | null;
  provider_override?: string | null;
}

export interface StartSessionResponse {
  session_key: string;
  status: string;
  instance_id: string;
  platform: RuntimeInstance['platform'] | 'codex';
  instance?: RuntimeInstance;
}

export interface SmartStartSessionPayload {
  message: string;
}

export interface SmartStartSessionResponse extends StartSessionResponse {
  selected_agent: RuntimeBudgetAgentName;
  smart: boolean;
  router_source?: string | null;
}

export interface RuntimeInstanceCapabilitiesResponse {
  instance_id: string;
  platform: 'openclaw' | 'nanobot' | 'hermes';
  display_name: string;
  capabilities: Record<string, boolean>;
  attach_state: string;
}

export interface NanobotGuardConfigResponse {
  instance_id: string;
  platform: 'nanobot';
  display_name: string;
  mode: 'disabled' | 'observe' | 'blocking';
  enabled: boolean;
  hook_present: boolean;
  hook_valid: boolean;
  class_path: string | null;
  base_url: string;
  timeout_s: number;
  configured_instance_id: string | null;
  default_base_url?: string;
  default_timeout_s?: number;
  instance?: RuntimeInstance;
  instances?: RuntimeInstance[];
}

export type NanobotGuardMode = 'disabled' | 'observe' | 'blocking';

export interface NanobotProviderOption {
  id: string;
  name: string;
  default_model: string;
}

export interface NanobotProviderConfigState {
  has_api_key: boolean;
  api_base: string | null;
}

export interface NanobotModelCatalogModel {
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
  available?: boolean;
  input?: string;
}

export interface NanobotModelCatalogProvider {
  id: string;
  name: string;
  models: NanobotModelCatalogModel[];
}

export interface NanobotModelCatalogResponse {
  provider_options: NanobotProviderOption[];
  model_providers: NanobotModelCatalogProvider[];
  default_model: string;
}

export interface NanobotConfigResponse {
  success?: boolean;
  config_exists: boolean;
  config_path: string;
  workspace: string;
  provider: string;
  model: string;
  model_configured: boolean;
  api_base: string | null;
  provider_options: NanobotProviderOption[];
  provider_configs: Record<string, NanobotProviderConfigState>;
  gateway: {
    host: string;
    port: number;
    health_url: string;
  };
  websocket: {
    enabled: boolean;
    host: string;
    port: number;
    path: string;
    url: string;
    requires_token: boolean;
    has_token: boolean;
  };
  guard: {
    mode: NanobotGuardMode;
    enabled: boolean;
    hook_present: boolean;
    hook_valid: boolean;
    base_url: string;
    timeout_s: number;
    configured_instance_id: string | null;
  };
  instances?: RuntimeInstance[];
  /**
   * Set by ``POST /system/nanobot/config`` when the backend tries to hot-reload
   * the local ``nanobot gateway`` after writing the new config. ``GET`` of the
   * same endpoint never sets these because it doesn't restart anything.
   */
  restart_attempted?: boolean;
  /**
   * Status of the gateway restart attempt. Mirrors ``StartResult`` from the
   * backend ``runtime_autostart`` module:
   *   - ``"started"``         – old gateway was stopped, new one is now serving ``/health``
   *   - ``"already_running"`` – ``/health`` was already 200 (typically after we
   *     successfully stopped the old gateway, the new one came up before the
   *     post-write probe)
   *   - ``"skipped"``         – nanobot CLI / config not present, so nothing to start
   *   - ``"failed"``          – stop or autostart raised; see ``restart_detail``
   */
  restart_status?: 'started' | 'already_running' | 'skipped' | 'failed' | string;
  /** Human-readable detail / failure reason corresponding to ``restart_status``. */
  restart_detail?: string;
  /** Number of nanobot gateway processes the backend terminated before restart. */
  stopped_gateway_processes?: number;
}

export interface NanobotConfigPayload {
  workspace: string;
  provider?: string | null;
  model?: string | null;
  api_key?: string | null;
  clear_api_key?: boolean;
  api_base?: string | null;
  gateway_host: string;
  gateway_port: number;
  websocket_enabled: boolean;
  websocket_host: string;
  websocket_port: number;
  websocket_path: string;
  websocket_requires_token: boolean;
  websocket_token?: string | null;
  guard_mode: NanobotGuardMode;
  guard_base_url: string;
  guard_timeout_s: number;
}

export interface RuntimeSessionRecord {
  session_id: string;
  platform: RuntimeInstance['platform'] | string;
  instance_id: string;
  source_session_id: string | null;
  display_session_id: string;
  session_key: string | null;
  first_seen_at: string;
  last_activity_at: string | null;
  cwd: string | null;
  current_model_provider: string | null;
  current_model_name: string | null;
  total_runs: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface RuntimeSessionListResponse {
  sessions: RuntimeSessionRecord[];
  total: number;
  page: number;
  page_size: number;
}

export interface LocalRuntimeSessionRecord {
  platform: 'openclaw' | 'hermes';
  instance_id: string;
  source_session_id: string;
  session_key: string;
  title: string;
  cwd: string | null;
  created_at: string;
  updated_at: string;
  path_available: boolean;
}

export interface LocalRuntimeSessionListResponse {
  platform: 'openclaw' | 'hermes';
  instance_id: string;
  sessions: LocalRuntimeSessionRecord[];
  total: number;
}

export interface LocalRuntimeSessionDeleteResponse {
  platform: 'openclaw' | 'hermes';
  instance_id: string;
  source_session_id: string;
  session_key: string | null;
  deleted_file: boolean;
  updated_index: boolean;
}

export interface CodexSessionDeleteResponse {
  thread_id: string;
  source: string;
  originator?: string | null;
  history_kind?: 'cli' | 'xsafeclaw' | string | null;
  archived: boolean;
  deleted_file: boolean;
  path: string | null;
}

// Sessions API
export const sessionsAPI = {
  list: (params?: { page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<Session>>('/sessions/', { params }),

  listRuntime: (params?: { page?: number; page_size?: number; platform?: string; instance_id?: string }) =>
    api.get<RuntimeSessionListResponse>('/sessions/', { params }),
  
  get: (sessionId: string) =>
    api.get<Session>(`/sessions/${sessionId}`),
  
  getMessages: (sessionId: string, params?: { page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<Message>>(`/sessions/${sessionId}/messages/`, { params }),
  
  getToolCalls: (sessionId: string, params?: { page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<ToolCall>>(`/sessions/${sessionId}/tool-calls/`, { params }),
};

// Messages API
export const messagesAPI = {
  list: (params?: { session_id?: string; role?: string; page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<Message>>('/messages/', { params }),
  
  get: (messageId: string) =>
    api.get<Message>(`/messages/${messageId}`),
};

// Tool Calls API
export const toolCallsAPI = {
  list: (params?: { session_id?: string; tool_name?: string; page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<ToolCall>>('/tool-calls/', { params }),
  
  get: (toolCallId: string) =>
    api.get<ToolCall>(`/tool-calls/${toolCallId}`),
};

// Events API
export const eventsAPI = {
  list: (params?: { session_id?: string; page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<Event>>('/events/', { params }),
  
  get: (eventId: string) =>
    api.get<EventWithMessages>(`/events/${eventId}`),
  
  overview: () =>
    api.get('/events/stats/overview'),
};

// Assets API
export const assetsAPI = {
  assessPath: (path: string) =>
    api.get<AssetRiskAssessment>('/assets/assess-path', { params: { path } }),
  
  hardware: () =>
    api.get<HardwareInfo>('/assets/hardware'),
  
  /** Start an async file scan */
  startScan: (data: { path?: string; max_depth?: number; scan_system_root?: boolean }) =>
    api.post('/assets/scan', data),

  browseDirectories: (path?: string) =>
    api.get<DirectoryBrowseResult>('/assets/browse', { params: { path } }),

  /** Request cancellation for an async file scan */
  stopScan: (scanId: string) =>
    api.post('/assets/scan/stop', { scan_id: scanId }),

  /** Poll file scan progress */
  scanProgress: (scanId: string) =>
    api.get('/assets/scan/progress', { params: { scan_id: scanId } }),

  /** Start async software scan */
  startSoftwareScan: () =>
    api.post<{ scan_id: string; status: string; message: string }>('/assets/software/scan'),

  /** Poll software scan progress */
  softwareScanProgress: (scanId: string) =>
    api.get<{
      scan_id: string;
      status: string;
      result?: { total: number; software_list: SoftwareItem[] };
      error?: string;
    }>('/assets/software/scan/progress', { params: { scan_id: scanId } }),

  /** Check file operation safety */
  checkSafety: (path: string, operation: string) =>
    api.post<{ status: string; risk_level: number; reason: string }>(
      '/assets/check-safety',
      { path, operation }
    ),

  /** Reload software whitelist into SafetyGuard */
  reloadSoftwareWhitelist: () =>
    api.post('/assets/check-safety/reload-software'),

  overview: () =>
    api.get('/assets/stats/overview'),

  // Denylist (user-protected paths)
  getDenylist: () =>
    api.get<{ entries: ProtectedPathEntry[]; paths: string[] }>('/assets/denylist'),

  addDenyPath: (path: string, operations: ProtectedPathOperation[]) =>
    api.post<{ entries: ProtectedPathEntry[]; paths: string[] }>('/assets/denylist', {
      path,
      operations,
    }),

  removeDenyPath: (path: string) =>
    api.delete<{ entries: ProtectedPathEntry[]; paths: string[] }>('/assets/denylist', { params: { path } }),
};

export interface SoftwareItem {
  name: string;
  version: string;
  install_location: string | null;
  publisher: string;
  source: string;
  bundle_id: string | null;
  related_paths: string[];
}

export interface RiskTestStyleItem {
  key: string;
  label: string;
  description: string;
}

export interface RiskTestExampleItem {
  title: string;
  intent: string;
}

export interface RiskTestCaseItem {
  id: string;
  style_key: string;
  style_label: string;
  wrapped_prompt: string;
  expected_behavior: string;
  simulated_response: string;
  blocked: boolean;
}

export interface RiskTestPreviewResult {
  intent: string;
  preview_only: boolean;
  category: string;
  severity: string;
  summary: string;
  harm: string;
  recommendation: string;
  cases: RiskTestCaseItem[];
}

export interface RiskSignalItem {
  key: string;
  label: string;
}

export interface PersistedRiskRuleItem {
  id: string;
  category_key: string;
  category: string;
  severity: string;
  intent: string;
  keywords: string[];
  blocked_tools: string[];
  risk_signals: string[];
  reason: string;
  created_at: number;
  enabled: boolean;
}

export interface PersistedRiskRuleCreateRequest {
  category_key: string;
  category: string;
  severity: string;
  intent: string;
  keywords: string[];
  blocked_tools: string[];
  risk_signals: string[];
  reason: string;
}

export interface RiskTestExecuteResult {
  session_key: string;
  prompt: string;
  state: string;
  response_text: string;
  usage: Record<string, any> | null;
  stop_reason: string | null;
  dry_run: boolean;
  verdict: string;
  analysis: string;
  risk_signals: RiskSignalItem[];
  tool_attempt_count: number;
  tool_attempts: Record<string, any>[];
  rule_written: boolean;
  persisted_rule: PersistedRiskRuleItem | null;
}

export const riskTestAPI = {
  styles: (locale: 'zh' | 'en') =>
    api.get<RiskTestStyleItem[]>('/risk-test/styles', { params: { locale } }),

  examples: (locale: 'zh' | 'en') =>
    api.get<RiskTestExampleItem[]>('/risk-test/examples', { params: { locale } }),

  preview: (intent: string, styles?: string[], locale: 'zh' | 'en' = 'zh') =>
    api.post<RiskTestPreviewResult>('/risk-test/preview', { intent, styles, locale }),

  execute: (prompt: string, locale: 'zh' | 'en' = 'zh') =>
    api.post<RiskTestExecuteResult>('/risk-test/execute', { prompt, locale }),

  rules: () =>
    api.get<PersistedRiskRuleItem[]>('/risk-test/rules'),

  createRule: (rule: PersistedRiskRuleCreateRequest) =>
    api.post<PersistedRiskRuleItem>('/risk-test/rules', rule),

  removeRule: (ruleId: string) =>
    api.delete<PersistedRiskRuleItem[]>(`/risk-test/rules/${ruleId}`),
};

// Red Team API
export const redteamAPI = {
  listInstructions: () =>
    api.get<{ record_id: string; instruction: string }[]>('/redteam/instructions'),

  generate: (recordId: string) =>
    api.post<{
      record_id: string;
      instruction: string;
      name: string;
      description: string;
      risk_type: string;
      turns: { thought: string; output: string }[];
    }>('/redteam/generate', { record_id: recordId }),

  startSession: () =>
    api.post<{ session_key: string; status: string }>('/chat/start-session'),

  sendMessage: (sessionKey: string, message: string) =>
    api.post<{
      run_id: string;
      state: string;
      response_text: string;
      usage: Record<string, any> | null;
      stop_reason: string | null;
    }>('/chat/send-message', { session_key: sessionKey, message }),

  closeSession: (sessionKey: string) =>
    api.post('/chat/close-session', null, { params: { session_key: sessionKey } }),
};

// Chat API (direct OpenClaw gateway session)
export const chatAPI = {
  startSession: (data?: StartSessionPayload) =>
    api.post<StartSessionResponse>('/chat/start-session', data ?? {}),

  smartStartSession: (data: SmartStartSessionPayload) =>
    api.post<SmartStartSessionResponse>('/chat/smart-start-session', data),

  listSessions: () =>
    api.get<{
      sessions: Array<{
        key: string;
        label?: string | null;
        created_at?: string | null;
        last_activity_at?: string | null;
        instance_id?: string | null;
        platform?: string | null;
        display_name?: string | null;
        model?: string | null;
        auto_title_pending?: boolean | null;
      }>;
    }>('/chat/sessions'),

  sendMessage: (sessionKey: string, message: string) =>
    api.post<{
      run_id: string;
      state: string;
      response_text: string;
      usage: Record<string, any> | null;
      stop_reason: string | null;
    }>('/chat/send-message', { session_key: sessionKey, message }),

  getHistory: (sessionKey: string, limit = 100) =>
    api.get<{ session_key: string; messages: any[] }>('/chat/history', {
      params: { session_key: sessionKey, limit },
    }),

  sessionTitle: (data: { message: string; session_key?: string; platform?: string; instance_id?: string }) =>
    api.post<{ title: string }>('/chat/session-title', data),

  closeSession: (sessionKey: string) =>
    api.post('/chat/close-session', null, { params: { session_key: sessionKey } }),

  deleteSession: (sessionId: string) =>
    api.delete(`/sessions/${sessionId}`),

  patchSession: (sessionKey: string, data: { model?: string | null; thinking_level?: string | null }) =>
    api.post<{ status: string }>('/chat/patch-session', { session_key: sessionKey, ...data }),

  availableModels: (instanceId?: string) =>
    api.get<{
      models: { id: string; name: string; provider: string; reasoning: boolean }[];
      default_model: string;
      instance_id: string;
      platform: string;
      supports_session_patch: boolean;
      instance?: RuntimeInstance;
    }>('/chat/available-models', { params: instanceId ? { instance_id: instanceId } : {} }),

  modelReadiness: (modelId: string, instanceId?: string) =>
    api.get<{ model_id: string; ready: boolean; visible_model_id?: string | null; reason?: string | null }>('/chat/model-readiness', {
      params: instanceId ? { model_id: modelId, instance_id: instanceId } : { model_id: modelId },
    }),
};

// Voice / speech-to-text helpers
export const voiceAPI = {
  /**
   * Clean up raw speech-to-text transcript using the configured OpenClaw model.
   * Frontend still needs to produce raw transcript (e.g. via Web Speech API).
   */
  transcribeClean: (data: { text: string; model?: string | null; thinking_level?: string | null }) =>
    api.post<{ raw_text: string; cleaned_text: string }>('/chat/transcribe-clean', data),
};

// Statistics API
export const statsAPI = {
  overview: () =>
    api.get<Statistics>('/stats/overview'),
  
  toolUsage: () =>
    api.get('/stats/tool-usage'),

  dashboard: (params?: { platform?: string; instance_id?: string }) =>
    api.get<any>('/stats/dashboard', { params }),
};

export const budgetAPI = {
  listRuntimeBudgets: () =>
    api.get<{ budgets: RuntimeBudgetStatus[] }>('/stats/runtime-budgets'),

  updateRuntimeBudget: (platform: RuntimeBudgetPlatform, payload: UpdateRuntimeBudgetPayload) =>
    api.put<RuntimeBudgetStatus>(`/stats/runtime-budgets/${platform}`, payload),
};

export interface GuardPendingApproval {
  id: string;
  platform: string;
  instance_id: string;
  guard_mode: string;
  session_key: string;
  tool_name: string;
  params: Record<string, unknown>;
  guard_verdict: string;
  guard_raw: string;
  session_context: string;
  risk_source: string | null;
  failure_mode: string | null;
  real_world_harm: string | null;
  created_at: number;
  resolved: boolean;
  resolution: string;
  resolved_at: number;
  tool_category?: string | null;
  tool_action?: string | null;
  timeline_kind?: string | null;
  risk_level?: string | null;
}

export interface GuardRuntimeObservation {
  id: string;
  platform: string;
  instance_id: string;
  guard_mode: string;
  session_key: string;
  tool_name: string;
  params: Record<string, unknown>;
  action: string;
  reason: string | null;
  guard_verdict: string;
  guard_raw: string;
  session_context: string;
  created_at: number;
  tool_category?: string | null;
  tool_action?: string | null;
  timeline_kind?: string | null;
  risk_level?: string | null;
}

// Guard API
export const guardAPI = {
  pending: (resolved?: boolean) =>
    api.get<GuardPendingApproval[]>('/guard/pending', { params: resolved !== undefined ? { resolved } : {} }),

  resolve: (pendingId: string, resolution: string) =>
    api.post<GuardPendingApproval>(`/guard/pending/${pendingId}/resolve`, { resolution }),

  observations: () =>
    api.get<GuardRuntimeObservation[]>('/guard/observations'),

  status: () => api.get('/guard/status'),

  getEnabled: () => api.get<{ enabled: boolean }>('/guard/enabled'),
  setEnabled: (enabled: boolean) => api.post<{ enabled: boolean }>('/guard/enabled', { enabled }),
};

// System API (agent install / onboard / status)
export const systemAPI = {
  /** Check whether an agent framework is installed. */
  /**
   * Backend ``/system/status``.
   *
   * §53 — pass ``platform`` to override the global ``settings.is_hermes``
   * branch so callers like Configure.tsx (Hermes wizard refresh button on
   * an OpenClaw-default server) get the right platform's status shape.
   * Omit to keep legacy behaviour for callers that only read generic
   * fields like ``default_workspace`` (TownConsole's workspace probe,
   * ModelSetupModal's workspace prefill).
   */
  status: (platform?: 'openclaw' | 'hermes') =>
    api.get<SystemStatusResponse>(
      "/system/status",
      { timeout: 30000, ...(platform ? { params: { platform } } : {}) },
    ),

  /** Fast install/config probe used by setup and route guards. */
  installStatus: () => api.get<InstallStatusResponse>('/system/install-status', { timeout: 10000 }),

  /** Read Codex CLI ChatGPT login state. */
  getCodexAuthStatus: () =>
    api.get<CodexAuthStatusResponse>('/system/codex/auth/status', { timeout: 10000 }),

  /** Read Codex CLI runtime health from redacted CLI diagnostics. */
  getCodexRuntimeStatus: (refresh?: boolean) =>
    api.get<CodexRuntimeStatusResponse>(
      '/system/codex/runtime',
      { timeout: refresh ? 60000 : 35000, params: refresh ? { refresh: true } : undefined },
    ),

  /** Read Codex CLI ChatGPT rolling rate limits through app-server. */
  getCodexRateLimits: () =>
    api.get<CodexRateLimitsResponse>('/system/codex/rate-limits', { timeout: 15000 }),

  /** Read the current Codex CLI model catalog through app-server. */
  getCodexModels: () =>
    api.get<CodexModelCatalogResponse>('/system/codex/models', { timeout: 15000 }),

  /** Start the official Codex CLI login flow in the system browser. */
  loginCodexAuth: () =>
    api.post<CodexAuthStatusResponse>('/system/codex/auth/login', {}, { timeout: 0 }),

  /** Clear Codex CLI authentication and return the refreshed state. */
  logoutCodexAuth: () =>
    api.post<CodexAuthStatusResponse>('/system/codex/auth/logout', {}, { timeout: 60000 }),

  /** List local Codex CLI session summaries through app-server. */
  listCodexSessions: (params?: { limit?: number; cursor?: string }) =>
    api.get<CodexSessionListResponse>('/system/codex/sessions', { timeout: 15000, params }),

  /** List local OpenClaw/Hermes sessions directly from runtime history files. */
  listRuntimeSessions: (params: { platform: 'openclaw' | 'hermes'; instance_id?: string; limit?: number }) =>
    api.get<LocalRuntimeSessionListResponse>('/system/runtime-sessions', { timeout: 15000, params }),

  /** Delete one local OpenClaw/Hermes runtime history file. */
  deleteRuntimeSession: (
    platform: 'openclaw' | 'hermes',
    sourceSessionId: string,
    params?: { instance_id?: string },
  ) =>
    api.delete<LocalRuntimeSessionDeleteResponse>(
      `/system/runtime-sessions/${encodeURIComponent(platform)}/${encodeURIComponent(sourceSessionId)}`,
      { timeout: 15000, params },
    ),

  /** Archive and delete one local Codex history rollout managed by CLI or XSafeClaw. */
  deleteCodexSession: (threadId: string) =>
    api.delete<CodexSessionDeleteResponse>(`/system/codex/sessions/${encodeURIComponent(threadId)}`, { timeout: 15000 }),

  /** Read a Codex CLI thread transcript summary through app-server. */
  getCodexSessionMessages: (threadId: string) =>
    api.get<CodexSessionMessagesResponse>(`/system/codex/sessions/${encodeURIComponent(threadId)}/messages`, { timeout: 15000 }),

  /** Start a Codex app-server thread with XSafeClaw developer instructions. */
  startCodexConversation: (payload: CodexConversationOpenRequest) =>
    api.post<CodexConversationOpenResponse>('/system/codex/conversations/start', payload, { timeout: 20000 }),

  /** Resume a Codex app-server thread with XSafeClaw developer instructions. */
  resumeCodexConversation: (payload: CodexConversationResumeRequest) =>
    api.post<CodexConversationOpenResponse>('/system/codex/conversations/resume', payload, { timeout: 20000 }),

  /** Interrupt the active Codex app-server turn for a conversation. */
  interruptCodexConversation: (sessionKey: string, payload?: CodexConversationInterruptRequest) =>
    api.post<{ status: string; interrupted: boolean }>(
      `/system/codex/conversations/${encodeURIComponent(sessionKey)}/interrupt`,
      payload ?? {},
      { timeout: 10000 },
    ),

  /** Respond to an active Codex app-server user-input request. */
  respondCodexUserInputRequest: (
    sessionKey: string,
    requestId: string,
    payload: CodexRequestUserInputResponseRequest,
  ) =>
    api.post<{ status: string; request_id: string }>(
      `/system/codex/conversations/${encodeURIComponent(sessionKey)}/requests/${encodeURIComponent(requestId)}/respond`,
      payload,
      { timeout: 10000 },
    ),

  /** Clear an active Codex app-server goal for a conversation. */
  clearCodexGoal: (sessionKey: string, payload?: CodexConversationGoalClearRequest) =>
    api.post<CodexConversationGoalClearResponse>(
      `/system/codex/conversations/${encodeURIComponent(sessionKey)}/goal/clear`,
      payload ?? {},
      { timeout: 10000 },
    ),

  instances: () =>
    api.get<{ instances: RuntimeInstance[]; total: number }>('/system/instances'),

  getInstance: (instanceId: string) =>
    api.get<{ instance: RuntimeInstance }>(`/system/instances/${instanceId}`),

  getInstanceHealth: (instanceId: string) =>
    api.get<RuntimeInstanceHealth>(`/system/instances/${instanceId}/health`),

  getInstanceCapabilities: (instanceId: string) =>
    api.get<RuntimeInstanceCapabilitiesResponse>(`/system/instances/${instanceId}/capabilities`),

  getNanobotGuard: (instanceId: string) =>
    api.get<NanobotGuardConfigResponse>(`/system/instances/${instanceId}/nanobot-guard`),

  setNanobotGuard: (
    instanceId: string,
    payload: { mode: 'disabled' | 'observe' | 'blocking'; base_url?: string | null; timeout_s?: number | null }
  ) =>
    api.post<NanobotGuardConfigResponse>(`/system/instances/${instanceId}/nanobot-guard`, payload),

  /**
   * Force-enable the Hermes HTTP API server (API_SERVER_ENABLED=true in
   * ~/.hermes/.env) and restart the gateway. Used by the Configure status
   * page when /health never responds — typically because upstream Hermes
   * ships the flag as false and the gateway therefore boots without an
   * HTTP listener.
   */
  hermesEnableApiServer: () =>
    api.post<{
      success: boolean;
      env_changes: string[];
      hermes_api_server_enabled: boolean;
      restart_attempted: boolean;
      restart_succeeded: boolean;
      restart_detail: string;
      api_reachable: boolean;
      hermes_api_port: number;
    }>("/system/hermes-enable-api-server"),

  /** SSE URL for npm install stream (use with fetch). */
  installUrl: () => '/api/system/install',

  /** SSE URL for nanobot install stream (use with fetch). */
  nanobotInstallUrl: () => '/api/system/nanobot/install',

  /** SSE URL for official Codex CLI install stream (use with fetch). */
  codexInstallUrl: () => '/api/system/codex/install',

  /** Create a skeleton nanobot config/workspace for compatibility flows. */
  nanobotInitDefault: () =>
    api.post<{
      success: boolean;
      created: boolean;
      model_configured?: boolean;
      config_path: string;
      workspace_path: string;
      guard?: Record<string, any>;
      install_command?: string;
      output?: string;
      instances?: RuntimeInstance[];
    }>('/system/nanobot/init-default'),

  /** Read default nanobot config with secrets redacted. */
  getNanobotConfig: () =>
    api.get<NanobotConfigResponse>('/system/nanobot/config'),

  /** Read the normalized Nanobot model catalog used by the configure wizard. */
  getNanobotModelCatalog: (refresh?: boolean) =>
    api.get<NanobotModelCatalogResponse>('/system/nanobot/model-catalog', refresh ? { params: { refresh } } : undefined),

  /** Create/update the default nanobot config used by XSafeClaw. */
  setNanobotConfig: (payload: NanobotConfigPayload) =>
    api.post<NanobotConfigResponse>('/system/nanobot/config', payload),

  /** SSE URL for pip install hermes stream (use with fetch). */
  installHermesUrl: () => '/api/system/install-hermes',

  /** Start onboard process, returns proc_id. */
  onboardStart: () =>
    api.post<{ proc_id: string }>('/system/onboard/start'),

  /** SSE URL for onboard stream (use with fetch). */
  onboardStreamUrl: (procId: string) => `/api/system/onboard/${procId}/stream`,

  /**
   * Send input to onboard process.
   * Special values: "YES" "NO" "ENTER" "DOWN:N" "UP:N"
   */
  onboardInput: (procId: string, text: string) =>
    api.post(`/system/onboard/${procId}/input`, { text }),

  /** Get onboard form defaults and provider/model list (legacy). */
  onboardDefaults: () =>
    api.get('/system/onboard-defaults'),

  /**
   * Scan local environment for providers, channels, skills, hooks.
   *
   * §52 — pass ``platform`` to override the backend's global
   * ``settings.is_hermes`` branch and force a specific platform's data
   * source. Used by Configure.tsx so ``/openclaw_configure`` always
   * gets OpenClaw scan data even on a Hermes-default server, and
   * ``/hermes_configure`` always gets Hermes catalog regardless of
   * which platform the user originally booted into.
   */
  onboardScan: (platform?: 'openclaw' | 'hermes') =>
    api.get('/system/onboard-scan', platform ? { params: { platform } } : undefined),

  /** Reset config/creds/sessions based on scope. */
  configReset: (scope: string, workspace?: string) =>
    api.post('/system/config-reset', { scope, workspace }),

  /** Submit onboard config form. */
  onboardConfig: (data: {
    platform?: 'openclaw' | 'hermes';
    mode?: string;
    provider?: string;
    api_key?: string;
    model_id?: string;
    gateway_port?: number;
    gateway_bind?: string;
    gateway_auth_mode?: string;
    gateway_token?: string;
    channels?: string[];
    hooks?: string[];
    workspace?: string;
    install_daemon?: boolean;
    tailscale_mode?: string;
    search_provider?: string;
    search_api_key?: string;
    remote_url?: string;
    remote_token?: string;
    selected_skills?: string[];
    feishu_app_id?: string;
    feishu_app_secret?: string;
    feishu_connection_mode?: string;
    feishu_domain?: string;
    feishu_group_policy?: string;
    feishu_group_allow_from?: string[];
    feishu_verification_token?: string;
    feishu_webhook_path?: string;
    cf_account_id?: string;
    cf_gateway_id?: string;
    litellm_base_url?: string;
    vllm_base_url?: string;
    vllm_model_id?: string;
    custom_base_url?: string;
    custom_model_id?: string;
    custom_provider_id?: string;
    custom_compatibility?: string;
    custom_context_window?: number;
  }) => api.post('/system/onboard-config', data),

  /** Test Feishu credentials. */
  feishuTest: (appId: string, appSecret: string, domain: string) =>
    api.post<{ ok: boolean; bot_name?: string; bot_open_id?: string; error?: string }>(
      '/system/feishu-test',
      { app_id: appId, app_secret: appSecret, domain },
    ),

  quickModelConfig: (data: {
    provider: string;
    api_key?: string;
    model_id: string;
    /**
     * Hermes-only per-provider base URL override.  Currently consumed only
     * by the ``alibaba`` provider (§33): the wizard/modal ships one of the
     * DashScope endpoint presets so the adapter's hardcoded
     * ``coding-intl.dashscope.aliyuncs.com`` default doesn't 401 standard
     * DashScope keys.  Blank means "don't touch DASHSCOPE_BASE_URL in
     * ~/.hermes/.env"; non-alibaba providers ignore this field.
     */
    base_url?: string;
    /**
     * Hermes-only: when true (default on the server), the backend restarts the
     * Hermes API server after writing ~/.hermes/.env + config.yaml and polls
     * /v1/models to confirm `model_id` is visible. Set false to batch edits
     * and invoke `hermesApply` explicitly.
     */
    auto_apply?: boolean;
    /**
     * Target runtime to write the model config into. The backend resolves
     * ``target_platform = body.platform or (settings.is_hermes ? 'hermes'
     * : 'openclaw')`` (see ``api/routes/system.py::quick_model_config``),
     * so omitting this on a Hermes-default server silently misroutes
     * OpenClaw configures into ``~/.hermes/config.yaml`` and leaves
     * ``~/.openclaw/openclaw.json`` stale — caller MUST pin this whenever
     * the target runtime is unambiguous (URL-pinned wizard, runtime-pinned
     * modal, etc.).
     */
    platform?: 'openclaw' | 'hermes';
  }) =>
    api.post<{
      success: boolean;
      fast_path: boolean;
      /** Hermes only: whether /v1/models lists `model_id` after restart. */
      model_ready?: boolean;
      /** Hermes only: whether the API server was restarted successfully. */
      applied?: boolean;
      /** Hermes only: whether /health currently responds. */
      api_reachable?: boolean;
      output?: string;
    }>('/system/quick-model-config', data),

  /**
   * Hermes only — restart the Hermes API server so it picks up ~/.hermes/.env
   * and config.yaml changes, and verify readiness. Used as a standalone
   * "Apply to Hermes" action when the frontend wants to batch config edits.
   */
  hermesApply: (modelId?: string) =>
    api.post<{
      success: boolean;
      restart_ok: boolean;
      api_was_running: boolean;
      api_reachable: boolean;
      model_id: string | null;
      model_ready: boolean;
      visible_model: string | null;
      output: string;
    }>('/system/hermes/apply', modelId ? { model_id: modelId } : {}),

  // §46 — `removeConfiguredModel` 已移除（与 OpenClaw 对齐）。
  // 历史端点 POST /system/hermes/configured-models/delete 已下线；
  // 前端不再提供删除已配置模型的入口。

  /**
   * Backend ``/system/provider-has-key``.
   *
   * §53 — pass ``platform`` so the per-runtime CMD UI
   * (ModelSetupModal) can ask the right auth store on a multi-platform
   * server. Omitting falls back to the legacy ``settings.is_hermes``
   * branch — no behavioural change for current callers.
   */
  providerHasKey: (provider: string, platform?: 'openclaw' | 'hermes') => {
    const qs = new URLSearchParams({ provider });
    if (platform) qs.set('platform', platform);
    return api.get<{ has_key: boolean }>(
      `/system/provider-has-key?${qs.toString()}`,
    );
  },

  hermesApiKeyStatus: () =>
    api.get<{
      configured: boolean;
      hermes_side_configured?: boolean;
      in_sync?: boolean;
    }>('/system/hermes-api-key-status'),

  saveHermesApiKey: (apiKey: string) =>
    api.post<{
      success: boolean;
      configured: boolean;
      hermes_env_path?: string;
      requires_hermes_restart?: boolean;
    }>('/system/hermes-api-key', { api_key: apiKey }),

  generateHermesApiKey: () =>
    api.post<{
      success: boolean;
      configured: boolean;
      api_key: string;
      hermes_env_path?: string;
      requires_hermes_restart?: boolean;
    }>('/system/hermes-api-key/generate'),

  revealHermesApiKey: () =>
    api.get<{ api_key: string; source: 'xsafeclaw' | 'hermes' | 'none' }>(
      '/system/hermes-api-key/reveal',
    ),

  /**
   * Hermes only — fetch the schema for every supported messaging platform
   * (Telegram / Discord / Slack / Feishu / DingTalk / WeCom …). The frontend
   * renders each platform's fields generically from this response.
   */
  hermesBotPlatforms: () =>
    api.get<{
      platforms: Array<{
        id: string;
        name: string;
        hint: string;
        docUrl: string;
        configured: boolean;
        fields: Array<{
          key: string;
          label: string;
          required: boolean;
          secret: boolean;
          placeholder?: string;
          configured: boolean;
        }>;
      }>;
      env_path: string;
      any_configured: boolean;
    }>('/system/hermes-bot-platforms'),

  /**
   * Hermes only — persist one messaging-platform's credentials into
   * ``~/.hermes/.env``. When ``auto_apply`` is true (default on the server),
   * the Hermes API server is restarted so the gateway picks up the new keys
   * without the user touching a shell.
   */
  hermesBotConfig: (data: {
    platform: string;
    fields: Record<string, string>;
    auto_apply?: boolean;
  }) =>
    api.post<{
      success: boolean;
      platform: string;
      written_keys: string[];
      applied: boolean;
      api_was_running: boolean;
      api_reachable: boolean;
      output: string;
    }>('/system/hermes-bot-config', data),

  // §38 framework picker (runtimePlatformStatus / pickRuntimePlatform) was
  // removed in §42 — XSafeClaw now monitors all three runtimes
  // simultaneously and the user picks per-session in Agent Town.
};

export const skillsAPI = {
  list: (instanceId?: string) =>
    api.get<{ skills: any[]; error?: string; unavailable?: boolean; reason?: string }>('/skills/list', {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  check: (instanceId?: string) =>
    api.get<{ checks: any[] }>('/skills/check', {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  update: (
    skillKey: string,
    data: { enabled?: boolean; api_key?: string; env?: Record<string, string> },
    instanceId?: string,
  ) =>
    api.post(`/skills/${skillKey}/update`, data, {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  content: (skillKey: string, instanceId?: string) =>
    api.get<{ key: string; content: string; path: string; sizeBytes: number; modifiedAt: number }>(`/skills/${skillKey}/content`, {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  scanAll: (keys?: string[], force?: boolean, instanceId?: string) =>
    api.post<{ results: any[] }>('/skills/scan-all', { keys, force }, {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  scanOne: (skillKey: string, force?: boolean, instanceId?: string) =>
    api.post<any>(`/skills/${skillKey}/scan`, { force }, {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  scanStatus: (instanceId?: string) =>
    api.get<Record<string, any>>('/skills/scan-status', {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
};

export const memoryAPI = {
  list: (instanceId?: string) =>
    api.get<{ files: any[]; unavailable?: boolean; reason?: string }>('/memory/list', {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  content: (fileKey: string, instanceId?: string) =>
    api.get<{ key: string; content: string; sizeBytes: number; modifiedAt: number }>(`/memory/content/${fileKey}`, {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  scanAll: (keys?: string[], force?: boolean, instanceId?: string) =>
    api.post<{ results: any[] }>('/memory/scan-all', { keys, force }, {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  scanOne: (fileKey: string, force?: boolean, instanceId?: string) =>
    api.post<any>(`/memory/${fileKey}/scan`, { force }, {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
  scanStatus: (instanceId?: string) =>
    api.get<Record<string, any>>('/memory/scan-status', {
      params: instanceId ? { instance_id: instanceId } : undefined,
    }),
};

export default api;
