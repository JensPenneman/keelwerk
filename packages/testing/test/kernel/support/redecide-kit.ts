import type { DataAdapter, Registry, Span } from '@keelwerk/core';
import { createComputePool, normalizeRule } from '@keelwerk/core';
import { redecide } from '@keelwerk/core/replay';
import { behaviours } from './command-kit.ts';
import { deriveOnlyKeys } from './derive-only-keys.ts';
import { clock, namespace, silent, tenant } from './run-read-kit.ts';

/** Re-decides a command that `runDirect` ran, over the same adapter and keys; `input` absent takes what the record kept. */
export async function redecideDirect(input: {
  readonly registry: Registry;
  readonly adapter: DataAdapter;
  readonly commandId: string;
  readonly input?: unknown;
  readonly request?: Parameters<typeof redecide>[0]['request'];
}) {
  const compute = createComputePool({ size: 1 });
  try {
    return await redecide({
      registry: input.registry,
      adapter: input.adapter,
      namespace,
      scope: tenant,
      commandId: input.commandId,
      ...(input.input === undefined ? {} : { input: input.input }),
      ...(input.request === undefined ? {} : { request: input.request }),
      apiVersion: '2026-11-04',
      behaviours,
      rules: [...input.registry.rules.values()]
        .filter((rule) => rule.disabled !== true)
        .map(normalizeRule),
      keys: deriveOnlyKeys,
      compute,
      clock,
      log: silent,
      trace: {} as Span,
      concurrentUnits: true,
    });
  } finally {
    await compute.close();
  }
}
