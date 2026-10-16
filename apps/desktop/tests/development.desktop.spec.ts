import { readClientState, writeHarnessFile } from './packaged-client-state';
import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import {
  ownedProcesses,
  runtimeProcesses,
  runtimeServer,
  survivingProcesses,
  terminateCaptured,
} from './packaged-runtime-processes';

test.skip(
  process.env.MODELLOOM_PACKAGED_RUNTIME_TEST !== '1',
  'Requires explicit real-runtime test authorization and the approved package/model.',
);

test('relocated packaged development imports and loads the approved runtime', async () => {
  test.setTimeout(process.env.MODELLOOM_PACKAGED_VISUAL_TEST === '1' ? 540_000 : 420_000);
  const executablePath = path.join(developmentPackage, 'ModelLoom Development.exe');
  const evidence = packagedEvidence;
  const credentialRoot = path.join(
    process.env.LOCALAPPDATA!,
    'ModelLoom-Development/runtime/installed',
  );
  const credentials = () =>
    existsSync(credentialRoot)
      ? readdirSync(credentialRoot).filter((name) => name.startsWith('credential-'))
      : [];
  const priorCredentials = credentials();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.MODELLOOM_DEMO;
  delete env.MODELLOOM_DEVELOPMENT_STAGE;
  const app = await electron.launch({ executablePath, cwd: 'E:\\', env });
  const ownedProcess = app.process();
  const window = await app.firstWindow();
  const report: {
    errors: string[];
    pid?: number;
    loaded?: boolean;
    chat?: string;
    json?: unknown;
    stream?: unknown;
    isolatedDisconnect?: boolean;
    engineContinuous?: boolean;
    retry?: boolean;
    body?: string;
  } = {
    errors: [],
  };
  if (ownedProcess.pid !== undefined) report.pid = ownedProcess.pid;
  window.on('pageerror', (error) => report.errors.push(error.message));
  try {
    await expect
      .poll(() =>
        window.evaluate(
          async () =>
            (await globalThis.window.modelLoomRuntime?.command({ action: 'snapshot' }))?.enabled,
        ),
      )
      .toBe(true);
    await window.getByRole('button', { name: 'Models', exact: true }).click();
    await expect(window.getByText('No models imported', { exact: true })).toBeVisible();
    await app.evaluate(
      ({ dialog }, model) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [model] });
      },
      path.resolve(
        __dirname,
        '../../../packages/core/out/activation/b11306/models/Bonsai-27B-Q1_0.gguf',
      ),
    );
    await window.getByRole('button', { name: 'Import GGUF', exact: true }).click();
    await expect(window.getByRole('article', { name: 'Bonsai 27B' })).toBeVisible({
      timeout: 60_000,
    });
    await window.getByRole('button', { name: 'Cluster', exact: true }).click();
    await window.getByRole('button', { name: 'Choose model', exact: true }).click();
    await window.getByRole('menuitem', { name: /Bonsai 27B/ }).click();
    await window.getByRole('button', { name: 'Run model', exact: true }).click();
    await expect(
      window
        .getByText('Local model ready', { exact: true })
        .or(window.getByRole('dialog', { name: 'Runtime', exact: true })),
    ).toBeVisible({ timeout: 240_000 });
    await expect(window.getByText('Local model ready', { exact: true })).toBeVisible();
    report.loaded = true;
    await window.screenshot({ path: path.join(evidence, 'loaded.png') });
    if (process.env.MODELLOOM_PACKAGED_API_CLIENT !== '1') return;
    const command = (action: string) => {
      if (action !== 'status') writeHarnessFile(path.join(evidence, 'client-state.json'), '{}');
      writeHarnessFile(
        path.join(evidence, 'command.json'),
        JSON.stringify({ action, nonce: Date.now() }),
      );
    };
    const client = () => readClientState(path.join(evidence, 'client-state.json'));
    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    await window.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await window
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Reply with only the word PACKAGED.');
    await window.getByRole('button', { name: 'Send message', exact: true }).click();
    const response = window.getByRole('article', { name: 'Assistant response 2', exact: true });
    await expect(response.getByRole('status')).toHaveText(/Complete|Output limit reached/, {
      timeout: 90_000,
    });
    report.chat = await response.getByRole('status').innerText();
    await expect(response.locator('details')).toHaveCount(1);
    await expect(response.locator(':scope > p:not([role])')).not.toBeEmpty();
    await window.getByRole('button', { name: 'API', exact: true }).click();
    await window.getByRole('button', { name: 'Start server', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Stop server', exact: true })).toBeVisible();
    command('models');
    await expect.poll(() => client().kind).toBe('models');
    expect(client().count).toBe(1);
    command('json');
    await expect.poll(() => client().kind, { timeout: 90_000 }).toBe('json');
    report.json = client();
    expect(client().status).toBe(200);
    expect(client().usage?.completion_tokens).toBeGreaterThan(0);
    command('start');
    await expect.poll(() => client().streamStarted).toBe(true);
    await expect
      .poll(
        () => {
          command('status');
          return client().events ?? 0;
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        () => {
          command('status');
          return client().done;
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    report.stream = client();
    expect(client().status).toBe(200);
    expect(client().reasoningChars).toBeGreaterThan(0);
    expect(client().stableIds).toBe(true);
    expect(client().usage?.completion_tokens).toBeGreaterThan(0);
    command('start');
    await expect.poll(() => client().streamStarted).toBe(true);
    await expect
      .poll(
        () => {
          command('status');
          return client().events ?? 0;
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    await window
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Explain ocean currents and climate in detail.');
    await window.getByRole('button', { name: 'Send message', exact: true }).click();
    const concurrent = window.getByRole('article', { name: 'Assistant response 4', exact: true });
    await expect(concurrent.getByRole('status')).toHaveText(/Generating|Waiting/);
    const mainPid = await app.evaluate(() => process.pid);
    const beforeDisconnect = [runtimeServer(ownedProcesses(mainPid))].filter(
      (entry) => entry !== undefined,
    );
    expect(beforeDisconnect).toHaveLength(1);
    command('abort');
    await expect.poll(() => client().aborted).toBe(true);
    await expect(concurrent.getByRole('status')).toHaveText(/Complete|Output limit reached/, {
      timeout: 90_000,
    });
    report.isolatedDisconnect = true;
    command('recover');
    await expect.poll(() => client().kind, { timeout: 90_000 }).toBe('json');
    expect(client().status).toBe(200);
    const afterDisconnect = [runtimeServer(ownedProcesses(mainPid))].filter(
      (entry) => entry !== undefined,
    );
    expect(afterDisconnect).toEqual(beforeDisconnect);
    report.engineContinuous = true;
    await window.getByRole('button', { name: 'Retry response 4', exact: true }).click();
    const retried = window.getByRole('article', { name: 'Assistant response 5', exact: true });
    await expect(retried.getByRole('status')).toHaveText(/Generating|Waiting/);
    await window.getByRole('button', { name: 'Stop response', exact: true }).click();
    await expect(retried.getByRole('status')).toHaveText('Stopped', { timeout: 15_000 });
    report.retry = true;
    await window.getByRole('button', { name: 'API', exact: true }).click();
    await window.getByRole('button', { name: 'Stop server', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Start server', exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'Models', exact: true }).click();
    await window.getByRole('button', { name: 'Configure Bonsai 27B', exact: true }).click();
    const temperature = window.getByRole('spinbutton', { name: 'Temperature', exact: true });
    await temperature.fill((await temperature.inputValue()) === '0.75' ? '0.8' : '0.75');
    await window.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(window.getByRole('status')).toContainText('Defaults saved');
    if ((await temperature.inputValue()) !== '0.75') {
      await temperature.fill('0.75');
      await window.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(window.getByRole('status')).toContainText('Defaults saved');
    }
    if (process.env.MODELLOOM_PACKAGED_UTILITY_DEATH_TEST === '1') {
      const captured = ownedProcesses(mainPid);
      const corePids = await app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .filter(
            (metric) =>
              metric.type === 'Utility' &&
              (metric.name === 'ModelLoom Core' || metric.serviceName === 'ModelLoom Core'),
          )
          .map((metric) => metric.pid),
      );
      expect(corePids).toHaveLength(1);
      const core = captured.find((entry) => entry.pid === corePids[0]);
      expect(core).toBeDefined();
      const engines = runtimeProcesses(captured);
      expect(engines.filter((entry) => entry === runtimeServer(captured))).toHaveLength(1);
      if (process.env.MODELLOOM_PACKAGED_VISUAL_TEST === '1') {
        const observation = path.join(evidence, 'visual-observation.json');
        writeFileSync(observation, JSON.stringify({ ready: true, observed: false, mainPid }));
        console.log('Packaged engine ready for independent Windows observation');
        const deadline = Date.now() + 120_000;
        while (
          Date.now() < deadline &&
          !readFileSync(observation, 'utf8').includes('"observed":true')
        ) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      const began = Date.now();
      terminateCaptured(core!);
      await expect
        .poll(() => survivingProcesses([core!, ...engines]).length, { timeout: 15_000 })
        .toBe(0);
      await expect.poll(() => credentials(), { timeout: 15_000 }).toEqual(priorCredentials);
      const listening = (port: number) =>
        new Promise<boolean>((resolve) => {
          const socket = createConnection({ host: '127.0.0.1', port });
          socket.once('connect', () => {
            socket.destroy();
            resolve(true);
          });
          socket.once('error', () => resolve(false));
        });
      expect(await listening(18478)).toBe(false);
      expect(await listening(8000)).toBe(false);
      expect(await app.evaluate(() => process.pid)).toBe(mainPid);
      if (await window.getByRole('dialog', { name: 'Runtime', exact: true }).count()) {
        await window.getByRole('button', { name: 'Got it', exact: true }).click();
      }
      await window.getByRole('button', { name: 'Models', exact: true }).click();
      await expect(window.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
      writeFileSync(
        path.join(evidence, 'utility-death.json'),
        JSON.stringify({
          captured: [core, ...engines],
          milliseconds: Date.now() - began,
          allExited: true,
          portsClosed: true,
          credentialsCleaned: true,
          guiUsable: true,
        }),
      );
    }
  } finally {
    report.body = await window
      .locator('body')
      .innerText()
      .catch(() => 'Window unavailable');
    writeFileSync(path.join(evidence, 'electron-load.json'), JSON.stringify(report, null, 2));
    await app.close();
  }
});
