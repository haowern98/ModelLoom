import { expect, it } from 'vitest';
import { localReservationClient, localReservationServer } from './local-reservation-channel.js';
import { GpuReservations } from './reservations.js';

it('keeps local hardware reserved until confirmed release and rejects overlapping remote work', async () => {
  const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
  const reservations = new GpuReservations([gpu], 1000, () => 0);
  reservations.setShared([gpu]);
  const owner = {
    reserveLocal: (ids: readonly string[]) => reservations.reserveLocal(ids),
    releaseLocal: (held: ReturnType<GpuReservations['reserveLocal']>) => {
      reservations.beginRelease(held);
      reservations.confirmReleased(held);
    },
  };
  const server = localReservationServer(
    () => Promise.resolve(owner),
    (value) => client.receive(value as Record<string, unknown>),
  );
  const client = localReservationClient((value) => {
    void server(value as Record<string, unknown>);
  });
  const held = await client.reserve([gpu]);
  expect(() => reservations.reserveRemote('a'.repeat(64), [gpu])).toThrow('GPU_BUSY');
  await held.release();
  const remote = reservations.reserveRemote('a'.repeat(64), [gpu]);
  await expect(client.reserve([gpu])).rejects.toThrow('GPU_BUSY');
  reservations.beginRelease(remote);
  reservations.confirmReleased(remote);
  await (await client.reserve([gpu])).release();
});

it('does not turn remote identities or unsolicited replies into a local reservation', async () => {
  const client = localReservationClient(() => undefined);
  await expect(
    client.reserve(['peer:' + 'a'.repeat(64) + ':GPU-11111111-1111-1111-1111-111111111111']),
  ).rejects.toThrow('INVALID_GPU_RESERVATION');
  expect(() => client.receive({ type: 'gpu-result', id: 'unknown', ok: true })).toThrow(
    'INVALID_CONTROL',
  );
  client.close();
});

it('acknowledges runtime activity only after the trusted owner has applied it', async () => {
  const events: unknown[] = [];
  const server = localReservationServer(
    () =>
      Promise.resolve({
        reserveLocal: () => {
          throw Error('unused');
        },
        releaseLocal: () => undefined,
        setRuntimeBusy: (busy: boolean) => {
          events.push(busy);
        },
      }),
    (reply) => {
      events.push(reply);
      client.receive(reply as Record<string, unknown>);
    },
  );
  const client = localReservationClient((request) => {
    void server(request as Record<string, unknown>);
  });
  await client.setBusy(true);
  await client.setBusy(false);
  expect(events[0]).toBe(true);
  expect(events[1]).toMatchObject({ type: 'gpu-result', ok: true });
  expect(events[2]).toBe(false);
});

it('rejects malformed activity and owners without runtime activity support', async () => {
  let called = false;
  const owner = {
    reserveLocal: () => {
      throw Error('unused');
    },
    releaseLocal: () => undefined,
  };
  const server = localReservationServer(
    () => Promise.resolve(owner),
    () => {
      called = true;
    },
  );
  const activity = {
    type: 'runtime-activity',
    id: '11111111-1111-1111-1111-111111111111',
    busy: true,
  };
  for (const busy of [0, 'true', null, undefined])
    await expect(server({ ...activity, busy })).rejects.toThrow('INVALID_CONTROL');
  await expect(server({ ...activity, extra: true })).rejects.toThrow('INVALID_CONTROL');
  await expect(server(activity)).rejects.toThrow('NOT_READY');
  expect(called).toBe(false);
});

it('waits for asynchronous probe cancellation before acknowledging activity', async () => {
  let applied!: () => void;
  const pending = new Promise<void>((resolve) => {
    applied = resolve;
  });
  const replies: object[] = [];
  const server = localReservationServer(
    () =>
      Promise.resolve({
        reserveLocal: () => {
          throw Error('unused');
        },
        releaseLocal: () => undefined,
        setRuntimeBusy: () => pending,
      }),
    (reply) => {
      replies.push(reply);
    },
  );
  const execution = server({
    type: 'runtime-activity',
    id: '11111111-1111-1111-1111-111111111111',
    busy: true,
  });
  await Promise.resolve();
  expect(replies).toEqual([]);
  applied();
  await execution;
  expect(replies).toHaveLength(1);
});
