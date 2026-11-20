import {
  contracts,
  defineApiVersions,
  defineApp,
  defineTransportModule,
  field,
  type Invocation,
  type LiveFrame,
  type MountContext,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';
import type { TestApp } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { createOrpcAdapter } from '../../src/create-orpc-adapter.ts';
import type { OrpcConfig } from '../../src/orpc-config.ts';

/**
 * The fixture modules with an oRPC module whose invoker records the signal of every subscription
 * it opens in `signals`: the host gives a transport its invoker at mount, so this is the one place
 * a test can see whether the invocation of a stream was aborted. With `scripted`, the frames of a
 * subscription are the ones it yields instead of the hub's.
 */
export function orpcSpyApp(
  signals: AbortSignal[],
  scripted?: (invocation: Invocation<unknown>) => AsyncIterable<LiveFrame<unknown>>,
): TestApp {
  const adapter = createOrpcAdapter();
  const spy = defineTransportModule({
    id: 'orpc',
    requires: [contracts.httpHost],
    config: shape({ cors: field.list(field.string()).default([]) }),
    transport: {
      ...adapter,
      mount: (ctx: MountContext<OrpcConfig>) =>
        adapter.mount({
          ...ctx,
          invoker: {
            ...ctx.invoker,
            subscribe: (invocation, options) => {
              signals.push(invocation.signal);
              return scripted === undefined
                ? ctx.invoker.subscribe(invocation, options)
                : (scripted(invocation) as never);
            },
          },
        }),
    },
  });
  return defineApp({
    id: 'orpc-spy',
    modules: [live, library, loans, spy],
    execution: { 'loans.lend': 'either' },
    api: defineApiVersions({ '2026-11-11': {} }),
  });
}
