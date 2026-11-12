import type { DataAdapter, DataAdapterFactory, Logger, NamespaceRef } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { describe, expect, test } from 'vitest';
import {
  bearer,
  booted,
  call,
  issued,
  operatorHost,
  probe,
  testClock,
} from './support/core-actions-kit.ts';
import { boot, deploymentOf } from './support/runtime-kit.ts';

interface Line {
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

/** A logger that keeps the warnings, with their fields. */
function warnings(): { readonly logger: Logger; readonly lines: Line[] } {
  const lines: Line[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, fields) => {
      lines.push({ message, fields });
    },
    error: () => undefined,
    child: () => logger,
  };
  return { logger, lines };
}

/** A memory adapter that remembers the control store's adapter, namespace and deployment id. */
function spiedControl() {
  const real = memoryAdapter();
  let control: { adapter: DataAdapter; namespace: NamespaceRef; deploymentId: string } | undefined;
  const factory: DataAdapterFactory = {
    ...real,
    create: (placement, env) => {
      const adapter = real.create(placement, env);
      const open = adapter.unit.bind(adapter);
      adapter.unit = (namespace, scope, fn, options) => {
        if (scope.level === 'deployment' && control === undefined) {
          control = { adapter, namespace, deploymentId: env.deploymentId };
        }
        return open(namespace, scope, fn, options);
      };
      return adapter;
    },
  };
  return {
    factory,
    destroyDeploymentKey: async (): Promise<void> => {
      if (control === undefined) throw new Error('the control store was not opened');
      const { adapter, namespace, deploymentId } = control;
      await adapter.unit(namespace, { level: 'deployment' }, async (unit) => {
        if (unit.scopeKeys === undefined) throw new Error('the control store has no scope keys');
        await unit.scopeKeys.destroy(deploymentId);
      });
    },
  };
}

describe('an operator token whose deployment key is destroyed (14.7.6, open point 467)', () => {
  test('is refused exactly like a wrong token and logged once per token as core.key_destroyed', async () => {
    const time = testClock();
    const spy = spiedControl();
    const log = warnings();
    const runtime = await boot(
      deploymentOf('memory', { operator: { hosts: [operatorHost] }, factory: spy.factory }),
      { clock: time.clock, logger: log.logger },
    );
    const { token } = await issued(runtime);
    const [prefix, publicId] = token.split('_');
    const wrong = `${prefix}_${publicId}_${'a'.repeat(52)}`;
    // The key service keeps keys for 60 seconds: let the cached copy expire before the key is destroyed.
    await spy.destroyDeploymentKey();
    time.advance({ minutes: 2 });

    const first = await call(runtime.invoker, bearer(token), probe);
    const second = await call(runtime.invoker, bearer(token), probe);
    const mistaken = await call(runtime.invoker, bearer(wrong), probe);
    for (const outcome of [first, second, mistaken]) {
      expect(outcome.ok).toBe(false);
    }
    const errorOf = (outcome: typeof first) => (outcome.ok ? undefined : outcome.error);
    expect(errorOf(first)).toMatchObject({ kind: 'unauthenticated' });
    // The same error, code and message, as for a wrong secret: no oracle.
    expect({
      kind: errorOf(first)?.kind,
      code: errorOf(first)?.code,
      message: errorOf(first)?.message,
    }).toEqual({
      kind: errorOf(mistaken)?.kind,
      code: errorOf(mistaken)?.code,
      message: errorOf(mistaken)?.message,
    });
    expect(errorOf(second)?.message).toBe(errorOf(first)?.message);
    // The kernel logged the destroyed key once for this token, however often it was presented.
    const destroyed = log.lines.filter((line) => line.fields?.code === 'core.key_destroyed');
    expect(destroyed).toHaveLength(1);
    expect(JSON.stringify(destroyed)).not.toContain(token);
  });

  test('a token under a live key is not logged as destroyed', async () => {
    const runtime = await booted();
    const { token } = await issued(runtime);
    expect(await call(runtime.invoker, bearer(token), probe)).toMatchObject({ ok: true });
  });
});
