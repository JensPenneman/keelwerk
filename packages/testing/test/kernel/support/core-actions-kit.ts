import type {
  Carrier,
  DataAdapter,
  DataAdapterFactory,
  Invoker,
  NamespaceRef,
  Runtime,
  StorageScope,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { boot, deploymentOf } from './runtime-kit.ts';

export const local: Carrier = { transport: 'test', local: { inProcess: true } };
export const probe = 'core.operatorToken.query';
export const operatorHost = 'ops.example.test';
export const bearer = (token: string, host: string = operatorHost): Carrier => ({
  transport: 'http',
  host,
  headers: { authorization: `Bearer ${token}` },
});

export function testClock() {
  let now = Temporal.Instant.from('2026-11-05T10:00:00Z');
  return {
    clock: { now: () => now },
    advance: (by: Temporal.DurationLike) => {
      now = now.add(by);
    },
  };
}

export function call(invoker: Invoker, carrier: Carrier, action: string, input: unknown = {}) {
  return invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier,
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

export async function ok(work: ReturnType<typeof call>): Promise<Record<string, unknown>> {
  const outcome = await work;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export async function booted(clock = testClock().clock): Promise<Runtime> {
  return boot(deploymentOf('memory', { operator: { hosts: [operatorHost] } }), { clock });
}

/** A memory adapter that remembers where the deployment scope lives, so a test can read a raw stream. */
export function spiedMemory() {
  const real = memoryAdapter();
  let found: { adapter: DataAdapter; namespace: NamespaceRef; scope: StorageScope } | undefined;
  const factory: DataAdapterFactory = {
    ...real,
    create: (placement, env) => {
      const adapter = real.create(placement, env);
      const open = adapter.unit.bind(adapter);
      adapter.unit = (namespace, scope, fn, options) => {
        if (scope.level === 'deployment') found = { adapter, namespace, scope };
        return open(namespace, scope, fn, options);
      };
      return adapter;
    },
  };
  return {
    factory,
    stream: (type: string, id: string) => {
      if (found === undefined) throw new Error('the control store was not opened');
      const { adapter, namespace, scope } = found;
      return adapter.unit(namespace, scope, (unit) => unit.events.readStream({ type, id }));
    },
  };
}

export async function issued(
  runtime: Runtime,
  input: Record<string, unknown> = { label: 'laptop' },
) {
  const value = await ok(call(runtime.invoker, local, 'core.operatorToken.issue', input));
  return value as { id: string; token: string; expiresAt: Temporal.Instant };
}
