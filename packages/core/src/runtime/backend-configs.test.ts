import { describe, expect, test } from 'vitest';
import type { ControlStore } from '../control/control-store.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Scope } from '../storage/scope.ts';
import { backendConfigs } from './backend-configs.ts';

const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as unknown as Scope;

function fixture(options: { failAfterFirst?: boolean } = {}) {
  let now = 1000;
  const reads: string[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = {
    entity: (ref: string) => ref,
    read: async (fn: (unit: unknown) => Promise<unknown>) =>
      fn({
        rows: {
          find: async (ref: string) => {
            reads.push(ref);
            if (options.failAfterFirst === true && reads.length > 2) throw new Error('down');
            await gate;
            return {
              rows:
                ref === 'core.backend'
                  ? [{ config: { rest: { cors: ['https://a'] } } }]
                  : [{ hostname: 'a.test' }],
            };
          },
        },
      }),
  } as unknown as ControlStore;
  const invoker = {
    open: async () => ({ ok: true, value: { scope } }),
  } as unknown as Invoker;
  const configs = backendConfigs(store, {
    now: () => ({ epochMilliseconds: now }) as unknown as Temporal.Instant,
  });
  return {
    reads,
    configs,
    open: () => configs.around(invoker).open({} as never, {} as never),
    release: () => release?.(),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('backendConfigs', () => {
  test('requests that open one scope together share one read per key', async () => {
    const f = fixture();
    const opening = Promise.all([f.open(), f.open(), f.open()]);
    f.release();
    await opening;
    expect(f.reads.toSorted()).toEqual(['core.backend', 'core.domain']);
    expect(f.configs.domainsOf(scope)).toEqual(['a.test']);
  });

  test('an expired entry is dropped on load, so a failed read does not serve it again', async () => {
    const f = fixture({ failAfterFirst: true });
    f.release();
    await f.open();
    expect(f.configs.configOf('rest')(scope)).toEqual({ cors: ['https://a'] });
    f.advance(5000);
    await expect(f.open()).rejects.toThrow('down');
    expect(f.configs.configOf('rest')(scope)).toBeUndefined();
  });
});
