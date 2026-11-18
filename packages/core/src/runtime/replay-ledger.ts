import type { LedgerLookup } from '../control/ledger-lookup.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { Clock } from '../kernel/clock.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import { shredStep } from '../keys/shred-step.ts';
import type { KeyTombstoneRecord } from '../ledger/key-tombstone-record.ts';
import type { Logger } from '../observability/logger.ts';
import { canonicalSubject } from '../subjects/canonical-subject.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { Connected } from './connected.ts';
import { replayedKeyOf } from './replayed-key-of.ts';
import type { ReplayedRecord } from './replayed-record.ts';

const pageSize = 500;

function lookupOf(record: ReplayedRecord): LedgerLookup {
  return record.type === 'erasure'
    ? {
        type: 'erasure',
        tenantId: record.tenantId,
        commandId: record.commandId,
        subjectId: canonicalSubject(record.subjectId),
      }
    : { type: 'keyTombstone', keyId: record.keyId };
}

/**
 * Sections 14.7.5 and 14.7.6 at `connect`, steps (b) to (d) of the restore check, before the process
 * serves. Every failure of (b), (d) and of the read in (c) rejects, so the start fails and the next
 * start finds the same restore again; only (c) answers for one erasure at a time, and a failure
 * there is logged (the tenant id and the command id, never the subject) while the rest go on.
 *
 * (b) The union with the sinks: every erasure and key tombstone a sink holds that the control ledger
 * lacks (the sinks survive a restore, the control copy may not) is found by probing the control
 * ledger with `find` in pages of 500, and appended to it after (d), an erasure with its subject in
 * canonical form, as every lookup and every completion spells it. The records come from the one pass
 * over the sinks of the restore check (`readSinks`); the tenants of a missing record are
 * `reconciled`. A record that cannot be probed or appended would be invisible to (c) and to the
 * hold, so it fails the start.
 * (d) The value keys: for every tenant in `bumped` or `reconciled`, every tombstone of the tenant
 * (every reason: erasure, rotation, tenant deleted), those still missing from the control ledger
 * included, is destroyed again in the tenant's unit, so a value key an earlier erasure or a
 * rotation destroyed does not reopen from a restored placement. The appends of (b) come after it:
 * the append is what makes a tenant `reconciled` for good, so a crash or a failure in (d) leaves
 * the records missing and the next start runs (d) again. A failed tenant lookup rejects as well.
 * Neither (b) nor (d) depends on the epoch, so the restore check runs them before it moves any
 * epoch: a crash in between finds the restore again at the next start.
 * `beforeKeys` runs after (d) and before (c), where the restore check carries out its bumps.
 * (c) The data keys of every unfinished erasure (no completion at its tenant's epoch) are shredded
 * again, so a placement restored from a backup never opens a key the erasure destroyed; the
 * tombstones the control ledger lacks go to it and to every sink. A boot whose erasures are all
 * finished opens no writing unit. Every tenant with an unfinished erasure is held (14.7.6): the
 * hold derives from the control ledger alone, so every process that starts before the completion
 * holds the tenant, whichever process copied the record. One warning per held tenant (tenant id
 * only). A failed read of the unfinished erasures rejects, so the start fails rather than serves a
 * tenant that should be held.
 */
export async function replayLedger(input: {
  readonly connected: Connected;
  readonly sources: readonly QueueSource[];
  readonly directory: ScopeLookup;
  /** The sinks the tombstones this replay creates are appended to. */
  readonly sinks: readonly LedgerSink[];
  /** The erasure and key tombstone records the sinks hold (`readSinks`). */
  readonly records: readonly ReplayedRecord[];
  /** The scopes the restore check decided to bump. */
  readonly bumped: ReadonlySet<string>;
  /** Runs after (b) and (d), before (c). */
  readonly beforeKeys?: () => Promise<void>;
  readonly clock: Clock;
  readonly log: Logger;
}): Promise<{
  readonly reconciled: ReadonlySet<string>;
  readonly held: ReadonlySet<string>;
}> {
  const { connected, sources, directory, sinks, clock, log } = input;
  const { control, keys } = connected;
  const { ledger } = control;
  const reconciled = new Set<string>();

  /** The keys of the records among `records` that the control ledger holds. */
  const heldKeys = async (records: readonly ReplayedRecord[]): Promise<ReadonlySet<string>> => {
    const lookups = records.map(lookupOf);
    const held = new Set<string>();
    let after = 0n;
    for (;;) {
      const page = await ledger.find(lookups, { after, limit: pageSize });
      for (const entry of page) {
        const key = replayedKeyOf(entry.record);
        if (key !== undefined) held.add(key);
        after = entry.seq;
      }
      if (page.length < pageSize) return held;
    }
  };

  /**
   * The source and tenant scope this process serves a tenant from; undefined when the directory
   * places the tenant nowhere this process serves. A failed lookup rejects.
   */
  const tenantOf = async (tenantId: string) => {
    const tenant = await directory.tenant(tenantId);
    if (tenant === undefined) return undefined;
    const source = sources.find((candidate) => candidate.namespace.id === tenant.namespace.id);
    if (source === undefined) return undefined;
    return {
      source,
      scope: { level: 'tenant', backendId: tenant.backendId, tenantId: tenant.id } as const,
    };
  };

  // (b) The records of the sinks the control ledger lacks, found here and appended after (d).
  const missing: ReplayedRecord[] = [];
  const seen = new Set<string>();
  for (let at = 0; at < input.records.length; at += pageSize) {
    const batch = input.records.slice(at, at + pageSize);
    const held = await heldKeys(batch);
    for (const record of batch) {
      const key = replayedKeyOf(record) ?? '';
      if (held.has(key) || seen.has(key)) continue;
      seen.add(key);
      missing.push(record);
      reconciled.add(record.type === 'erasure' ? record.tenantId : record.scopeId);
    }
  }

  // (d) The value keys of the tenants a restore touched, before the missing records are appended:
  // a crash or a failure here leaves them missing, and the next start reconciles them again.
  const missingKeyIds = new Map<string, string[]>();
  for (const record of missing) {
    if (record.type !== 'keyTombstone') continue;
    missingKeyIds.set(record.scopeId, [...(missingKeyIds.get(record.scopeId) ?? []), record.keyId]);
  }
  for (const tenantId of new Set([...input.bumped, ...reconciled])) {
    const found = await tenantOf(tenantId);
    if (found === undefined) continue;
    const destroy = async (keyIds: readonly string[]): Promise<void> => {
      if (keyIds.length === 0) return;
      await found.source.handle.adapter.unit(found.source.namespace, found.scope, async (unit) => {
        // Destroying a key that is gone, or an id that names a data key, changes nothing.
        for (const keyId of keyIds) await unit.keys.destroyValueKey(keyId);
      });
    };
    await destroy(missingKeyIds.get(tenantId) ?? []);
    let from = 0n;
    for (;;) {
      const page = await ledger.find([{ type: 'keyTombstone', scopeId: tenantId }], {
        after: from,
        limit: pageSize,
      });
      await destroy(
        page.flatMap((entry) => (entry.record.type === 'keyTombstone' ? [entry.record.keyId] : [])),
      );
      const last = page.at(-1);
      if (last === undefined || page.length < pageSize) break;
      from = last.seq;
    }
  }
  for (const record of missing) {
    await ledger.append(
      record.type === 'erasure'
        ? { ...record, subjectId: canonicalSubject(record.subjectId) }
        : record,
    );
  }
  await input.beforeKeys?.();

  // (c) The data keys of every unfinished erasure.
  const recordTombstones = async (tombstones: readonly KeyTombstoneRecord[]): Promise<void> => {
    if (tombstones.length === 0) return;
    const held = await heldKeys(tombstones);
    for (const tombstone of tombstones) {
      if (held.has(replayedKeyOf(tombstone) ?? '')) continue;
      await ledger.append(tombstone);
      for (const sink of sinks) await sink.append([tombstone]);
    }
  };
  const holding = new Set<string>();
  let after = 0n;
  for (;;) {
    const page = await ledger.unfinished({ epochs: control.epochs(), after, limit: pageSize });
    for (const { record } of page.erasures) {
      holding.add(record.tenantId);
      try {
        const found = await tenantOf(record.tenantId);
        if (found === undefined) continue;
        const tombstones = await found.source.handle.adapter.unit(
          found.source.namespace,
          found.scope,
          (unit) => shredStep(unit, { keys, subjectId: record.subjectId, at: clock.now() }),
        );
        await recordTombstones(tombstones);
      } catch (cause) {
        log.error('the keys of an erasure could not be replayed at the start', {
          tenantId: record.tenantId,
          commandId: record.commandId,
          cause,
        });
      }
    }
    const last = page.erasures.at(-1);
    if (last === undefined || page.erasures.length < pageSize) break;
    after = last.seq;
  }

  for (const tenantId of holding) {
    log.warn('a tenant is held until its erasures have run again', { tenantId });
  }
  return { reconciled, held: holding };
}
