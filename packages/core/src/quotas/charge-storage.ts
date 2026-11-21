import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { UsageCharge } from '../storage/usage-charge.ts';
import type { WrittenRow } from '../write-path/written-row.ts';
import type { QuotaLimits } from './quota-limits.ts';
import { storageLimits } from './storage-limits.ts';

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
 * record is counted without a new charge site here. The change records of receipts count too. The
 * process state cache does not (`writeProcessStateCache` replaces it at every fold). The adapter
 * gives the bytes back in the unit that removes a record (the retention sweep, the expiry of stream
 * records, the erasure of a stream's records); nothing removes a row of `core.rows`, so that
 * counter does not go down.
 *
 * This function charges what only the write path knows: `core.rows`, the rows the command
 * created in entities that are not per invocation, and the limit of `core.eventBytes`, declared
 * as a charge of 0n so that the commit tail refuses the unit when everything it stored, records
 * of the framework's own included, ends above it. The limit is declared by every run of an action
 * through `attemptCommand` (for example a caller's command, an asynchronous reaction job, a
 * command job, a continuation, a synchronous command nested in a unit) and by the inline reactions
 * of such a run, unless `exempt` (`isExemptFromTail`): the action is a core action, or the unit was
 * opened for a command with `prepare`. That command is checked at its admission only
 * (`admitPrepare`), and its unit never declares a storage limit, whichever action charges in it: it
 * counts and commits, so the counters can end above a limit.
 *
 * A unit the framework runs for itself is every unit that is not the run of a command through
 * `attemptCommand` or an inline reaction of it (12.2 names them by that rule); only those two call
 * this function, so such a unit declares no storage limit and the tail never refuses it by one.
 * Other holds reach such a unit, and none is a storage limit: a unit that enqueues a job carrying a
 * queued cap (`commandQueuedCap`; for example the accept of an asynchronous command) can be refused
 * with `core.queue_full`, and a dispatcher pass is held at 90 percent of the scope's `reactions`
 * lane (`core.queue_full`: the batch rolls back and the scope resumes by itself).
 *
 * A deployment scope charges nothing. The limit is null when `exempt` or no limits
 * are given (`storageLimits`). With a null limit nothing is declared for `core.eventBytes`, and
 * `core.rows` counts without a limit.
 */
export function chargeStorage(input: {
  readonly registry: Registry;
  readonly scope: Scope;
  readonly written: readonly WrittenRow[];
  readonly quotas: QuotaLimits | undefined;
  readonly exempt: boolean;
}): readonly UsageCharge[] {
  const { scope, written } = input;
  if (scope.level === 'deployment') return [];
  let rows = 0n;
  for (const row of written) {
    if (row.created && row.entry.descriptor.tenancy !== 'invocation') rows += 1n;
  }
  const limits = storageLimits(input);
  const charges: UsageCharge[] = [];
  if (limits !== null) {
    charges.push({ dimension: 'core.eventBytes', delta: 0n, limit: limits.eventBytes });
  }
  if (rows !== 0n)
    charges.push({ dimension: 'core.rows', delta: rows, limit: limits?.rows ?? null });
  return charges;
}
