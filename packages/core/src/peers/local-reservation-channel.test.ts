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
