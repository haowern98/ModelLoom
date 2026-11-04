import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
import { createDemoChat, type ChatMessage } from '../../mocks/chat';

function props(messages: readonly ChatMessage[]) {
  const base = createDemoChat(false);
  return {
    demo: false,
    chat: { ...base, conversations: [{ ...base.conversations[0]!, messages }] },
    dispatch: vi.fn(),
    activeModel: undefined,
    onCluster: vi.fn(),
    live: { ready: true, busy: false, notice: '', send: vi.fn(), stop: vi.fn(), retry: vi.fn() },
  };
}
const answer = (text: string): ChatMessage => ({
  id: 'answer',
  role: 'assistant',
  text,
  state: 'completed',
});

it('renders structured answers and expanded thinking while leaving user text literal', async () => {
  const text = [
    '### Why it works',
    '',
    '**Bold** and *emphasis* with ~~removed~~ and ' +
      String.fromCharCode(96) +
      'inline' +
      String.fromCharCode(96) +
      '.',
    '',
    '- First',
    '  - Nested',
    '- Second',
    '',
    '> A quotation',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| Model | Ready |',
    '',
    '- [x] Done',
  ].join('\n');
  const { container } = render(
    <ChatPage
      {...props([
        { id: 'user', role: 'user', text: '**literal user text**' },
        { ...answer(text), reasoning: '## Working notes\n\n**Reasoning**', thinkingMs: 12000 },
      ])}
    />,
  );
  const response = screen.getByRole('article', { name: 'Assistant response 2' });
  expect(within(response).getByRole('heading', { name: 'Why it works', level: 3 })).toBeVisible();
  expect(response.querySelector('strong')).toHaveTextContent('Reasoning');
  expect(response.querySelector('em')).toHaveTextContent('emphasis');
  expect(response.querySelector('del')).toHaveTextContent('removed');
  expect(response.querySelector('code')).toHaveTextContent('inline');
  expect(within(response).getByText('Nested').closest('ul')?.parentElement?.tagName).toBe('LI');
  expect(response.querySelector('blockquote')).toHaveTextContent('A quotation');
  expect(within(response).getByRole('table')).toHaveTextContent('ModelReady');
  expect(within(response).getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('article', { name: 'Your message 1' })).toHaveTextContent(
    '**literal user text**',
  );
  const summary = within(response).getByText('Thought for 12s');
  expect(summary.closest('summary')?.querySelectorAll('svg')).toHaveLength(1);
  await userEvent.setup().click(summary);
  expect(within(response).getByRole('heading', { name: 'Working notes' })).toBeVisible();
  expect(container.querySelector('script')).toBeNull();
});

it('keeps hostile HTML, images and unsafe link protocols inert', () => {
  const text = [
    '<script>alert(1)</script>',
    '',
    '<img src="https://tracker.invalid/pixel" onerror="alert(1)">',
    '',
    '![Remote image](https://tracker.invalid/markdown)',
    '',
    '[Unsafe](javascript:alert%281%29)',
    '',
    '[File](file:///C:/secret)',
    '',
    '[Data](data:text/html,bad)',
    '',
    '[Relative](/settings)',
    '',
    '[Safe](https://example.com/docs)',
    '',
    '[Encoded](jav&#x61;script:alert%281%29)',
  ].join('\n');
  const { container } = render(<ChatPage {...props([answer(text)])} />);
  expect(container.querySelector('script, iframe, img, object, embed')).toBeNull();
  expect([...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))).toEqual([
    'https://example.com/docs',
  ]);
  expect(screen.getByRole('link', { name: 'Safe' })).toHaveAttribute('rel', 'noopener noreferrer');
});

it('updates partial code fences and copies code separately from the unchanged raw response action', async () => {
  const user = userEvent.setup();
  const fence = String.fromCharCode(96).repeat(3);
  const partial = fence + 'javascript\nconst value = 1;';
  const view = render(<ChatPage {...props([{ ...answer(partial), state: 'running' }])} />);
  const code = view.container.querySelector('pre code')!;
  expect(code).toHaveTextContent('const value = 1;');
  expect(code.querySelector('.hljs-keyword')).not.toBeNull();
  const finished = partial + '\nconsole.log(value);\n' + fence + '\n\n**Finished**';
  view.rerender(<ChatPage {...props([answer(finished)])} />);
  expect(view.container.querySelectorAll('pre')).toHaveLength(1);
  expect(screen.getByText('Finished').tagName).toBe('STRONG');
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await user.click(screen.getByRole('button', { name: 'Copy code' }));
  expect(clipboard).toHaveBeenLastCalledWith('const value = 1;\nconsole.log(value);');
  await user.click(screen.getByRole('button', { name: 'Copy response 1' }));
  expect(clipboard).toHaveBeenLastCalledWith(finished);
});

it.each([
  ['completed', null],
  ['cancelled', 'Stopped'],
  ['failed', 'Response failed'],
  ['interrupted', 'Interrupted'],
  ['limit-reached', 'Output limit reached'],
  ['queued', 'Waiting…'],
  ['running', 'Generating…'],
  ['cancelling', 'Stopping…'],
])('keeps the %s status contract and response controls', (state, label) => {
  render(
    <ChatPage
      {...props([
        {
          ...answer('**Answer**'),
          state: state,
          attemptId: 'attempt',
          speeds: { generation: 16.1, prefill: 400, acceptance: 0.367 },
        },
      ])}
    />,
  );
  const response = screen.getByRole('article', { name: 'Assistant response 1' });
  if (label) expect(within(response).getByRole('status')).toHaveTextContent(label);
  else expect(within(response).queryByRole('status')).toBeNull();
  expect(within(response).getByRole('button', { name: 'Copy response 1' })).toBeVisible();
  if (!['queued', 'running', 'cancelling'].includes(state))
    expect(within(response).getByRole('button', { name: 'Retry response 1' })).toBeVisible();
  expect(within(response).getByText('Generation: 16.1 tok/s')).toBeVisible();
  expect(within(response).getByText('Prompt processing: 400 tok/s')).toBeVisible();
  expect(within(response).getByText('Acceptance rate: 36.7%')).toBeVisible();
});
