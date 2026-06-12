import { expect, test } from 'vitest';

import {
  getToolDisclosureSummary,
  formatConversationTime,
  isNearScrollBottom,
  normalizeRuntimeTimestamp,
  shouldAutoScrollConversation,
} from '../src/features/world/agent_town/components/conversationPanelUtils.js';

test('detects when the conversation log is pinned near the bottom', () => {
  expect(isNearScrollBottom({ scrollHeight: 1000, scrollTop: 535, clientHeight: 420 })).toBe(true);
  expect(isNearScrollBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 420 })).toBe(false);
});

test('does not auto-scroll polling updates after the user scrolls away from the bottom', () => {
  expect(shouldAutoScrollConversation({ agentChanged: false, wasPinnedToBottom: false })).toBe(false);
  expect(shouldAutoScrollConversation({ agentChanged: false, wasPinnedToBottom: true })).toBe(true);
  expect(shouldAutoScrollConversation({ agentChanged: true, wasPinnedToBottom: false })).toBe(true);
});

test('builds a compact tool-call disclosure summary', () => {
  const summary = getToolDisclosureSummary({
    tool_name: 'read',
    args: { path: '/tmp/example.md' },
    result: '# ok',
    result_pending: false,
    is_error: false,
  });

  expect(summary).toEqual({
    label: 'TOOL',
    title: '已调用 read',
    detailHint: '点击展开',
    toolName: 'read',
    hasDetails: true,
    tone: 'tool',
  });
});

test('treats timezone-less runtime ISO timestamps as UTC', () => {
  const timestamp = '2026-06-10T09:44:34';

  expect(
    normalizeRuntimeTimestamp(timestamp).toISOString(),
  ).toBe('2026-06-10T09:44:34.000Z');
  expect(
    formatConversationTime(timestamp, 'en-US', { timeZone: 'Asia/Shanghai' }),
  ).toBe('17:44:34');
  expect(
    formatConversationTime('2026-06-10T09:44:34+00:00', 'en-US', { timeZone: 'Asia/Shanghai' }),
  ).toBe('17:44:34');
});
