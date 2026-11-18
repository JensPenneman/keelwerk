import type { CommandResult, Principal } from '@keelwerk/core';
import { deriveHkdf, normalizeRule, runCommand } from '@keelwerk/core';
import type { BenchWorld } from './bench-world.ts';
import { nextCommandId } from './next-command-id.ts';

/**
 * The one key the spike's commands derive their secrets from; a write derives them before its unit
 * opens.
 */
const derivedKey = (scope: unknown, info: string, length: number) =>
  Promise.resolve(deriveHkdf(new Uint8Array(32).fill(7), JSON.stringify(scope), info, length));

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

/** Runs one command below the pipeline's gate, through the interpreter and the write path of the core. */
export function runBenchCommand(
  world: BenchWorld,
  action: string,
  input: unknown,
): Promise<CommandResult> {
  const { registry } = world;
  const entry = registry.actions.get(action);
  if (entry === undefined) throw new Error(`the bench app has no ${action}`);
  return runCommand({
    registry,
    adapter: world.runtime.adapter,
    namespace: world.namespace,
    scope: world.scope,
    action: entry,
    input,
    principal,
    request: { transport: 'test', requestId: 'req-1' },
    clock: { now: () => Temporal.Now.instant() },
    keys: { derive: derivedKey } as never,
    compute: {} as never,
    log: silent,
    trace: {} as never,
    rules: [...registry.rules.values()].filter((rule) => rule.disabled !== true).map(normalizeRule),
    apiVersion: '2026-11-04',
    build: { id: 'spike', revision: 1 },
    behaviours: world.behaviours,
    commandId: nextCommandId(),
    concurrentUnits: true,
    retry: { sleep: async () => undefined },
  });
}
