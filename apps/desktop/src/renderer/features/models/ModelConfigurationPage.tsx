import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowLeft, CircleHelp, RotateCcw, X } from 'lucide-react';
import { Button } from '../../components/Button';
import type { DemoModel } from '../../mocks/modelLibrary';
import { createDemoDefaults, numericSettings, validateDemoDefaults } from './configuration';
import type {
  DemoConfiguration,
  DemoModelDefaults,
  NumericSetting,
  OptionalSetting,
} from './configuration';
import styles from './ModelConfigurationPage.module.css';

interface ModelConfigurationPageProps {
  model: DemoModel;
  configuration: DemoConfiguration;
  onChange: (draft: DemoModelDefaults) => void;
  onSave: (draft: DemoModelDefaults) => void;
  onBack: () => void;
  onCluster: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id}>{title}</h2>
      <div className={styles.group}>{children}</div>
    </section>
  );
}

function Help({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <span className={styles.help}>
      <button type="button" aria-label={`About ${label}`} aria-describedby={id}>
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip">
        {text}
      </span>
    </span>
  );
}

function Row({
  label,
  id,
  help,
  description,
  extra,
  children,
}: {
  label: string;
  id: string;
  help?: string;
  description?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.labelArea}>
        <div className={styles.labelLine}>
          <label htmlFor={id}>{label}</label>
          {help && <Help label={label} text={help} />}
          {extra}
        </div>
        {description && <p>{description}</p>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

/** Session-only editor. Saving defaults never changes Cluster placement or an active session. */
export function ModelConfigurationPage({
  model,
  configuration,
  onChange,
  onSave,
  onBack,
  onCluster,
}: ModelConfigurationPageProps) {
  const { draft, saved } = configuration;
  const heading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Partial<Record<NumericSetting, string>>>({});
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    heading.current?.closest('main')?.scrollTo?.({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, []);

  const patch = (values: Partial<DemoModelDefaults>) => {
    onChange({ ...draft, ...values });
    setMessage('');
    setErrors({});
  };
  const number = (key: NumericSetting, value: string) =>
    patch({ numbers: { ...draft.numbers, [key]: value } });
  const optional = (key: OptionalSetting) => (
    <input
      type="checkbox"
      className={styles.checkbox}
      aria-label={`Enable ${numericSettings[key].label}`}
      checked={draft.enabled[key]}
      onChange={(event) => patch({ enabled: { ...draft.enabled, [key]: event.target.checked } })}
    />
  );
  const toggle = (id: string, checked: boolean, change: (checked: boolean) => void) => (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className={styles.toggle}
      checked={checked}
      onChange={(event) => change(event.target.checked)}
    />
  );
  const numeric = (
    key: NumericSetting,
    options: {
      optional?: OptionalSetting;
      disabled?: boolean;
      inactive?: string;
      slider?: boolean;
      badge?: string;
    } = {},
  ) => {
    const rule: { label: string; min: number; max?: number; step: number } = numericSettings[key];
    const id = `config-${key}`;
    const disabled = options.disabled || (options.optional && !draft.enabled[options.optional]);
    const value = Number(draft.numbers[key]);
    const max = rule.max ?? 1;
    const fraction = Number.isFinite(value)
      ? Math.max(0, Math.min(1, (value - rule.min) / (max - rule.min)))
      : 0;
    return (
      <Row
        key={key}
        label={rule.label}
        id={id}
        help={
          key === 'contextLength'
            ? 'The manual context value is retained while automatic optimization is selected. No hardware optimization runs in this demo.'
            : 'This is a sample default. Runtime support and hardware limits are not checked in this demo.'
        }
        extra={
          <>
            {options.optional && optional(options.optional)}
            {options.badge && <span className={styles.badge}>{options.badge}</span>}
          </>
        }
      >
        <div className={styles.numberControl}>
          {options.slider && (
            <input
              type="range"
              aria-label={`${rule.label} slider`}
              min={rule.min}
              max={rule.max}
              step={rule.step}
              value={Number.isFinite(value) ? Math.min(max, Math.max(rule.min, value)) : rule.min}
              disabled={Boolean(disabled)}
              onChange={(event) => number(key, event.target.value)}
              style={{ '--range-fill': `${fraction * 100}%` } as CSSProperties}
            />
          )}
          {disabled && options.inactive ? (
            <input id={id} type="text" value={options.inactive} disabled />
          ) : (
            <input
              id={id}
              type="number"
              inputMode={rule.step === 1 ? 'numeric' : 'decimal'}
              min={rule.min}
              max={rule.max}
              step="any"
              value={draft.numbers[key]}
              disabled={Boolean(disabled)}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={errors[key] ? `${id}-error` : undefined}
              onChange={(event) => number(key, event.target.value)}
            />
          )}
        </div>
        {errors[key] && (
          <p id={`${id}-error`} className={styles.error}>
            {errors[key]}
          </p>
        )}
      </Row>
    );
  };
  const addStop = () => {
    if (draft.stopInput && draft.stopStrings.length < 16)
      patch({ stopStrings: [...new Set([...draft.stopStrings, draft.stopInput])], stopInput: '' });
  };
  const save = () => {
    const next = draft.stopInput
      ? {
          ...draft,
          stopStrings: [...new Set([...draft.stopStrings, draft.stopInput])],
          stopInput: '',
        }
      : draft;
    const invalid = validateDemoDefaults(next);
    setErrors(invalid);
    const first = (Object.keys(invalid) as NumericSetting[])[0];
    if (first) {
      setMessage('Check the highlighted settings before saving.');
      document.getElementById(`config-${first}`)?.focus();
      return;
    }
    if (next.stopStrings.length > 16) {
      setMessage('Use no more than 16 stop strings in this demo.');
      return;
    }
    onSave(next);
    setMessage('Defaults saved for this demo session.');
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Model configuration
          </h1>
          <div className={styles.identity}>
            <span title={model.name}>{model.name}</span>
            <span className={styles.chip}>GGUF</span>
            <span className={styles.chip}>{model.quantization}</span>
          </div>
        </div>
        <Button className={styles.back} onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to Models
        </Button>
      </header>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Section title="Prompt">
          <div className={styles.textRow}>
            <div className={styles.labelLine}>
              <label htmlFor="config-prompt">System Prompt</label>
              <Help
                label="System Prompt"
                text="A default instruction for this model. Saving it in this demo does not send any request."
              />
            </div>
            <textarea
              id="config-prompt"
              maxLength={16000}
              placeholder="Enter a default system prompt…"
              value={draft.systemPrompt}
              onChange={(event) => patch({ systemPrompt: event.target.value })}
            />
          </div>
        </Section>
        <Section title="Context and Performance">
          <Row
            label="Automatic Optimize Based on Hardware"
            id="config-auto"
            help="The demo stores this preference only. It does not inspect hardware or compute optimized settings."
            extra={<span className={styles.recommended}>Recommended</span>}
          >
            {toggle('config-auto', draft.automatic, (automatic) => patch({ automatic }))}
          </Row>
          {numeric('contextLength', { disabled: draft.automatic, inactive: 'Auto' })}
          <Row
            label="GPU Offload"
            id="config-offload"
            help="Assign model layers to devices in Cluster. Opening Cluster keeps these pending defaults."
          >
            <Button
              id="config-offload"
              aria-label="Set in Cluster"
              className={styles.utility}
              onClick={onCluster}
            >
              Set in Cluster
            </Button>
          </Row>
          {numeric('threads', { slider: true })}
          {numeric('evaluationBatch')}
          {numeric('physicalBatch')}
          {numeric('concurrency', { badge: 'Experimental' })}
          <Row
            label="Flash Attention"
            id="config-flash"
            help="A stored preference; this demo does not verify backend support."
          >
            {toggle('config-flash', draft.flashAttention, (flashAttention) =>
              patch({ flashAttention }),
            )}
          </Row>
        </Section>
        <Section title="Generation">
          {numeric('temperature', { slider: true })}
          <Row
            label="Limit Response Length"
            id="config-responseLength"
            extra={optional('responseLength')}
          >
            <input
              id="config-responseLength"
              type="number"
              min={1}
              step="any"
              aria-label="Maximum Response Length"
              value={draft.numbers.responseLength}
              disabled={!draft.enabled.responseLength}
              aria-invalid={Boolean(errors.responseLength)}
              aria-describedby={errors.responseLength ? 'config-responseLength-error' : undefined}
              onChange={(event) => number('responseLength', event.target.value)}
            />
            {errors.responseLength && (
              <p id="config-responseLength-error" className={styles.error}>
                {errors.responseLength}
              </p>
            )}
          </Row>
          <Row
            label="Context Overflow"
            id="config-overflow"
            help="Stores the default overflow choice. No context handling runs here."
          >
            <select
              id="config-overflow"
              value={draft.overflow}
              onChange={(event) => {
                const overflow = event.target.value;
                if (overflow === 'truncate-middle' || overflow === 'stop' || overflow === 'rolling')
                  patch({ overflow });
              }}
            >
              <option value="truncate-middle">Truncate Middle</option>
              <option value="stop">Stop at Limit</option>
              <option value="rolling">Rolling Window</option>
            </select>
          </Row>
          <Row
            label="Stop Strings"
            id="config-stop"
            help="Press Enter to add an exact string, including meaningful whitespace. Up to 16 strings are retained in this demo."
          >
            <div className={styles.stopStrings}>
              {draft.stopStrings.map((stop) => (
                <span className={styles.stopChip} key={stop}>
                  <span>{stop}</span>
                  <button
                    type="button"
                    aria-label={`Remove stop string ${stop}`}
                    onClick={() =>
                      patch({ stopStrings: draft.stopStrings.filter((value) => value !== stop) })
                    }
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                id="config-stop"
                type="text"
                maxLength={1024}
                placeholder="Add a stop string…"
                value={draft.stopInput}
                onChange={(event) => patch({ stopInput: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addStop();
                  }
                }}
              />
            </div>
          </Row>
        </Section>
        <Section title="Reasoning">
          <Row
            label="Enable Thinking"
            id="config-thinking"
            description="For supported chat templates."
          >
            {toggle('config-thinking', draft.thinking, (thinking) => patch({ thinking }))}
          </Row>
          {numeric('reasoningBudget', { optional: 'reasoningBudget', disabled: !draft.thinking })}
          <Row label="Reasoning Budget Message" id="config-reasoning-message">
            <input
              className={styles.wideInput}
              id="config-reasoning-message"
              type="text"
              maxLength={2000}
              disabled={!draft.thinking || !draft.enabled.reasoningBudget}
              value={draft.reasoningMessage}
              onChange={(event) => patch({ reasoningMessage: event.target.value })}
            />
          </Row>
        </Section>
        <Section title="Speculative decoding">
          <Row
            label="Method"
            id="config-speculative"
            description="Speculative decoding is not connected in this demo."
            help="Only methods without draft models may be considered, after unchanged-quality validation. No such method is enabled here."
          >
            <select id="config-speculative" disabled value="off">
              <option value="off">Off</option>
            </select>
          </Row>
        </Section>
        <Section title="Advanced">
          {numeric('topK')}
          {numeric('topP', { optional: 'topP', slider: true })}
          {numeric('minP', { optional: 'minP', slider: true })}
          {numeric('repeatPenalty', { optional: 'repeatPenalty' })}
          {numeric('presencePenalty', { optional: 'presencePenalty' })}
          <div className={styles.textRow}>
            <details
              open={draft.customTemplate}
              onToggle={(event) => {
                const customTemplate = event.currentTarget.open;
                if (customTemplate !== draft.customTemplate) patch({ customTemplate });
              }}
            >
              <summary>
                <span>Chat Template</span>
                <span className={styles.templateValue}>
                  {draft.chatTemplate ? 'Custom' : 'Model default'}
                </span>
              </summary>
              <p className={styles.description}>
                Stored as text only. This demo does not render or execute templates.
              </p>
              <textarea
                aria-label="Chat Template text"
                placeholder="Leave empty to use the model default"
                maxLength={16000}
                value={draft.chatTemplate}
                onChange={(event) => patch({ chatTemplate: event.target.value })}
              />
            </details>
          </div>
          {numeric('ropeBase', { optional: 'ropeBase', inactive: 'Auto' })}
          {numeric('ropeScale', { optional: 'ropeScale', inactive: 'Auto' })}
          {numeric('seed', { optional: 'seed', inactive: 'Random' })}
          <Row
            label="llama.cpp Arguments Override"
            id="config-arguments"
            help="The demo stores text only; arguments are never parsed or executed."
          >
            {toggle('config-arguments', draft.argumentsEnabled, (argumentsEnabled) =>
              patch({ argumentsEnabled }),
            )}
          </Row>
          {draft.argumentsEnabled && (
            <div className={styles.textRow}>
              <label htmlFor="config-arguments-text">Arguments</label>
              <textarea
                id="config-arguments-text"
                maxLength={8000}
                placeholder="Enter argument overrides…"
                value={draft.argumentsText}
                onChange={(event) => patch({ argumentsText: event.target.value })}
              />
              <p className={styles.description}>Stored as text only; no command is executed.</p>
            </div>
          )}
        </Section>
        <footer className={styles.footer}>
          <Button className={styles.reset} onClick={() => patch(createDemoDefaults())}>
            <RotateCcw size={16} aria-hidden="true" />
            Reset defaults
          </Button>
          <p className={styles.feedback} role={Object.keys(errors).length ? 'alert' : 'status'}>
            {message || (changed ? 'Pending changes' : 'Defaults for this demo session')}
          </p>
          <Button type="submit" className={styles.save} disabled={!changed}>
            Save defaults
          </Button>
        </footer>
      </form>
    </div>
  );
}
