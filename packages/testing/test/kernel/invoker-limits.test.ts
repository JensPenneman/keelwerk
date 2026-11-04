import type { DataAdapter } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { ada, byHeaderCarrier, call, failure, kit, publicQuery } from './support/invoker-kit.ts';
import type { ProbeContext } from './support/run-read-kit.ts';
import { book, bookRow, namespace, open, tenant } from './support/run-read-kit.ts';

describe('scope levels', () => {
  const backendProbe = publicQuery(
    'backendProbe',
    function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.load.library.book.count();
    },
    { scope: 'backend' },
  );

  test('a backend-scope action from a tenant principal reads no tenant entities', async () => {
    const { adapter, invoker } = kit({ registry: backendProbe.registry });
    await adapter.unit(namespace, tenant, (unit) => unit.rows.insert(book, [bookRow(1)]));
    const error = failure(await invoker.invoke(call(backendProbe.ref, {}, { carrier: ada })));
    expect(error.code).toBe('core.request_not_allowed');
  });

  test('the same read from a tenant-scope action works', async () => {
    const tenantProbe = publicQuery('tenantProbe', function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.load.library.book.count();
    });
    const { adapter, invoker } = kit({ registry: tenantProbe.registry });
    await adapter.unit(namespace, tenant, (unit) => unit.rows.insert(book, [bookRow(1)]));
    expect(await invoker.invoke(call(tenantProbe.ref, {}, { carrier: ada }))).toEqual({
      ok: true,
      value: 1,
    });
  });
});

describe('timeouts and cancellation', () => {
  const slow = (adapter: DataAdapter): DataAdapter => ({
    ...adapter,
    unit: async (ns, scope, fn, options) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return adapter.unit(ns, scope, fn, options);
    },
  });

  test('a query past its timeout is unavailable with core.timeout', async () => {
    const probe = publicQuery('slowRead', () => 1, { timeoutMs: 10 });
    const { invoker } = kit({ registry: probe.registry, adapter: slow(open()) });
    const outcome = await invoker.invoke(call(probe.ref, {}, { carrier: byHeaderCarrier }));
    expect(failure(outcome)).toMatchObject({ kind: 'unavailable', code: 'core.timeout' });
  });

  test('a client abort during a read ends the read-only unit promptly', async () => {
    let reading: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const probe = publicQuery('abortedRead', () => 1);
    const inner = open();
    let finished: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    let ended = false;
    let units = 0;
    const watched: DataAdapter = {
      ...inner,
      unit: async (ns, scope, fn, options) => {
        units += 1;
        if (units === 1) return inner.unit(ns, scope, fn, options);
        return inner.unit(
          ns,
          scope,
          async (unit) => {
            // The head read never answers by itself: only the abort can end the unit.
            const stuck = {
              ...unit,
              events: {
                ...unit.events,
                head: () => {
                  reading();
                  return new Promise<never>(() => undefined);
                },
              },
            } as typeof unit;
            try {
              return await fn(stuck);
            } finally {
              ended = true;
              finished();
            }
          },
          options,
        );
      },
    };
    const { invoker } = kit({ registry: probe.registry, adapter: watched });
    const controller = new AbortController();
    const pending = invoker.invoke(
      call(probe.ref, {}, { carrier: byHeaderCarrier, signal: controller.signal }),
    );
    await started;
    expect(ended).toBe(false);
    controller.abort();
    expect(failure(await pending).kind).toBe('unavailable');
    const outcome = await Promise.race([
      done.then(() => 'ended'),
      new Promise((resolve) => setTimeout(resolve, 1000, 'open')),
    ]);
    expect(outcome).toBe('ended');
    expect(ended).toBe(true);
  });

  test('a client abort never aborts a command', async () => {
    const probe = publicQuery('abortedCommand', () => 1, { kind: 'command' });
    const controller = new AbortController();
    let sawAbort = false;
    const { invoker } = kit({
      registry: probe.registry,
      commands: async (run) => {
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 20));
        sawAbort = run.signal.aborted;
        return {
          output: 'done',
          receipt: { commandId: 'c1', status: 'accepted' },
          effects: ['e1'],
        };
      },
    });
    const outcome = await invoker.invoke(
      call(probe.ref, {}, { carrier: byHeaderCarrier, signal: controller.signal }),
    );
    expect(sawAbort).toBe(false);
    expect(outcome).toEqual({
      ok: true,
      value: 'done',
      receipt: { commandId: 'c1', status: 'accepted' },
      effects: ['e1'],
    });
  });

  test('a command past its timeout that rolls back on the abort is unavailable with core.timeout', async () => {
    const probe = publicQuery('slowCommand', () => 1, { kind: 'command', timeoutMs: 10 });
    let aborted = false;
    const { invoker } = kit({
      registry: probe.registry,
      commands: (run) =>
        new Promise((_resolve, reject) => {
          run.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('rolled back'));
          });
        }),
    });
    const outcome = await invoker.invoke(call(probe.ref, {}, { carrier: byHeaderCarrier }));
    expect(failure(outcome)).toMatchObject({ kind: 'unavailable', code: 'core.timeout' });
    expect(aborted).toBe(true);
  });

  test('a command that committed while the timer fired answers its result', async () => {
    const probe = publicQuery('racedCommand', () => 1, { kind: 'command', timeoutMs: 10 });
    const { invoker } = kit({
      registry: probe.registry,
      commands: async (run) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(run.signal.aborted).toBe(true);
        return { output: 'committed', receipt: { commandId: 'c2', status: 'accepted' } };
      },
    });
    const outcome = await invoker.invoke(call(probe.ref, {}, { carrier: byHeaderCarrier }));
    expect(outcome).toEqual({
      ok: true,
      value: 'committed',
      receipt: { commandId: 'c2', status: 'accepted' },
    });
  });
});

describe('undeclared exceptions', () => {
  const boom = publicQuery('boom', () => {
    throw new Error('connection string postgres://secret');
  });
  const module = publicQuery(
    'moduleError',
    () => {
      throw new KeelwerkError({
        kind: 'conflict',
        code: 'library.secret_code',
        message: 'undeclared',
      });
    },
    { errors: ['library.isbn_taken'] },
    boom.registry,
  );
  const declared = publicQuery(
    'declaredError',
    () => {
      throw new KeelwerkError({ kind: 'conflict', code: 'library.isbn_taken', message: 'taken' });
    },
    { errors: ['library.isbn_taken'] },
    module.registry,
  );

  test('outside development an undeclared exception is a redacted internal error', async () => {
    const { invoker } = kit({ registry: declared.registry, environment: 'production' });
    const error = failure(await invoker.invoke(call(boom.ref, {}, { carrier: byHeaderCarrier })));
    expect(error).toMatchObject({ kind: 'internal', code: 'core.internal' });
    expect(error.message).not.toContain('secret');
    expect(error.cause).toBeInstanceOf(Error);
  });

  test('development shows the message', async () => {
    const { invoker } = kit({ registry: declared.registry, environment: 'development' });
    const error = failure(await invoker.invoke(call(boom.ref, {}, { carrier: byHeaderCarrier })));
    expect(error.message).toContain('postgres://secret');
  });

  test('an error the action does not declare is internal, one it declares passes', async () => {
    const { invoker } = kit({ registry: declared.registry, environment: 'production' });
    const hidden = failure(
      await invoker.invoke(call(module.ref, {}, { carrier: byHeaderCarrier })),
    );
    expect(hidden).toMatchObject({ kind: 'internal', code: 'core.internal' });
    const shown = failure(
      await invoker.invoke(call(declared.ref, {}, { carrier: byHeaderCarrier })),
    );
    expect(shown).toMatchObject({ kind: 'conflict', code: 'library.isbn_taken' });
  });
});
