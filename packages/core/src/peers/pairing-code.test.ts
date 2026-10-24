import { expect, it } from 'vitest';
import { CodePairing, verifyPairingCode } from './pairing-code.js';

const context = {
  id: 'request',
  client: 'a'.repeat(64),
  server: 'b'.repeat(64),
  clientName: 'Laptop',
  serverName: 'Worker',
};

it('authenticates both identity bindings without exposing the code on the wire', async () => {
  const pairing = await CodePairing.create(context);
  expect(pairing.code).toMatch(/^\d{6}$/u);
  const result = await verifyPairingCode(
    context,
    pairing.code,
    async (request) => await Promise.resolve(pairing.start(request)),
  );
  expect(pairing.verified).toBe(false);
  pairing.finish(result);
  // The initiating side requires the receiver's authenticated completion receipt.
  expect(() => result.accept('0'.repeat(64))).toThrow('PAIRING_CODE_INVALID');
  expect(pairing.verified).toBe(true);
  expect(() => pairing.finish(result)).toThrow();
});

it('binds requests independently and authenticates the receiver completion receipt', async () => {
  const pairing = await CodePairing.create(context);
  const result = await verifyPairingCode(
    context,
    pairing.code,
    async (request) => await Promise.resolve(pairing.start(request)),
  );
  const receipt = pairing.finish(result);
  expect(() => result.accept(receipt)).not.toThrow();
  const other = await CodePairing.create({ ...context, id: 'different request' });
  await expect(
    verifyPairingCode(
      context,
      other.code,
      async (request) => await Promise.resolve(other.start(request)),
    ),
  ).rejects.toThrow('PAIRING_CODE_INVALID');
});

it('rejects a wrong code, changed identity and modified friendly name', async () => {
  for (const change of ['code', 'identity', 'name']) {
    const pairing = await CodePairing.create(context);
    const wrong = pairing.code === '000000' ? '111111' : '000000';
    const altered =
      change === 'identity'
        ? { ...context, server: 'c'.repeat(64) }
        : change === 'name'
          ? { ...context, serverName: 'Impostor' }
          : context;
    await expect(
      verifyPairingCode(
        altered,
        change === 'code' ? wrong : pairing.code,
        async (request) => await Promise.resolve(pairing.start(request)),
      ),
    ).rejects.toThrow('PAIRING_CODE_INVALID');
    expect(pairing.verified).toBe(false);
  }
});

it('expires the entire exchange and limits attempts even when clients omit finish', async () => {
  let now = 0;
  const pairing = await CodePairing.create(context, () => now);
  const code = pairing.code;
  now = 300001;
  await expect(
    verifyPairingCode(
      context,
      code,
      async (request) => await Promise.resolve(pairing.start(request)),
    ),
  ).rejects.toThrow('PAIRING_EXPIRED');
  now = 0;
  const limited = await CodePairing.create(context, () => now);
  for (let i = 0; i < 5; i++)
    await verifyPairingCode(
      context,
      limited.code,
      async (request) => await Promise.resolve(limited.start(request)),
    );
  await expect(
    verifyPairingCode(
      context,
      limited.code,
      async (request) => await Promise.resolve(limited.start(request)),
    ),
  ).rejects.toThrow('PAIRING_ATTEMPTS_EXCEEDED');
});

it('invalidates pending verification when cancelled', async () => {
  const pairing = await CodePairing.create(context);
  const proof = await verifyPairingCode(
    context,
    pairing.code,
    async (request) => await Promise.resolve(pairing.start(request)),
  );
  pairing.close();
  expect(() => pairing.finish(proof)).toThrow('PAIRING_EXPIRED');
});
