import { describe, expect, test } from 'vitest';
import { frameworkReady } from './framework-ready.ts';
import type { QueueSource } from './queue-source.ts';

function sourceOf(
  sql: false | { readonly dialect: 'postgres' } | undefined,
  history: readonly { readonly track: string; readonly id: string }[],
): QueueSource {
  const at = Temporal.Instant.from('2026-01-01T00:00:00Z');
  return {
    namespace: {
      id: 'ns-1',
      placementId: 'main',
      appId: 'library',
      tenantId: null,
      root: 'library',
    },
    handle: {
      adapter: {
        schema: {
          history: async () =>
            history.map((applied) => ({
              ...applied,
              checksum: 'x',
              appliedAt: at,
              stepsApplied: 1,
            })),
        },
      } as never,
      ...(sql === undefined ? {} : { capabilities: { sql } as never }),
    },
    registry: {} as never,
  };
}

describe('frameworkReady', () => {
  test('an adapter without SQL keeps no framework track and is ready', async () => {
    expect(await frameworkReady(sourceOf(false, []))).toBe(true);
  });

  test('a handle with no capabilities is read like a SQL one: ready only with step 0002', async () => {
    expect(await frameworkReady(sourceOf(undefined, []))).toBe(false);
    expect(
      await frameworkReady(sourceOf(undefined, [{ track: 'keelwerk.framework', id: '0002' }])),
    ).toBe(true);
  });

  test('step 0002 of the framework track makes a SQL namespace ready', async () => {
    const history = [
      { track: 'keelwerk.framework', id: '0001' },
      { track: 'keelwerk.framework', id: '0002' },
    ];
    expect(await frameworkReady(sourceOf({ dialect: 'postgres' }, history))).toBe(true);
  });

  test('step 0001 only, another track named 0002, or no history is behind', async () => {
    expect(
      await frameworkReady(
        sourceOf({ dialect: 'postgres' }, [{ track: 'keelwerk.framework', id: '0001' }]),
      ),
    ).toBe(false);
    expect(
      await frameworkReady(sourceOf({ dialect: 'postgres' }, [{ track: 'library', id: '0002' }])),
    ).toBe(false);
    expect(await frameworkReady(sourceOf({ dialect: 'postgres' }, []))).toBe(false);
  });
});
