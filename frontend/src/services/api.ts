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

// Sessions API
export const sessionsAPI = {
  list: (params?: { page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<Session>>('/sessions/', { params }),
  
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

  getHistory: (sessionKey: string, limit = 100) =>
    api.get<{ session_key: string; messages: any[] }>('/chat/history', {
      params: { session_key: sessionKey, limit },
    }),

  closeSession: (sessionKey: string) =>
    api.post('/chat/close-session', null, { params: { session_key: sessionKey } }),
};

// Statistics API
export const statsAPI = {
  overview: () =>
    api.get<Statistics>('/stats/overview'),
  
  toolUsage: () =>
    api.get('/stats/tool-usage'),
};

// System API (openclaw install / onboard / status)
export const systemAPI = {
  /** Check whether openclaw CLI is installed. */
  status: () =>
    api.get<{
      openclaw_installed: boolean;
      openclaw_version: string | null;
      daemon_running: boolean;
      openclaw_path: string | null;
    }>('/system/status'),

  /** SSE URL for npm install stream (use with fetch). */
  installUrl: () => '/api/system/install',

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
};

export default api;
