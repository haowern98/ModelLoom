import { _electron as electron, expect, test } from '@playwright/test';
import type { ownershipBinding } from '../../../packages/core/src/hosts/windows-ownership';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { developmentPackage, packagedEvidence } from './packaged-runtime-paths';
import {
  ownedProcesses,
  survivingProcesses,
  terminateCaptured,
} from './packaged-runtime-processes';

test.use({ trace: 'off' });
test.skip(process.env.MODELLOOM_PACKAGED_RUNTIME_TEST !== '1', 'Requires approved pinned package.');
const paths = {
  binding: path.join(
    developmentPackage,
    'resources/modelloom-development/core/out/native/ownership.node',
  ),
  helper: path.join(
    developmentPackage,
    'resources/modelloom-development/bootstrap/candidate/ModelLoom-runtime-host.exe',
  ),
  server: path.join(
    developmentPackage,
    'resources/modelloom-development/bootstrap/candidate/llama-server.exe',
  ),
  temp: path.resolve(__dirname, '../out/grouping-probe'),
};

for (const deliver of [true, false]) {
  test(`packaged original pinned server private stream ${deliver ? 'is read through EOF' : 'vanishes on owner death during startup'}`, async () => {
    test.setTimeout(60_000);
    const before = readdirSync(paths.temp).filter((name) => name.startsWith('credential-'));
    const app = await electron.launch({
      executablePath: path.join(developmentPackage, 'ModelLoom Development.exe'),
      cwd: 'E:\\',
    });
    const mainPid = app.process().pid!;
    let killed = false;
    try {
      await app.firstWindow();
      console.log('Private stream: packaged window opened');
      const started = await app.evaluate(
        async (_, input) => {
          const native = process.getBuiltinModule('module').createRequire(input.paths.binding)(
            input.paths.binding,
          ) as ReturnType<typeof ownershipBinding>;
          const root = native.createDeployment();
          const credential = native.createCredential(root, input.nonce, 'A'.repeat(43));
          const pipe = native.credentialPath(credential);
          const child = native.launchConsole(
            root,
            input.paths.helper,
            [input.paths.server, '--api-key-file', pipe, '--help'],
            input.paths.temp,
          );
          Object.assign(globalThis, { privateStreamTest: { native, root, credential, child } });
          // Only the fixed helper receipt is parsed. Server output is discarded.
          let first = '';
          for (let i = 0; i < 500; i++) {
            const current = native.observe(child);
            first += current.output;
            const receipt = /^ENGINE ([1-9][0-9]*)\r?\n/u.exec(first);
            if (receipt) {
              native.captureServer(child, Number(receipt[1]), input.paths.server);
              Object.assign(globalThis, { privateStreamTest: { native, root, credential, child } });
              return { mainPid: process.pid, serverPid: Number(receipt[1]), pipe };
            }
            if (current.exitCode !== -1 || first.length > 65536) throw Error('NO_PRIVATE_READER');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw Error('NO_PRIVATE_READER');
        },
        { paths, nonce: randomUUID() },
      );
      console.log('Private stream: pinned reader captured');
      const captured = ownedProcesses(started.mainPid);
      const server = captured.find((entry) => entry.pid === started.serverPid);
      const helper = captured.find((entry) => entry.pid === server?.parent);
      const main = captured.find((entry) => entry.pid === started.mainPid);
      expect(main).toBeDefined();
      expect(server?.image).toBe(paths.server);
      expect(helper?.image).toBe(paths.helper);
      expect(server?.name).toBe('llama-server.exe');
      expect(helper?.name).toBe('ModelLoom-runtime-host.exe');
      expect(new Date(server!.created).getTime()).toBeGreaterThanOrEqual(
        new Date(helper!.created).getTime(),
      );
      expect(new Date(helper!.created).getTime()).toBeGreaterThan(
        new Date(main!.created).getTime(),
      );
      if (deliver) {
        const result = await app.evaluate(async () => {
          const state = (
            globalThis as typeof globalThis & {
              privateStreamTest: {
                native: ReturnType<typeof ownershipBinding>;
                root: object;
                credential: object;
                child: object;
              };
            }
          ).privateStreamTest;
          let delivered = false;
          for (let i = 0; i < 500; i++) {
            if (!delivered)
              delivered = state.native.deliverCredential(state.credential, state.child);
            const observation = state.native.observe(state.child);
            if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
              state.native.releaseCredential(state.credential);
              state.native.release(state.child);
              state.native.closeDeployment(state.root);
              return { delivered, exitCode: observation.exitCode, empty: true };
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          state.native.closeDeployment(state.root);
          throw Error('PRIVATE_READER_DID_NOT_EXIT');
        });
        expect(result).toEqual({ delivered: true, exitCode: 0, empty: true });
        console.log('Private stream: reader exited and capability released');
      } else {
        terminateCaptured(main!);
        killed = true;
        await expect.poll(() => survivingProcesses(captured).length, { timeout: 15_000 }).toBe(0);
      }
      const gone = await new Promise<boolean>((resolve) => {
        const client = createConnection(started.pipe);
        client.once('connect', () => {
          client.destroy();
          resolve(false);
        });
        client.once('error', () => resolve(true));
      });
      expect(gone).toBe(true);
      console.log('Private stream: endpoint absent');
      expect(readdirSync(paths.temp).filter((name) => name.startsWith('credential-'))).toEqual(
        before,
      );
    } finally {
      if (!killed) {
        console.log('Private stream: final capability cleanup begins');
        await app.evaluate(() => {
          const state = (
            globalThis as typeof globalThis & {
              privateStreamTest?: {
                native: ReturnType<typeof ownershipBinding>;
                root: object;
                credential: object;
              };
            }
          ).privateStreamTest;
          if (state) {
            state.native.closeDeployment(state.root);
            state.native.releaseCredential(state.credential);
          }
        });
        console.log('Private stream: final capability cleanup finished; app close begins');
        await app.close();
        console.log('Private stream: app close finished');
      }
      expect(ownedProcesses(mainPid)).toEqual([]);
    }
    writeFileSync(
      path.join(
        packagedEvidence,
        deliver
          ? 'packaged-original-stream-read.json'
          : 'packaged-original-stream-owner-death.json',
      ),
      JSON.stringify({
        realPinnedServer: true,
        originalLaunchPaths: true,
        launchCopiesCreated: false,
        loadedModel: false,
        credentialFileCreated: false,
        pipeGone: true,
        engineJobEmpty: true,
        packagedCloseCompleted: deliver,
        ownerDeathConfirmed: !deliver,
        scenario: deliver ? 'argument-reader-EOF' : 'owner-death-before-delivery',
      }),
    );
  });
}
