import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Model configuration demo', () => {
  it('retains pending text across navigation and keeps defaults independent between models', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Configure Qwen3.8-27B' }));
    await user.type(
      screen.getByRole('textbox', { name: 'System Prompt' }),
      '<script>example</script>',
    );
    await user.click(screen.getByRole('button', { name: 'Set in Cluster' }));
    expect(screen.getByRole('button', { name: 'Unload model' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Configure Llama 3.1 8B' }));
    expect(screen.getByRole('textbox', { name: 'System Prompt' })).toHaveValue('');
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(breadcrumb.querySelector('[aria-current="page"]')).toHaveTextContent('Llama 3.1 8B');
    const models = within(breadcrumb).getByRole('button', { name: 'Back to Models' });
    expect(models).toHaveTextContent('Models');
    await user.click(models);
    await user.click(screen.getByRole('button', { name: 'Configure Qwen3.8-27B' }));
    expect(screen.getByRole('textbox', { name: 'System Prompt' })).toHaveValue(
      '<script>example</script>',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(document.querySelector('script:not([src])')).toBeNull();
  });

  it('rejects invalid enabled values and batch combinations, then resets only pending defaults', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Configure Qwen3.8-27B' }));
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
    await user.clear(temperature);
    await user.type(temperature, '0.6');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await user.clear(temperature);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(temperature).toHaveAttribute('aria-invalid', 'true');
    expect(temperature).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Check the highlighted settings');
    const actions = screen.getByRole('group', { name: 'Model configuration actions' });
    expect(within(actions).queryByRole('alert')).not.toBeInTheDocument();
    expect(temperature).toHaveAccessibleDescription('Temperature: enter a number from 0 to 2.');
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(temperature).toHaveAttribute('aria-invalid', 'true');
    expect(temperature).toHaveAccessibleDescription('Temperature: enter a number from 0 to 2.');
    await user.type(temperature, '0.6');
    const physical = screen.getByRole('spinbutton', { name: 'Physical Batch Size' });
    await user.clear(physical);
    await user.type(physical, '4096');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      screen.getByText('Physical Batch Size must not exceed Evaluation Batch Size.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reset defaults' }));
    expect(temperature).toHaveValue(0.8);
    expect(physical).toHaveValue(512);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      screen.queryByRole('group', { name: 'Model configuration actions' }),
    ).not.toBeInTheDocument();
  });

  it('preserves disabled manual values and synchronizes numeric controls with sliders', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Configure Qwen3.8-27B' }));
    const context = screen.getByRole('spinbutton', { name: 'Context Length' });
    await user.clear(context);
    await user.type(context, '4096');
    expect(context).toHaveValue(4096);
    const topP = screen.getByRole('spinbutton', { name: 'Top P Sampling' });
    await user.clear(topP);
    await user.type(topP, '0.7');
    expect(screen.getByRole('slider', { name: 'Top P Sampling slider' })).toHaveValue('0.7');
    await user.click(screen.getByRole('checkbox', { name: 'Enable Top P Sampling' }));
    expect(topP).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Top P Sampling slider' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Enable Top P Sampling' }));
    expect(topP).toHaveValue(0.7);
    await user.click(screen.getByRole('switch', { name: 'Enable Thinking' }));
    expect(screen.getByRole('spinbutton', { name: 'Reasoning Budget' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Reasoning Budget Message' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Method' })).toBeEnabled();
    expect(screen.queryByRole('combobox', { name: /draft model/i })).not.toBeInTheDocument();
  });

  it('adds exact stop strings and stores template text without exposing argument overrides', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Configure Qwen3.8-27B' }));
    await user.type(screen.getByRole('textbox', { name: 'Stop Strings' }), ' END {Enter}');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Remove stop string.*END/ })).toBeVisible();
    expect(screen.getByText(' END ', { normalizer: (text) => text })).toBeVisible();
    await user.click(screen.getByText('Chat Template', { exact: true }));
    await user.type(
      screen.getByRole('textbox', { name: 'Chat Template text' }),
      '<script>template</script>',
    );
    expect(
      screen.queryByRole('switch', { name: 'llama.cpp Arguments Override' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Arguments' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Defaults saved');
    await user.click(screen.getByRole('button', { name: 'Back to Models' }));
    await user.click(screen.getByRole('button', { name: 'Configure Qwen3.8-27B' }));
    expect(screen.queryByRole('textbox', { name: 'Arguments' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Chat Template text' })).toHaveValue(
      '<script>template</script>',
    );
    await user.click(screen.getByRole('button', { name: /Remove stop string.*END/ }));
    expect(screen.queryByRole('button', { name: /Remove stop string/ })).not.toBeInTheDocument();
  });
  it('opens and closes the template without dirtying defaults and keeps cleared text open', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Configure Qwen3.8-27B' }));
    expect(screen.getByRole('combobox', { name: 'Context Overflow' })).toHaveValue('stop');
    await user.click(screen.getByText('Chat Template', { exact: true }));
    expect(
      screen.queryByRole('group', { name: 'Model configuration actions' }),
    ).not.toBeInTheDocument();
    const editor = screen.getByRole('textbox', { name: 'Chat Template text' });
    await user.type(editor, 'custom');
    await user.click(screen.getByText('Chat Template', { exact: true }));
    expect(screen.getByRole('group', { name: 'Model configuration actions' })).toBeVisible();
    expect(screen.getAllByText('Qwen3.8-27B', { exact: true })).toHaveLength(1);
    expect(screen.queryByText('GGUF', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await user.click(screen.getByText('Chat Template', { exact: true }));
    expect(editor).toHaveValue('custom');
    await user.clear(editor);
    expect(editor).toBeVisible();
    expect(screen.getByText('Model default', { exact: true })).toBeVisible();
    expect(
      screen.queryByRole('group', { name: 'Model configuration actions' }),
    ).not.toBeInTheDocument();
  });
});
