import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eventsOf } from './events-of.ts';
import { rowsOf } from './rows-of.ts';
import type { SpikeKit } from './start-spike-kit.ts';
import { startSpikeKit } from './start-spike-kit.ts';

let kit: SpikeKit;
beforeAll(async () => {
  kit = await startSpikeKit();
});
afterAll(() => kit.stop());

const fix = (minute: number, lat = 51.05, lon = 3.72) => ({
  at: `2026-11-04T09:${String(minute).padStart(2, '0')}:00Z`,
  lat,
  lon,
});

async function deviceOf(name: string): Promise<string> {
  const result = await kit.call('separate', 'trail.registerDevice', { name });
  return (result.output as { deviceId: string }).deviceId;
}

const forms = [
  { form: 'separate', action: 'trail.ingestPositions' },
  { form: 'inline', action: 'trail.ingestPositionsInline' },
] as const;

describe.each(forms)('position ingest, $form form', ({ form, action }) => {
  test('stores new fixes, skips known times, and writes one device-updated event', async () => {
    const deviceId = await deviceOf(`phone-${form}`);
    const first = await kit.call(form, action, { deviceId, fixes: [fix(0), fix(1), fix(2)] });
    expect(first.output).toEqual({ stored: 3, skipped: 0 });
    const second = await kit.call(form, action, {
      deviceId,
      fixes: [fix(2), fix(3), fix(3), fix(4)],
    });
    expect(second.output).toEqual({ stored: 2, skipped: 2 });
    const stored = (await rowsOf(kit.world, 'trail.position')).filter(
      (row) => row.deviceId === deviceId,
    );
    expect(stored).toHaveLength(5);
    const events = await eventsOf(kit.world, 'trail.device', deviceId);
    expect(events.map((event) => event.type)).toEqual([
      'trail.device.created',
      'trail.device.updated',
      'trail.device.updated',
    ]);
    const device = (await rowsOf(kit.world, 'trail.device')).find((row) => row.id === deviceId);
    expect(device?.positionCount).toBe(5);
  });

  test('an unknown device is trail.device_unknown and nothing is stored', async () => {
    const before = (await rowsOf(kit.world, 'trail.position')).length;
    const error = await kit
      .call(form, action, { deviceId: '00000000-0000-7000-8000-000000000999', fixes: [fix(0)] })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      kind: 'not_found',
      code: 'trail.device_unknown',
      message: 'No device has this id.',
    });
    expect(await rowsOf(kit.world, 'trail.position')).toHaveLength(before);
  });

  test('the command opens no effect, and its records carry no effect', async () => {
    const deviceId = await deviceOf(`watch-${form}`);
    const logged = kit.log.records.length;
    kit.trace.length = 0;
    await kit.call(form, action, { deviceId, fixes: [fix(10), fix(11)] });
    expect(kit.log.records).toHaveLength(logged);
    const events = await eventsOf(kit.world, 'trail.position', 'none');
    expect(events).toEqual([]);
    expect(kit.trace.filter((entry) => entry === 'unit:write')).toHaveLength(1);
  });
});

describe('both forms write the same thing for a command without an effect', () => {
  test('the same batch gives the same events, names and shapes', async () => {
    const left = await deviceOf('twin-left');
    const right = await deviceOf('twin-right');
    const batch = [fix(20), fix(21), fix(22)];
    await kit.call('separate', 'trail.ingestPositions', { deviceId: left, fixes: batch });
    await kit.call('inline', 'trail.ingestPositionsInline', { deviceId: right, fixes: batch });
    const shapeOf = async (id: string) =>
      (await eventsOf(kit.world, 'trail.device', id)).map((event) => ({
        type: event.type,
        version: event.version,
        data: event.data,
        reads: event.decision?.reads.length,
        answers: event.decision?.answers.length,
        effects: event.decision?.effects,
      }));
    const a = await shapeOf(left);
    const b = await shapeOf(right);
    expect(b.map((event) => event.type)).toEqual(a.map((event) => event.type));
    expect(b.at(-1)).toEqual(a.at(-1));
  });
});
