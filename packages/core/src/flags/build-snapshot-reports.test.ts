import { describe, expect, test } from 'vitest';
import { snapshotInput } from '../../test/flag-snapshot-kit.ts';
import { buildSnapshot } from './build-snapshot.ts';
import { createFlagTelemetry } from './create-flag-telemetry.ts';
import type { FlagProvider } from './flag-provider.ts';
import type { FlagTelemetry } from './flag-telemetry.ts';

describe('what buildSnapshot reports', () => {
  test('each read is counted on keelwerk.flags.evaluations with flag, variant and reason', async () => {
    const points: { value: number; attributes: unknown }[] = [];
    const names: string[] = [];
    const meter = {
      createCounter: (name: string) => {
        names.push(name);
        return {
          add: (value: number, attributes: unknown) => {
            points.push({ value, attributes });
          },
        };
      },
    } as never;
    const telemetry: FlagTelemetry = createFlagTelemetry(meter);
    const { input: built } = snapshotInput([]);
    const snapshot = await buildSnapshot({ ...built, telemetry });
    snapshot.read('shop.checkout');
    snapshot.read('shop.checkout');
    expect(names).toEqual(['keelwerk.flags.evaluations']);
    expect(points).toEqual([
      {
        value: 1,
        attributes: { flag: 'shop.checkout', variant: 'false', reason: 'DEFAULT', backend: 'b1' },
      },
    ]);
  });

  test('the span carries keelwerk.flags', async () => {
    const attributes: [string, unknown][] = [];
    const span = {
      setAttribute: (name: string, value: unknown) => {
        attributes.push([name, value]);
      },
    };
    const { input: built } = snapshotInput([]);
    const snapshot = await buildSnapshot({ ...built, span: span as never });
    snapshot.read('shop.banner');
    snapshot.read('shop.checkout');
    expect(attributes.at(-1)).toEqual([
      'keelwerk.flags',
      ['shop.banner=default', 'shop.checkout=false'],
    ]);
  });

  test('telemetry and the span never carry the value of a string flag, only where the answer came from', async () => {
    const served = 'https://internal.example/banner';
    const targeting: FlagProvider = {
      id: 'core.targeting',
      sync: true,
      start: () => Promise.resolve(),
      resolve: <T>(flag: { readonly key: string }) =>
        flag.key === 'shop.banner'
          ? ({
              value: served,
              variant: served,
              reason: 'TARGETING_MATCH',
              ruleId: 'pilot',
              provider: 'core.targeting',
            } as never as T)
          : undefined,
    };
    const points: { attributes: unknown }[] = [];
    const meter = {
      createCounter: () => ({
        add: (_value: number, attributes: unknown) => {
          points.push({ attributes });
        },
      }),
    } as never;
    const attributes: [string, unknown][] = [];
    const span = {
      setAttribute: (name: string, value: unknown) => {
        attributes.push([name, value]);
      },
    };
    const { input: built } = snapshotInput([targeting]);
    const snapshot = await buildSnapshot({
      ...built,
      telemetry: createFlagTelemetry(meter),
      span: span as never,
    });
    expect(snapshot.read('shop.banner')).toMatchObject({ value: served, variant: served });
    snapshot.read('shop.checkout');
    expect(points.map((point) => point.attributes)).toEqual([
      { flag: 'shop.banner', variant: 'rule:pilot', reason: 'TARGETING_MATCH', backend: 'b1' },
      { flag: 'shop.checkout', variant: 'false', reason: 'DEFAULT', backend: 'b1' },
    ]);
    expect(attributes.at(-1)).toEqual([
      'keelwerk.flags',
      ['shop.banner=rule:pilot', 'shop.checkout=false'],
    ]);
    expect(JSON.stringify([points, attributes])).not.toContain('internal.example');
  });

  test('a value of the wrong type serves the default with TYPE_MISMATCH and logs at error level once per key', async () => {
    const wrong: FlagProvider = {
      id: 'wrong',
      sync: true,
      start: () => Promise.resolve(),
      resolve: <T>() =>
        ({ value: 'yes', variant: 'yes', reason: 'STATIC', provider: 'wrong' }) as never as T,
    };
    const { input: built, warnings } = snapshotInput([wrong]);
    const snapshot = await buildSnapshot(built);
    expect(snapshot.read('shop.checkout')).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'TYPE_MISMATCH',
      provider: 'wrong',
    });
    snapshot.read('shop.checkout');
    expect(warnings).toEqual([
      {
        flag: 'shop.checkout',
        provider: 'wrong',
        error: 'The value is not a boolean as "shop.checkout" declares (TYPE_MISMATCH).',
      },
    ]);
  });
});
