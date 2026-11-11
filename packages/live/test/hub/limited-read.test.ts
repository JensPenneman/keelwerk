import type { LiveKernel, Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { limitedRead } from '../../src/hub/limited-read.ts';
import type { StartLimiter } from '../../src/hub/start-limiter.ts';

/** A limiter that records the scope key it was asked for and runs the work when released. */
function holdingLimiter() {
  const asked: string[] = [];
  const gates: (() => void)[] = [];
  const limiter: StartLimiter = {
    run: async (scope, signal, work) => {
      asked.push(scope);
      if (signal.aborted) return undefined;
      await new Promise<void>((resolve) => gates.push(resolve));
      return signal.aborted ? undefined : work();
    },
  };
  return { limiter, asked, release: () => gates.shift()?.() };
}

function kernelOf(read: LiveKernel['read']): LiveKernel {
  return {
    scopeId: 'backend-1',
    audience: 'tenant-a',
    target: { namespace: { id: 'ns-1' } },
    read,
  } as unknown as LiveKernel;
}

describe('the start reads of a subscription', () => {
  test('wait for a slot of the scope (namespace, scope id and tenant) before the unit opens', async () => {
    const { limiter, asked, release } = holdingLimiter();
    let opened = 0;
    const read = limitedRead({
      kernel: kernelOf(async (fn) => {
        opened += 1;
        return fn({} as Unit);
      }),
      startUnits: limiter,
      abort: new AbortController(),
      pending: new Set(),
    });
    const result = read(async () => 'rows', { timeoutMs: 1000 });
    await Promise.resolve();
    expect(asked).toEqual(['ns-1\u0000backend-1\u0000tenant-a']);
    expect(opened).toBe(0);
    release();
    await expect(result).resolves.toBe('rows');
    expect(opened).toBe(1);
  });

  test('are tracked until the unit settles, and one that waited when the subscription ended is unavailable', async () => {
    const { limiter, release } = holdingLimiter();
    const pending = new Set<Promise<void>>();
    let finish: (() => void) | undefined;
    const abort = new AbortController();
    const read = limitedRead({
      kernel: kernelOf(
        () =>
          new Promise<never>((_resolve, reject) => {
            finish = () => reject(new Error('the unit ended'));
          }),
      ),
      startUnits: limiter,
      abort,
      pending,
    });
    const running = read(async () => 'rows', { timeoutMs: 1000 });
    running.catch(() => undefined);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending.size).toBe(1);
    finish?.();
    await expect(running).rejects.toThrow('the unit ended');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending.size).toBe(0);
    abort.abort();
    await expect(read(async () => 'rows', { timeoutMs: 1000 })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
