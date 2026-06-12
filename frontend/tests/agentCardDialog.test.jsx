import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import AgentCard from '../src/features/world/agent_town/components/AgentCard.jsx';

describe('AgentCard conversation dialog', () => {
  test('renders assistant markdown instead of showing raw markdown markers', async () => {
    const data = {
      agent: {
        id: 'hermes-default',
        session_key: '',
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        first_seen_at: '2026-06-10T09:44:34',
        status: 'working',
      },
      charName: 'avatar01',
      state: 'working',
      totalTokens: 0,
      event: {
        id: 'event-1',
        status: 'completed',
        start_time: '2026-06-10T09:44:34',
        conversations: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content_text: '现在是 **2026年6月10日（星期三）17:44**（北京时间，UTC+8）。',
            timestamp: '2026-06-10T09:44:34',
          },
        ],
      },
      events: [],
    };

    const { container } = render(
      <AgentCard
        data={data}
        onClose={() => {}}
        onJourney={() => {}}
        onDeleteAgent={() => {}}
      />,
    );

    await screen.findByText(/现在是/);
    const dialogText = container.querySelector('.agent-dialog-text');

    expect(dialogText).not.toHaveTextContent('**');
    expect(dialogText.querySelector('strong')).toHaveTextContent('2026年6月10日（星期三）17:44');
  });
});
