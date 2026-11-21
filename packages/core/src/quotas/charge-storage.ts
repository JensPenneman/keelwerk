import { errors } from '../errors/errors.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { UsageCharge } from '../storage/usage-charge.ts';
import type { WrittenRow } from '../write-path/written-row.ts';
import type { QuotaLimits } from './quota-limits.ts';

/**
 * What a command's writes cost and what it may not exceed (12.2).
 *
 * `core.eventBytes` means: the bytes of every record that work done for a tenant stores in the
 * event store and that stays there until retention or erasure removes it. That is the events of
 * entities and of a process's own stream, the stream records of modules and the effect attempts,
 * and the `core.effect` records; per record its data, its before image and its meta (the decision
 * record with its `prepare` and `request` members, the sealed input), as `storedEventBytes` and
 * `storedStreamRecordBytes` measure them. The adapter charges them when a unit appends a record,
 * in a tenant or a backend scope (a deployment or namespace unit counts nothing), so a new kind of
 * record is counted without a new charge site here. A record that the framework removes again by
 * its own rule is not counted: the change records of receipts (`transientPurgeTypes`, removed by
 * the retention sweep of `transientRecords`) and the process state cache (`writeProcessStateCache`
 * replaces it at every fold). The counters do not go down yet (erasure and purge lower nothing),
 * so what retention or erasure removes stays in them until the package that lowers them lands.
 *
 * This function charges what only the write path knows: `core.rows`, the rows the command
 * created in entities that are not per invocation, and the limit of `core.eventBytes`, declared
 * as a charge of 0n so that the commit tail refuses the unit when everything it stored, records
 * of the framework's own included, ends above it. The limit is declared by every run of an action
 * that is not a core action through `attemptCommand` (a caller's command, an asynchronous reaction
 * job, a command job, a continuation) and by the inline reactions. A unit the framework runs for
 * itself (a settle, a release, the end of an exhausted command job, the steps of an erasure)
 * declares no limit and enqueues no capped job, so the tail never refuses it: it counts and
 * commits. Outside the tail, the one hold on such a unit is the reaction dispatcher's pause at 90
 * percent of a scope's `reactions` lane (`core.queue_full`): the batch rolls back and the scope
 * resumes by itself.
 *
 * A deployment scope charges nothing. The limit is null when the action is exempt or no limits
 * are given. With a null limit nothing is declared for `core.eventBytes`, and `core.rows` counts
 * without a limit.
 */
export function chargeStorage(input: {
  readonly registry: Registry;
  readonly scope: Scope;
  readonly written: readonly WrittenRow[];
  readonly quotas: QuotaLimits | undefined;
  readonly exempt: boolean;
}): readonly UsageCharge[] {
  const { registry, scope, written, quotas, exempt } = input;
  if (scope.level === 'deployment') return [];
  let rows = 0n;
  for (const row of written) {
    if (row.created && row.entry.descriptor.tenancy !== 'invocation') rows += 1n;
  }
  const limitOf = (ref: string): bigint | null => {
    if (exempt || quotas === undefined) return null;
    const limit = quotas.limitOf(registry, scope, ref);
    if (limit.kind === 'rate')
      throw errors.internal(`the quota "${ref}" is a rate, not a storage limit`);
    return BigInt(limit.value);
  };
  const charges: UsageCharge[] = [];
  const bytesLimit = limitOf('core.eventBytes');
  if (bytesLimit !== null)
    charges.push({ dimension: 'core.eventBytes', delta: 0n, limit: bytesLimit });
  const rowsLimit = limitOf('core.rows');
  if (rows !== 0n) charges.push({ dimension: 'core.rows', delta: rows, limit: rowsLimit });
  return charges;
}
