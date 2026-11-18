import type {
  Carrier,
  DataAdapter,
  DataAdapterFactory,
  Invoker,
  NamespaceRef,
  Runtime,
  StorageScope,
  Unit,
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
  let deploymentId = '';
  let found: { adapter: DataAdapter; namespace: NamespaceRef; scope: StorageScope } | undefined;
  /** The adapter and namespace that served the units of each tenant: a placement has its own store. */
  const tenants = new Map<string, { adapter: DataAdapter; namespace: NamespaceRef }>();
  const factory: DataAdapterFactory = {
    ...real,
    create: (placement, env) => {
      const adapter = real.create(placement, env);
      deploymentId = env.deploymentId;
      const open = adapter.unit.bind(adapter);
      adapter.unit = (namespace, scope, fn, options) => {
        if (scope.level === 'deployment') found = { adapter, namespace, scope };
        if (scope.level === 'tenant') tenants.set(scope.tenantId, { adapter, namespace });
        return open(namespace, scope, fn, options);
      };
      return adapter;
    },
  };
  return {
    factory,
    /** The deployment id, which scopes the receipts of deployment-scope commands. */
    deployment: () => deploymentId,
    stream: (type: string, id: string) => {
      if (found === undefined) throw new Error('the control store was not opened');
      const { adapter, namespace, scope } = found;
      return adapter.unit(namespace, scope, (unit) => unit.events.readStream({ type, id }));
    },
    /** Runs `fn` in a unit of a tenant, over the raw store of the placement that serves it. */
    inTenant: <T>(
      scope: Extract<StorageScope, { level: 'tenant' }>,
      fn: (unit: Unit) => Promise<T>,
    ): Promise<T> => {
      const owner = tenants.get(scope.tenantId);
      if (owner === undefined) throw new Error('no unit of the tenant was opened');
      return owner.adapter.unit(owner.namespace, scope, fn);
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

/** An operator call over the in-process carrier with a command id, as the operator socket makes it. */
export function callWithId(
  invoker: Invoker,
  action: string,
  input: unknown,
  commandId: string,
  carrier: Carrier = local,
) {
  return invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier,
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
    commandId,
  });
}
