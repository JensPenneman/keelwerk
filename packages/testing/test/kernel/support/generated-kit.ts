import type { Runtime } from '@keelwerk/core';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { ada, boot, deploymentOf, type Kind } from './runtime-kit.ts';

export async function tenantOf(kind: Kind, name = 'acme') {
  const runtime = await boot(deploymentOf(kind));
  const backend = await runtime.control.createBackend({
    name: 'library',
    app: 'library',
    placement: 'main',
  });
  const tenant = await runtime.control.createTenant({ backendId: backend.id, name });
  return { runtime, tenant, backend };
}

export function caller(runtime: Runtime, tenant: { id: string }, who = ada) {
  return async <O>(action: string, input: unknown, commandId?: string) => {
    const outcome = await runtime.invoker.invoke<unknown, O>({
      action,
      input,
      carrier: testCarrier({ name: 'acme', id: tenant.id }, who),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      ...(commandId === undefined ? {} : { commandId }),
    });
    return outcome;
  };
}

export async function value<O>(
  work: Promise<{ ok: boolean; value?: O; error?: unknown }>,
): Promise<O> {
  const outcome = await work;
  if (!outcome.ok) throw outcome.error;
  return outcome.value as O;
}
