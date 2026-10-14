import { readClientState, writeHarnessFile } from './packaged-client-state';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { readdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';
import {
  ownedProcesses,
  runtimeServer,
  survivingProcesses,
  terminateCaptured,
} from './packaged-runtime-processes';

test.skip(
  process.env.MODELLOOM_PACKAGED_API_CLIENT !== '1',
  'Requires separately authorized real-runtime lifecycle tests and the isolated API client.',
);

const credentials = () =>
  readdirSync(
    path.join(process.env.LOCALAPPDATA!, 'ModelLoom-Development/runtime/installed'),
  ).filter((name) => name.startsWith('credential-'));
const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
const command = (action: string) => {
  writeHarnessFile(path.join(packagedEvidence, 'client-state.json'), '{}');
  writeHarnessFile(
    path.join(packagedEvidence, 'command.json'),
    JSON.stringify({ action, nonce: Date.now() }),
  );
};
const client = () => readClientState(path.join(packagedEvidence, 'client-state.json'));

async function importModel(app: ElectronApplication, window: Page) {
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
}

test('window Quit during preparation joins work and leaves no captured owner or listener', async () => {
  test.setTimeout(180_000);
  const prior = credentials();
  const app = await electron.launch({
    executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  const child = app.process();
  try {
    const window = await app.firstWindow();
    await importModel(app, window);
    await window.getByRole('button', { name: 'Run model', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Cancel loading', exact: true })).toBeVisible();
    const captured = ownedProcesses(child.pid!);
    const began = Date.now();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => child.exitCode, { timeout: 90_000 }).toBe(0);
    await expect.poll(() => survivingProcesses(captured).length, { timeout: 10_000 }).toBe(0);
    expect(await listening(8000)).toBe(false);
    expect(await listening(18478)).toBe(false);
    expect(credentials().filter((name) => !prior.includes(name))).toEqual([]);
    writeFileSync(
      path.join(packagedEvidence, 'quit-preparing.json'),
      JSON.stringify({
        captured,
        milliseconds: Date.now() - began,
        allExited: true,
        portsClosed: true,
        credentialsCleaned: true,
      }),
    );
  } finally {
    if (child.exitCode === null) await app.close();
  }
});

test('window Quit with real generation and a full queue closes all owned work', async () => {
  test.setTimeout(360_000);
  const prior = credentials();
  const app = await electron.launch({
    executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  const child = app.process();
  try {
    const window = await app.firstWindow();
    await importModel(app, window);
    await window.getByRole('button', { name: 'Run model', exact: true }).click();
    await expect(window.getByText('Local model ready', { exact: true })).toBeVisible({
      timeout: 240_000,
    });
    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    await window.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await window
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Explain ocean currents in detail.');
    await window.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'API', exact: true }).click();
    await window.getByRole('button', { name: 'Start server', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Stop server', exact: true })).toBeVisible();
    command('models');
    await expect.poll(() => client().count).toBe(1);
    command('burst');
    await expect.poll(() => client().burstStarted).toBe(13);
    await expect
      .poll(async () =>
        Number(
          (await window.locator('[aria-label^="Requests:"]').getAttribute('aria-label'))?.split(
            ': ',
          )[1],
        ),
      )
      .toBeGreaterThanOrEqual(11);
    const captured = ownedProcesses(child.pid!);
    expect(captured.filter((entry) => entry === runtimeServer(captured))).toHaveLength(1);
    const began = Date.now();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => child.exitCode, { timeout: 15_000 }).toBe(0);
    await expect.poll(() => survivingProcesses(captured).length, { timeout: 10_000 }).toBe(0);
    expect(await listening(8000)).toBe(false);
    expect(await listening(18478)).toBe(false);
    expect(credentials().filter((name) => !prior.includes(name))).toEqual([]);
    await expect.poll(() => client().burstEnded?.length, { timeout: 10_000 }).toBe(13);
    writeFileSync(
      path.join(packagedEvidence, 'quit-queued.json'),
      JSON.stringify({
        captured,
        milliseconds: Date.now() - began,
        allExited: true,
        portsClosed: true,
        credentialsCleaned: true,
        clients: client().burstEnded,
      }),
    );
  } finally {
    if (child.exitCode === null) await app.close();
  }
});

test('captured native termination interrupts Chat, recovers explicitly, and owner death kills the owned tree', async () => {
  test.setTimeout(420_000);
  const prior = credentials();
  const app = await electron.launch({
    executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
    cwd: 'E:\\',
  });
  const child = app.process();
  try {
    const window = await app.firstWindow();
    await importModel(app, window);
    await window.getByRole('button', { name: 'Run model', exact: true }).click();
    await expect(window.getByText('Local model ready', { exact: true })).toBeVisible({
      timeout: 240_000,
    });
    const first = ownedProcesses(child.pid!);
    const server = runtimeServer(first);
    expect(server).toBeDefined();
    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    await window.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await window
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Explain ocean currents in detail.');
    await window.getByRole('button', { name: 'Send message', exact: true }).click();
    const response = window.getByRole('article', { name: 'Assistant response 2', exact: true });
    await expect(response.locator('details p')).not.toBeEmpty({ timeout: 30_000 });
    terminateCaptured(server!);
    await expect(response.getByRole('status')).toHaveText('Interrupted', { timeout: 15_000 });
    if (await window.getByRole('dialog', { name: 'Runtime', exact: true }).count()) {
      await window.getByRole('button', { name: 'Got it', exact: true }).click();
    }
    await expect(window.getByRole('button', { name: 'Models', exact: true })).toBeEnabled();
    await window.getByRole('button', { name: 'Cluster', exact: true }).click();
    await window.getByRole('button', { name: 'Run model', exact: true }).click();
    await expect(window.getByText('Local model ready', { exact: true })).toBeVisible({
      timeout: 240_000,
    });
    await window.getByRole('button', { name: 'Chat', exact: true }).click();
    await window
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Reply with only the word RECOVERED.');
    await window.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      window
        .getByRole('article', { name: 'Assistant response 4', exact: true })
        .getByRole('status'),
    ).toHaveText(/Complete|Output limit reached/, { timeout: 90_000 });
    const captured = ownedProcesses(child.pid!);
    const mainPid = await app.evaluate(() => process.pid);
    const main = captured.find((entry) => entry.pid === mainPid);
    const began = Date.now();
    terminateCaptured(main!);
    await expect.poll(() => survivingProcesses(captured).length, { timeout: 10_000 }).toBe(0);
    expect(await listening(8000)).toBe(false);
    expect(await listening(18478)).toBe(false);
    const remainingCredentials = credentials().filter((name) => !prior.includes(name)).length;
    expect(remainingCredentials).toBe(0);
    writeFileSync(
      path.join(packagedEvidence, 'controlled-recovery-owner-death.json'),
      JSON.stringify({
        first,
        captured,
        controlledTermination: true,
        interrupted: true,
        explicitRecovery: true,
        allExited: true,
        milliseconds: Date.now() - began,
        remainingCredentials,
      }),
    );
  } finally {
    if (child.exitCode === null) await app.close();
  }
});
