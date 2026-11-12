import type { Unit } from '@keelwerk/core';
import {
  isProcessStream,
  openEffectInput,
  openPersonalMembers,
  openStoredEvents,
  openStoredRecords,
} from '@keelwerk/core';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { DumpQuery } from '../../../src/index.ts';
import type { erasureDumpApp } from './erasure-probe-module.ts';

type Runtime = TestRuntime<typeof erasureDumpApp>;

interface StoredRun {
  readonly action?: unknown;
  readonly input?: unknown;
  readonly commandId?: unknown;
}

const lost = 'The stored input of this job can no longer be read.';

/** The `run` document of every row of `kw_jobs`, in every database the deployment spans. */
async function storedRuns(queries: readonly DumpQuery[]): Promise<readonly StoredRun[]> {
  const runs: StoredRun[] = [];
  for (const query of queries) {
    const schemas = await query(`select schemaname from pg_tables where tablename = 'kw_jobs'`);
    for (const { schemaname } of schemas) {
      for (const row of await query(`select input from "${String(schemaname)}"."kw_jobs"`)) {
        const input =
          typeof row.input === 'string' ? (JSON.parse(row.input) as unknown) : row.input;
        if (typeof input === 'object' && input !== null) runs.push(input as StoredRun);
      }
    }
  }
  return runs;
}

/** The text a reader found, or `undefined` when the value reads as absent. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** What each kernel reader recovers for the markers the plain readers of a row cannot reach. */
export interface RecoveredMarkers {
  /** The `address` member of the stored input of the `probe.subscribe` job. */
  readonly address: string | undefined;
  /** The `address` member of the stored input of the `probe.defer` job, still in the queue. */
  readonly deadAddress: string | undefined;
  /** The `address` member of the stored input of the timer that runs `probe.defer`. */
  readonly timed: string | undefined;
  /** The `to` member of the sealed input of the `probe.deliver` effect record. */
  readonly deliver: string | undefined;
  /** The personal tag of the notes stream of the thread. */
  readonly tag: string | undefined;
  /** The `note` of the relay process's state stream. */
  readonly contact: string | undefined;
}

/**
 * Opens each planted marker through the kernel's own reader of its path, in a tenant unit of the
 * sealing layer: the personal members of the stored job inputs (`openPersonalMembers`), the sealed
 * input of the effect record (`openEffectInput`), the notes stream (`unit.streams.read`) and the
 * process state stream (`openStoredEvents`). Run before the erasure every one recovers its marker;
 * run after it none does, whether the key is gone or the record was purged.
 */
export async function recoverMarkers(
  runtime: Runtime,
  queries: readonly DumpQuery[],
  adaThread: string,
): Promise<RecoveredMarkers> {
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme?.id ?? '',
  } as const;
  const inTenant = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.sealed.unit(runtime.namespace, scope, fn);
  const { registry } = runtime.app;
  const runs = await storedRuns(queries);

  /** The member of the first stored input of `action` whose job is (or is not) a timer. */
  const memberOf = (action: string, member: string, timer = false): Promise<string | undefined> =>
    inTenant(async (unit) => {
      const entry = registry.actions.get(action);
      for (const run of runs) {
        if (run.action !== action || typeof run.commandId !== 'string' || entry === undefined) {
          continue;
        }
        if (run.commandId.startsWith('kernel:timer:') !== timer) continue;
        try {
          const opened = await openPersonalMembers(
            unit,
            { id: run.commandId, lost },
            entry.input,
            run.input,
          );
          const value = textOf((opened as Record<string, unknown>)[member]);
          if (value !== undefined) return value;
        } catch {
          // A destroyed key reads as absent: the job cannot be opened.
        }
      }
      return undefined;
    });

  const deliver = await inTenant(async (unit) => {
    const effect = registry.effects.get('probe.deliver');
    const record = registry.entities.get('core.effect');
    if (effect === undefined || record === undefined) throw new Error('the registry lacks entries');
    for (const row of (await unit.rows.find(record.descriptor, {})).rows) {
      if (row.type !== 'probe.deliver' || typeof row.input !== 'object' || row.input === null) {
        continue;
      }
      const opened = await openEffectInput(
        unit,
        effect,
        String(row.id),
        row.input as Record<string, unknown>,
      );
      return textOf(opened.input.to);
    }
    return undefined;
  });

  const tag = await inTenant(async (unit) => {
    const stored = await unit.streams.read('probe.notes', adaThread, null, 100);
    // The reader of a stream opens the personal members under the keyed row's subject.
    const records = await openStoredRecords(unit, {
      stream: 'probe.notes',
      key: adaThread,
      personal: ['tags'],
      records: stored,
    });
    for (const record of records) {
      const tags = (record.data as { tags?: unknown } | null)?.tags;
      if (Array.isArray(tags) && typeof tags[0] === 'string') return tags[0];
    }
    return undefined;
  });

  const contact = await inTenant(async (unit) => {
    const events = (await unit.events.readAll(null, { limit: 1000 })).events.filter((event) =>
      isProcessStream(registry, event.stream.type),
    );
    for (const event of await openStoredEvents(unit, events)) {
      const note = textOf((event.data as { note?: unknown } | null)?.note);
      if (note !== undefined && note !== '(gone)') return note;
    }
    return undefined;
  });

  return {
    address: await memberOf('probe.subscribe', 'address'),
    deadAddress: await memberOf('probe.defer', 'address'),
    timed: await memberOf('probe.defer', 'address', true),
    deliver,
    tag,
    contact,
  };
}
