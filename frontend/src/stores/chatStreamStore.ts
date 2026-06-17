/**
 * Module-level persistent store for chat streaming state.
 *
 * This store lives outside React's component lifecycle so that active SSE
 * streams continue processing even when the Chat component is unmounted
 * (e.g. user navigates to another page and comes back).
 *
 * The Chat component subscribes on mount and unsubscribes on unmount.
 * Updates are buffered in the store and applied when the component re-mounts.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error' | 'tool_call' | 'trace' | 'codex_question' | 'codex_plan' | 'codex_goal';
  content: string;
  timestamp: Date;
  pending?: boolean;
  images?: { dataUrl: string }[];
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
  codex_request_id?: string;
  codex_thread_id?: string;
  codex_turn_id?: string;
  codex_item_id?: string;
  codex_questions?: CodexUserInputQuestion[];
  codex_response_status?: 'pending' | 'submitting' | 'submitted' | 'resolved' | 'error';
  codex_answer_values?: Record<string, string[]>;
  codex_error?: string;
  codex_question?: string;
  codex_options?: string[];
  codex_allow_other?: boolean;
  codex_secret?: boolean;
  codex_submitted_answer?: string;
  codex_plan_explanation?: string | null;
  codex_plan_steps?: CodexPlanStep[];
  codex_plan_text?: string;
  codex_goal?: CodexGoalState | null;
}

export interface CodexUserInputOption {
  label: string;
  description: string;
}

export interface CodexUserInputQuestion {
  id: string;
  header: string;
  question: string;
  is_other: boolean;
  is_secret: boolean;
  options: CodexUserInputOption[];
}

export interface CodexPlanStep {
  step: string;
  status?: string | null;
}

export interface CodexGoalState {
  thread_id?: string | null;
  objective?: string | null;
  status?: string | null;
  token_budget?: number | null;
  tokens_used?: number | null;
  time_used_seconds?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

type Listener = () => void;

class ChatStreamStore {
  private _messageMap: Record<string, ChatMessage[]> = {};
  private _sending: Record<string, boolean> = {};
  private _listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  private _notify() {
    this._listeners.forEach(fn => fn());
  }

  getSnapshot(): Record<string, ChatMessage[]> {
    return this._messageMap;
  }

  getSendingSnapshot(): Record<string, boolean> {
    return this._sending;
  }

  getMessages(sessionKey: string): ChatMessage[] {
    return this._messageMap[sessionKey] ?? [];
  }

  setMessages(sessionKey: string, messages: ChatMessage[]) {
    this._messageMap = { ...this._messageMap, [sessionKey]: messages };
    this._notify();
  }

  deleteMessages(sessionKey: string) {
    const next = { ...this._messageMap };
    delete next[sessionKey];
    this._messageMap = next;
    this._notify();
  }

  /**
   * Batch-apply a full map replacement. Only triggers one notification.
   */
  replaceAll(newMap: Record<string, ChatMessage[]>) {
    this._messageMap = newMap;
    this._notify();
  }

  renameSession(oldKey: string, newKey: string) {
    if (oldKey === newKey) return;
    const nextMap = { ...this._messageMap };
    nextMap[newKey] = nextMap[oldKey] ?? [];
    delete nextMap[oldKey];
    this._messageMap = nextMap;

    const nextSending = { ...this._sending };
    if (nextSending[oldKey]) {
      nextSending[newKey] = true;
      delete nextSending[oldKey];
    }
    this._sending = nextSending;
    this._notify();
  }

  isSending(sessionKey: string): boolean {
    return this._sending[sessionKey] ?? false;
  }

  isAnySending(): boolean {
    return Object.values(this._sending).some(v => v);
  }

  setSending(sessionKey: string, value: boolean) {
    const next = { ...this._sending };
    if (value) {
      next[sessionKey] = true;
    } else {
      delete next[sessionKey];
    }
    this._sending = next;
    this._notify();
  }

  hasLoadedMessages(sessionKey: string): boolean {
    return sessionKey in this._messageMap;
  }
}

export const chatStreamStore = new ChatStreamStore();
