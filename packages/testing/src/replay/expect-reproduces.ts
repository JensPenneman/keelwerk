import { entityBehavioursOf, normalizeRule } from '@keelwerk/core';
import type { RedecideResult } from '@keelwerk/core/replay';
import { redecide } from '@keelwerk/core/replay';
import { expect } from 'vitest';
import { drivePrincipal } from '../drive/drive-principal.ts';
import type { TestApp } from '../harness/test-app.ts';
import type { TestRuntime } from '../harness/test-runtime.ts';
import type { ExpectReproducesOptions } from './expect-reproduces-options.ts';
import { replayCompute } from './replay-compute.ts';
import { replayKeys } from './replay-keys.ts';
import { tenantAddress } from './tenant-address.ts';

/**
 * Asserts that a recorded command re-decides to exactly what was stored (exit criterion 8): the
 * handler of the current build is run with its loads answered as of the recorded positions and
 * its ids from the record, and its events, effects, decision record and flags must equal the
 * stored ones. Nothing is committed. A failure lists every difference; the result is returned
 * for tests that look closer.
 */
export async function expectReproduces(
  runtime: TestRuntime<TestApp>,
  options: ExpectReproducesOptions,
): Promise<RedecideResult> {
  const { app } = runtime;
  const address = tenantAddress(runtime, options.tenant);
  const result = await redecide({
    registry: app.registry,
    adapter: runtime.adapter,
    namespace: address.namespace,
    scope: address.scope,
    commandId: options.commandId,
    input: options.input,
    apiVersion: runtime.head,
    behaviours: entityBehavioursOf(app.modules),
    rules: [...app.registry.rules.values()]
      .filter((rule) => rule.disabled !== true)
      .map(normalizeRule),
    keys: replayKeys,
    compute: replayCompute,
    log: runtime.log,
    trace: runtime.tracer.startSpan('redecide'),
    ...(options.principal === undefined
      ? {}
      : { principal: drivePrincipal(options.principal, address.scope) }),
  });
  expect(result.differences, `re-deciding ${result.part} (${options.commandId})`).toEqual([]);
  return result;
}
