const DEFAULT_SCROLL_BOTTOM_THRESHOLD = 48;
const ISO_DATETIME_WITHOUT_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

function hasToolDetailValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function isNearScrollBottom(element, threshold = DEFAULT_SCROLL_BOTTOM_THRESHOLD) {
  if (!element) return true;
  const scrollHeight = Number(element.scrollHeight || 0);
  const scrollTop = Number(element.scrollTop || 0);
  const clientHeight = Number(element.clientHeight || 0);
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function shouldAutoScrollConversation({ agentChanged = false, wasPinnedToBottom = false } = {}) {
  return Boolean(agentChanged || wasPinnedToBottom);
}

export function normalizeRuntimeTimestamp(value, fallback = new Date()) {
  const fallbackDate = fallback === null
    ? null
    : fallback instanceof Date
      ? fallback
      : new Date(fallback);

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallbackDate : value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallbackDate : date;
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return fallbackDate;
    const normalized = ISO_DATETIME_WITHOUT_TZ_RE.test(text) ? `${text}Z` : text;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? fallbackDate : date;
  }

  return fallbackDate;
}

export function formatConversationTime(value, locale = 'en-US', options = {}) {
  if (!value) return '';
  const date = normalizeRuntimeTimestamp(value, null);
  if (!date) return '';
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options,
  });
}

export function getToolDisclosureSummary(msg = {}) {
  const toolName = String(msg.tool_name || 'tool').trim() || 'tool';
  const running = Boolean(msg.result_pending);
  const failed = Boolean(msg.is_error);
  const label = running ? 'RUNNING' : failed ? 'ERROR' : 'TOOL';
  const tone = running ? 'running' : failed ? 'error' : 'tool';
  const title = running
    ? `正在调用 ${toolName}`
    : failed
      ? `工具失败 ${toolName}`
      : `已调用 ${toolName}`;

  return {
    label,
    title,
    detailHint: '点击展开',
    toolName,
    hasDetails: (
      running
      || hasToolDetailValue(msg.args)
      || hasToolDetailValue(msg.content)
      || hasToolDetailValue(msg.result)
    ),
    tone,
  };
}
