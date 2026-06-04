import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getToolDisclosureSummary,
  isNearScrollBottom,
  shouldAutoScrollConversation,
} from '../src/features/world/agent_town/components/conversationPanelUtils.js';

test('detects when the conversation log is pinned near the bottom', () => {
  assert.equal(isNearScrollBottom({ scrollHeight: 1000, scrollTop: 535, clientHeight: 420 }), true);
  assert.equal(isNearScrollBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 420 }), false);
});

test('does not auto-scroll polling updates after the user scrolls away from the bottom', () => {
  assert.equal(shouldAutoScrollConversation({ agentChanged: false, wasPinnedToBottom: false }), false);
  assert.equal(shouldAutoScrollConversation({ agentChanged: false, wasPinnedToBottom: true }), true);
  assert.equal(shouldAutoScrollConversation({ agentChanged: true, wasPinnedToBottom: false }), true);
});

test('builds a compact tool-call disclosure summary', () => {
  const summary = getToolDisclosureSummary({
    tool_name: 'read',
    args: { path: '/tmp/example.md' },
    result: '# ok',
    result_pending: false,
    is_error: false,
  });

  assert.deepEqual(summary, {
    label: 'TOOL',
    title: '已调用 read',
    detailHint: '点击展开',
    toolName: 'read',
    hasDetails: true,
    tone: 'tool',
  });
});
