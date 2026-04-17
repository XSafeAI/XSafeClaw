// API Response Types
export interface Session {
  session_id: string;
  agent_id: string;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  tool_call_count: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  message_id: string;
  session_id: string;
  role: string;
  timestamp: string;
  content_text: string | null;
  content_json: any;
  event_id: string | null;
  created_at: string;
}

export interface ToolCall {
  id: string;
  session_id: string;
  message_id: string;
  tool_name: string;
  input_text: string | null;
  input_json: any;
  output_text: string | null;
  output_json: any;
  timestamp: string;
  created_at: string;
}

export interface Event {
  id: string;
  session_id: string;
  started_at: string;
  completed_at: string | null;
  message_count: number;
  tool_call_count: number;
  tool_call_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface EventWithMessages {
  event: Event;
  messages: Array<{
    message_id: string;
    role: string;
    timestamp: string;
    content_text: string | null;
    tool_calls_count: number;
    tool_call_ids: string[];
  }>;
}

export interface AssetRiskAssessment {
  level: string;
  color: string;
  label: string;
  recommendation: string;
  safety: string;
  path: string;
  risk_level: number;
  is_file: boolean;
  is_directory: boolean;
}

export interface HardwareInfo {
  status: string;
  hardware_info: {
    cpu_info: any;
    memory_info: any;
    disk_info: any[];
    system_info: any;
    network_info: any[];
    gpu_info?: any;
  };
  message: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface Statistics {
  total_sessions: number;
  total_messages: number;
  total_tool_calls: number;
  active_sessions: number;
}
