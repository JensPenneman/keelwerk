import type { Scope, StorageRow, Unit } from '@keelwerk/core';
import { deriveEffectId, parseSealedValueText } from '@keelwerk/core';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import { secretsApp } from './effect-secrets-app.ts';
import { jobSpy } from './job-spy.ts';

export const secretsStart = Temporal.Instant.from('2026-03-01T08:00:00Z');

/**
 * The vault app with workers and one tenant, a clock fixed at `secretsStart` that `advance` moves.
 * With `watched` (memory only) the job store goes through a spy a test can hold or fail.
 * Pushes what has to be closed onto `cleanup`.
 */
export async function bootSecretVault(
  options: { readonly adapter: 'memory' | 'pglite'; readonly watched?: boolean },
  cleanup: (() => Promise<void>)[],
) {
  const descriptors = new Map(
    [...secretsApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const watched = jobSpy((ref) => descriptors.get(ref));
  const runtime = await startTestRuntime(secretsApp, {
    tenants: ['acme'],
    workers: true,
    clock: { now: () => secretsStart },
    ...(options.watched === true
      ? { external: { factory: watched.factory, url: 'memory://watched' } }
      : { adapter: options.adapter }),
  });
  cleanup.push(() => runtime.stop());
  const scope: Scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const raw = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.adapter.unit(runtime.namespace, scope, fn);
  const call = (action: string, input: unknown, commandId = crypto.randomUUID()) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input,
      carrier: testCarrier(runtime.tenants.acme, testPrincipal('ada')),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
  /** Lets the workers finish what is due: an effect job, its retry, its continuation. */
  const drain = async (): Promise<void> => {
    for (let round = 0; round < 6; round += 1) await runtime.drainJobs();
  };
  /** Opens an effect (`external`: for an outside performer) with two secrets; answers its id. */
  const open = async (mode: string, over: Record<string, unknown> = {}): Promise<string> => {
    const commandId = crypto.randomUUID();
    const outcome = await call(
      'vault.open',
      { mode, key: 'key marker', backup: 'backup marker', ...over },
      commandId,
    );
    if (!outcome.ok) throw new Error(`open refused: ${JSON.stringify(outcome)}`);
    return deriveEffectId(scope, commandId, 0);
  };
  const rows = async (entity: string): Promise<readonly StorageRow[]> => {
    const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
    if (descriptor === undefined) throw new Error(`no entity ${entity}`);
    return runtime.sealed.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.rows.find(descriptor, { includeArchived: true })).rows,
    );
  };
  const effectRow = async (id: string): Promise<StorageRow> => {
    const row = (await rows('core.effect')).find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error(`no effect ${id}`);
    return row;
  };
  /** The attempt records of an effect, in order. */
  const attemptRecords = (id: string): Promise<readonly Record<string, unknown>[]> =>
    raw(async (unit) =>
      (await unit.streams.read('core.effectAttempt', id, null, 100)).map(
        (stored) => stored.data as Record<string, unknown>,
      ),
    );
  /** Whether the value key of the sealed text still opens it (below the sealing layer, bound to nothing). */
  const opens = (text: unknown): Promise<boolean> => {
    const sealed = parseSealedValueText(String(text));
    if (sealed === undefined) throw new Error(`not a sealed text: ${String(text)}`);
    return raw(async (unit) => (await unit.keys.openValue(sealed)) !== undefined);
  };
  /** The sealed texts of the secret members of an effect row. */
  const texts = (row: StorageRow) => {
    const input = row.input as { key: string; backup: string };
    const output = row.output as { seal?: string } | undefined;
    return { key: input.key, backup: input.backup, seal: output?.seal };
  };
  return {
    runtime,
    scope,
    raw,
    call,
    drain,
    open,
    rows,
    effectRow,
    attemptRecords,
    opens,
    texts,
    advance: (seconds: number) => runtime.advanceTo(secretsStart.add({ seconds })),
    spy: watched.spy,
  };
}

export type BootedSecretVault = Awaited<ReturnType<typeof bootSecretVault>>;
