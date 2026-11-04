import type { CommandResult, DataAdapter, Principal } from '@keelwerk/core';
import { normalizeRule, runCommand } from '@keelwerk/core';
import type { InlineEffectStub } from './inline-effect-stub.ts';
import { runInlineVariant } from './run-inline-variant.ts';
import type { SpikeWorld } from './start-spike-world.ts';

const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};
const principal = {
  kind: 'user',
  subject: 'ada',
  subjectRef: null,
  subjectAs: () => null,
  scope: { backend: '00000000-0000-4000-8000-0000000000b1', tenant: null },
  claims: {},
  roles: [],
  memberships: [],
  via: 'test',
  ref: null,
} as unknown as Principal;

/** Which form to run a command in, and what it runs with. */
export interface CallOptions {
  readonly form: 'separate' | 'inline';
  readonly action: string;
  readonly input: unknown;
  readonly commandId: string;
  readonly stub: InlineEffectStub;
  /** An adapter wrapping the runtime's, for counting units. */
  readonly adapter?: DataAdapter;
  readonly retry?: { readonly sleep: (ms: number) => Promise<void> };
}

/** Runs one command below the pipeline's gate, in the chosen form. */
export function runCall(world: SpikeWorld, call: CallOptions): Promise<CommandResult> {
  const { registry } = world;
  const action = registry.actions.get(call.action);
  if (action === undefined) throw new Error(`the spike app has no ${call.action}`);
  const input = {
    registry,
    adapter: call.adapter ?? world.runtime.adapter,
    namespace: world.namespace,
    scope: world.scope,
    action,
    input: call.input,
    principal,
    request: { transport: 'test', requestId: 'req-1' },
    clock: { now: () => Temporal.Instant.from('2026-11-04T10:00:00Z') },
    keys: {} as never,
    compute: {} as never,
    log: silent,
    trace: {} as never,
    rules: [...registry.rules.values()].filter((rule) => rule.disabled !== true).map(normalizeRule),
    apiVersion: '2026-11-04',
    build: { id: 'spike', revision: 1 },
    behaviours: world.behaviours,
    commandId: call.commandId,
    concurrentUnits: true,
    retry: call.retry ?? { sleep: async () => undefined },
    replace: { perform: call.stub.answer },
  };
  return call.form === 'inline' ? runInlineVariant(input) : runCommand(input);
}
