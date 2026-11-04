import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button as SdkButton } from '@openai/apps-sdk-ui/components/Button';
import { Button } from '../../components/Button';
import { ChatNavIcon } from '../../components/ChatNavIcon';
import { Toast } from '../../components/Toast';
import type { ToastMessage } from '../../components/Toast';
import type { DemoModel } from '../../mocks/modelLibrary';
import { createDemoDefaults, numericSettings, validateDemoDefaults } from './configuration';
import { ConfigurationNumberInput, ConfigurationSelect } from './ConfigurationControls';
import type {
  DemoConfiguration,
  DemoModelDefaults,
  NumericSetting,
  OptionalSetting,
} from './configuration';
import styles from './ModelConfigurationPage.module.css';
import {
  neuralMethods,
  retrievalMethods,
} from '../../../../../../packages/core/src/speculative-decoding/contracts';

interface ModelConfigurationPageProps {
  speculativeAssets?: readonly DemoModel[];
  embeddedMtp?: boolean;
  executionDevice?: string;
  model: DemoModel;
  configuration: DemoConfiguration;
  onChange: (draft: DemoModelDefaults) => void;
  onSave: (draft: DemoModelDefaults) => void | Promise<void | { pendingReload: boolean }>;
  live?: {
    maxOutputTokens: number;
    thinkingSupported: boolean;
    pendingReload: boolean;
    resetDefaults: DemoModelDefaults;
  };
  onBack: () => void;
  onCluster: (section?: 'speculation') => void;
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

function Row({
  label,
  id,
  description,
  extra,
  children,
}: {
  label: string;
  id: string;
  description?: string | undefined;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.labelArea}>
        <div className={styles.labelLine}>
          <label htmlFor={id}>{label}</label>
          {extra}
        </div>
        {description && <p>{description}</p>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

/** Shared preview/live editor. Core acknowledgement is required for a live Save success. */
export function ModelConfigurationPage({
  model,
  configuration,
  onChange,
  onSave,
  live,
  onBack,
  onCluster,
  speculativeAssets = [],
  embeddedMtp = false,
  executionDevice = 'Set in Cluster',
}: ModelConfigurationPageProps) {
  const { draft, saved } = configuration;
  const formId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const notificationFallback = useRef<HTMLButtonElement>(null);
  const notificationId = useRef(0);
  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const dismissNotification = useCallback(() => setNotification(null), []);
  const [saving, setSaving] = useState(false);
  const [templateExpanded, setTemplateExpanded] = useState(draft.customTemplate);
  const [errors, setErrors] = useState<Partial<Record<NumericSetting, string>>>({});
  const [specErrors, setSpecErrors] = useState<{ source?: string; maxDraftTokens?: string }>({});
  const spec = draft.speculation;
  const patchSpec = (values: Partial<DemoModelDefaults['speculation']>) =>
    patch({ speculation: { ...spec, ...values } });
  const companions = speculativeAssets.filter(
    (asset) =>
      asset.ready &&
      asset.id !== model.id &&
      (spec.method === 'draft' ? !asset.speculativeHead : asset.speculativeHead === spec.method),
  );
  const sources = [
    { value: '', label: 'Select companion' },
    ...(spec.method === 'mtp' && embeddedMtp ? [{ value: 'embedded', label: 'Embedded MTP' }] : []),
    ...companions.map((asset) => ({ value: asset.id.replace(/^model-/u, ''), label: asset.name })),
  ];
  if (spec.source && !sources.some((source) => source.value === spec.source))
    sources.push({
      value: spec.source,
      label:
        spec.source === 'embedded' ? 'Embedded MTP (unavailable)' : 'Saved companion (unavailable)',
    });
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    heading.current?.closest('main')?.scrollTo?.({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, []);

  const patch = (values: Partial<DemoModelDefaults>) => {
    onChange({ ...draft, ...values });
    dismissNotification();
    setErrors({});
    setSpecErrors({});
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
  const toggle = (
    id: string,
    checked: boolean,
    change: (checked: boolean) => void,
    disabled = false,
  ) => (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className={styles.toggle}
      checked={checked}
      disabled={disabled}
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
        description={
          key === 'contextLength'
            ? 'Total tokens available for the prompt and response.'
            : key === 'reasoningBudget'
              ? 'Maximum tokens used for thinking.'
              : live &&
                  [
                    'threads',
                    'evaluationBatch',
                    'physicalBatch',
                    'concurrency',
                    'ropeBase',
                    'ropeScale',
                  ].includes(key)
                ? 'Applies the next time the model is loaded.'
                : undefined
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
          <ConfigurationNumberInput
            id={id}
            label={rule.label}
            min={rule.min}
            max={rule.max}
            step={rule.step}
            value={draft.numbers[key]}
            disabled={Boolean(disabled)}
            inactive={options.inactive}
            invalid={Boolean(errors[key])}
            describedBy={errors[key] ? `${id}-error` : undefined}
            onChange={(value) => number(key, value)}
          />
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
    if (draft.stopInput && draft.stopStrings.length < (live ? 4 : 16))
      patch({ stopStrings: [...new Set([...draft.stopStrings, draft.stopInput])], stopInput: '' });
  };
  const save = async () => {
    if (saving) return;
    dismissNotification();
    const next = draft.stopInput
      ? {
          ...draft,
          stopStrings: [...new Set([...draft.stopStrings, draft.stopInput])],
          stopInput: '',
        }
      : draft;
    const invalid = validateDemoDefaults(next);
    const specInvalid: typeof specErrors = {};
    if (spec.method !== 'off') {
      if (
        !spec.source ||
        (spec.source !== 'embedded' && !/^[a-f0-9]{64}$/u.test(spec.source)) ||
        (spec.source === 'embedded' && spec.method !== 'mtp')
      )
        specInvalid.source = 'Select a companion before saving.';
      if (
        spec.maxDraftTokens !== '' &&
        (!/^\d+$/u.test(spec.maxDraftTokens) ||
          Number(spec.maxDraftTokens) < 1 ||
          Number(spec.maxDraftTokens) > 256)
      )
        specInvalid.maxDraftTokens =
          'Max Draft Tokens: enter a whole number from 1 to 256, or leave empty for native default.';
    }
    setSpecErrors(specInvalid);
    if (Object.keys(specInvalid).length) {
      document
        .getElementById(specInvalid.source ? 'config-companion' : 'config-maxDraftTokens')
        ?.focus();
      return;
    }
    if (live && next.numbers.threads === '') delete invalid.threads;
    if (
      live &&
      next.enabled.responseLength &&
      Number(next.numbers.responseLength) > live.maxOutputTokens
    )
      invalid.responseLength = `Use at most ${live.maxOutputTokens} output tokens with this model profile.`;
    setErrors(invalid);
    const first = (Object.keys(invalid) as NumericSetting[])[0];
    if (first) {
      setNotification({
        id: ++notificationId.current,
        kind: 'error',
        message: 'Check the highlighted settings before saving.',
        origin: document.getElementById(`config-${first}`),
      });
      document.getElementById(`config-${first}`)?.focus();
      return;
    }
    if (next.stopStrings.length > (live ? 4 : 16)) {
      setNotification({
        id: ++notificationId.current,
        kind: 'error',
        message: live
          ? 'Use no more than four stop strings.'
          : 'Use no more than 16 stop strings in this demo.',
        origin: null,
      });
      return;
    }
    setSaving(true);
    try {
      const acknowledgement = await onSave(next);
      setNotification({
        id: ++notificationId.current,
        kind: 'success',
        message: live
          ? acknowledgement?.pendingReload
            ? 'Defaults saved. Reload the model to apply load settings. New requests use saved generation settings.'
            : 'Defaults saved. New requests will use these settings.'
          : 'Defaults saved for this demo session.',
        origin: null,
      });
    } catch (error) {
      const messages: Record<string, string> = {
        STALE_CONFIGURATION: 'These settings changed. Reopen configuration before saving again.',
        INVALID_CONFIGURATION: 'Check the model settings and try again.',
        UNSUPPORTED_SETTING: 'This setting is not available for the current model profile.',
      };
      setNotification({
        id: ++notificationId.current,
        kind: 'error',
        message:
          error instanceof Error
            ? (messages[error.message] ??
              'Settings could not be confirmed. Reopen to check saved defaults.')
            : 'Settings could not be confirmed. Reopen to check saved defaults.',
        origin: null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page} data-model-configuration>
      {notification && (
        <Toast
          key={notification.id}
          notification={notification}
          fallbackRef={notificationFallback}
          onDismiss={dismissNotification}
        />
      )}
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <SdkButton
          ref={notificationFallback}
          className={styles.breadcrumbParent ?? ''}
          color="secondary"
          variant="ghost"
          size="sm"
          pill={false}
          aria-label="Back to Models"
          onClick={onBack}
        >
          <span>Models</span>
        </SdkButton>
        <ChatNavIcon name="chevronRight" width="16" height="16" />
        <span className={styles.breadcrumbCurrent} aria-current="page" title={model.name}>
          {model.name}
        </span>
      </nav>
      <div className={styles.scroller} data-configuration-scroll>
        <div className={styles.content}>
          <header className={styles.header}>
            <h1 ref={heading} tabIndex={-1}>
              Model configuration
            </h1>
          </header>
          <form
            id={formId}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Section title="Prompt">
              <div className={styles.textRow}>
                <div className={styles.labelLine}>
                  <label htmlFor="config-prompt">System Prompt</label>
                </div>
                <p className={styles.description}>Default instructions for this model.</p>
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
              {numeric('contextLength')}
              <Row
                label="GPU Offload"
                id="config-offload"
                description="Assign model layers to devices in Cluster."
              >
                <Button
                  id="config-offload"
                  aria-label="Set in Cluster"
                  className={styles.utility}
                  onClick={() => onCluster()}
                >
                  Set in Cluster
                </Button>
              </Row>
              {numeric('threads', {
                slider: true,
                ...(draft.numbers.threads === '' ? { inactive: 'Automatic' } : {}),
              })}
              {numeric('evaluationBatch')}
              {numeric('physicalBatch')}
              {numeric('concurrency', { badge: 'Experimental' })}
              <Row
                label="Flash Attention"
                id="config-flash"
                description={
                  live
                    ? 'Applies the next time the model is loaded.'
                    : 'Backend support is not checked in this demo.'
                }
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
                description="When off, replies have no length cap. The loaded context limit still applies."
                extra={optional('responseLength')}
              >
                <ConfigurationNumberInput
                  id="config-responseLength"
                  label="Maximum Response Length"
                  min={1}
                  max={live?.maxOutputTokens}
                  step={1}
                  value={draft.numbers.responseLength}
                  disabled={!draft.enabled.responseLength}
                  invalid={Boolean(errors.responseLength)}
                  describedBy={errors.responseLength ? 'config-responseLength-error' : undefined}
                  onChange={(value) => number('responseLength', value)}
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
                description={
                  live
                    ? 'Applies the next time the model is loaded.'
                    : 'Stores a preference only in this demo.'
                }
              >
                <ConfigurationSelect
                  id="config-overflow"
                  label="Context Overflow"
                  value={draft.overflow}
                  options={[
                    { value: 'truncate-middle', label: 'Truncate Middle' },
                    { value: 'stop', label: 'Stop at Limit' },
                    { value: 'rolling', label: 'Rolling Window' },
                  ]}
                  onChange={(overflow) => {
                    if (
                      overflow === 'truncate-middle' ||
                      overflow === 'stop' ||
                      overflow === 'rolling'
                    )
                      patch({ overflow });
                  }}
                />
              </Row>
              <Row
                label="Stop Strings"
                id="config-stop"
                description={
                  live
                    ? 'Press Enter to add an exact stop string. Up to four strings.'
                    : 'Press Enter to add an exact stop string. Up to 16 strings in this demo.'
                }
              >
                <div className={styles.stopStrings}>
                  {draft.stopStrings.map((stop) => (
                    <span className={styles.stopChip} key={stop}>
                      <span>{stop}</span>
                      <button
                        type="button"
                        aria-label={`Remove stop string ${stop}`}
                        onClick={() =>
                          patch({
                            stopStrings: draft.stopStrings.filter((value) => value !== stop),
                          })
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
                {toggle(
                  'config-thinking',
                  draft.thinking,
                  (thinking) => patch({ thinking }),
                  Boolean(live && !live.thinkingSupported),
                )}
              </Row>
              {live && !live.thinkingSupported && (
                <p className={styles.description}>
                  This model template does not expose a thinking toggle.
                </p>
              )}
              {numeric('reasoningBudget', {
                optional: 'reasoningBudget',
                disabled: !draft.thinking,
              })}
              <Row
                label="Reasoning Budget Message"
                id="config-reasoning-message"
                {...(live ? { description: 'Applies the next time the model is loaded.' } : {})}
              >
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
                description="Applies on reload after companion compatibility and combined memory checks."
              >
                <ConfigurationSelect
                  id="config-speculative"
                  label="Method"
                  value={spec.method}
                  options={[
                    { value: 'off', label: 'Off' },
                    ...neuralMethods.map((method) => ({
                      value: method,
                      label: {
                        mtp: 'MTP',
                        draft: 'Draft model',
                        dflash: 'DFlash',
                        dspark: 'DSpark',
                        eagle3: 'EAGLE-3',
                      }[method],
                    })),
                  ]}
                  onChange={(method) => {
                    if (
                      method === 'off' ||
                      neuralMethods.includes(method as (typeof neuralMethods)[number])
                    )
                      patchSpec({
                        method: method as DemoModelDefaults['speculation']['method'],
                        ...(method !== spec.method && method !== 'off' ? { source: '' } : {}),
                      });
                  }}
                />
              </Row>
              {spec.method !== 'off' && (
                <>
                  <Row
                    label="Companion"
                    id="config-companion"
                    description={
                      spec.method === 'mtp' && !embeddedMtp
                        ? 'Embedded MTP is not qualified for this runtime profile. Select an imported MTP head.'
                        : 'Compatibility must be verified before loading.'
                    }
                  >
                    <ConfigurationSelect
                      id="config-companion"
                      label="Companion"
                      value={spec.source}
                      options={sources}
                      onChange={(source) => patchSpec({ source })}
                    />
                    {specErrors.source && (
                      <p role="alert" className={styles.error}>
                        {specErrors.source}
                      </p>
                    )}
                  </Row>
                  <Row label="Max Draft Tokens" id="config-maxDraftTokens">
                    <ConfigurationNumberInput
                      id="config-maxDraftTokens"
                      label="Max Draft Tokens"
                      min={1}
                      max={256}
                      step={1}
                      value={spec.maxDraftTokens}
                      placeholder="Native default"
                      invalid={Boolean(specErrors.maxDraftTokens)}
                      describedBy={
                        specErrors.maxDraftTokens ? 'config-maxDraftTokens-error' : undefined
                      }
                      onChange={(maxDraftTokens) => patchSpec({ maxDraftTokens })}
                    />
                    {specErrors.maxDraftTokens && (
                      <p role="alert" id="config-maxDraftTokens-error" className={styles.error}>
                        {specErrors.maxDraftTokens}
                      </p>
                    )}
                  </Row>
                </>
              )}
              <Row
                label="CPU suffix retrieval"
                id="config-retrieval"
                description="Optional native n-gram proposals."
              >
                <ConfigurationSelect
                  id="config-retrieval"
                  label="CPU suffix retrieval"
                  value={spec.retrieval}
                  options={[
                    { value: 'off', label: 'Off' },
                    ...retrievalMethods.map((method) => ({
                      value: method,
                      label: ['ngram-cache', 'ngram-map-k', 'ngram-map-k4v'].includes(method)
                        ? `${method} (memory bound unavailable)`
                        : method,
                      disabled: ['ngram-cache', 'ngram-map-k', 'ngram-map-k4v'].includes(method),
                    })),
                  ]}
                  onChange={(retrieval) => {
                    if (
                      retrieval === 'off' ||
                      retrievalMethods.includes(retrieval as (typeof retrievalMethods)[number])
                    )
                      patchSpec({
                        retrieval: retrieval as DemoModelDefaults['speculation']['retrieval'],
                      });
                  }}
                />
              </Row>
              <Row
                label="Execution device"
                id="config-spec-device"
                description="Execution placement is managed in Cluster."
              >
                <span id="config-spec-device">{executionDevice}</span>
                <Button
                  className={styles.utility}
                  aria-label="Set speculative execution in Cluster"
                  onClick={() => onCluster('speculation')}
                >
                  Set in Cluster
                </Button>
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
                  open={templateExpanded}
                  onToggle={(event) => {
                    setTemplateExpanded(event.currentTarget.open);
                  }}
                >
                  <summary>
                    <span>Chat Template</span>
                    <span className={styles.templateValue}>
                      {draft.customTemplate ? 'Custom' : 'Model default'}
                    </span>
                  </summary>
                  <p className={styles.description}>
                    {live
                      ? 'Applies the next time the model is loaded.'
                      : 'Stored as text only. This demo does not render or execute templates.'}
                  </p>
                  <textarea
                    aria-label="Chat Template text"
                    placeholder="Leave empty to use the model default"
                    maxLength={16000}
                    value={draft.chatTemplate}
                    onChange={(event) => {
                      const chatTemplate = event.target.value;
                      patch({ chatTemplate, customTemplate: Boolean(chatTemplate.trim()) });
                    }}
                  />
                </details>
              </div>
              {numeric('ropeBase', { optional: 'ropeBase', inactive: 'Auto' })}
              {numeric('ropeScale', {
                optional: 'ropeScale',
                inactive: 'Auto',
              })}
              {numeric('seed', { optional: 'seed', inactive: 'Random' })}
            </Section>
          </form>
        </div>
      </div>
      {(changed || saving) && (
        <footer className={styles.footer} role="group" aria-label="Model configuration actions">
          <Button
            className={styles.reset}
            onClick={() => patch(structuredClone(live?.resetDefaults ?? createDemoDefaults()))}
          >
            Reset defaults
          </Button>
          <Button type="submit" form={formId} className={styles.save} disabled={!changed || saving}>
            Save changes
          </Button>
        </footer>
      )}
    </div>
  );
}
