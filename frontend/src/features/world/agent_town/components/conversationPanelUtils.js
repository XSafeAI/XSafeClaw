const DEFAULT_SCROLL_BOTTOM_THRESHOLD = 48;

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
