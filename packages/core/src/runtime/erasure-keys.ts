import { shredStep } from '../keys/shred-step.ts';
import { replayErasureRecords } from './replay-erasure-records.ts';
import { replayKeyTombstones } from './replay-key-tombstones.ts';
import type { RuntimeService } from './runtime-service.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/**
 * The key replay of section 14.7.6 (`core.erasureKeys`): before the events workers start, shreds the
 * subject's data keys in its tenant for every erasure record of the ledger union, so a placement
 * restored from a backup never opens a key the erasure destroyed. It touches keys only and is
 * cheap; a tenant this process does not serve is left to the process that does. It runs the shred
 * step of the erasure itself (`shredStep`: shred, create, shred again), so a subject that owns no
 * data key (a passkey-only user) gets a destroyed key row here too: a placement restored from a
 * backup that holds none then has a key shredded after the erasure's completion, which is what makes
 * the erasure worker run it again. `dataKey` creates a key only when the subject has no key row at
 * all, so an ordinary boot destroys and creates nothing. The shred answers
 * every destroyed key of the subject, destroyed now or before, so only the tombstones whose key id
 * the ledger union does not hold yet are appended (to the control ledger and to every sink), as the
 * erasure's own step 2 writes them: a boot never duplicates one. The
 * value keys that erasures destroyed (the keys of an owned row's secret and verifier fields) come
 * back from the tombstones of the same union and are destroyed again, so the verifier of a password
 * or a session of an erased user does not reopen from a restored placement. One record or tenant
 * that fails (a SQL store without a key wrapper, D21; a store that is down) is logged with its
 * tenant and command id and does not stop the ones after it: their keys are still destroyed.
 */
export function erasureKeys(input: StartPhaseInput): RuntimeService {
  return {
    id: 'core.erasureKeys',
    roles: ['serve', 'work'],
    start: async (context) => {
      const keys = input.connected.keys;
      // The key ids the union holds a tombstone for, read once before any shred.
      const tombstoned = new Set<string>();
      const valueKeys = new Map<string, string[]>();
      for await (const tombstone of replayKeyTombstones(context)) {
        tombstoned.add(tombstone.keyId);
        const ids = valueKeys.get(tombstone.scopeId) ?? [];
        ids.push(tombstone.keyId);
        valueKeys.set(tombstone.scopeId, ids);
      }
      for await (const record of replayErasureRecords(context)) {
        // One record that cannot be replayed (a store without a key wrapper, a store that is
        // down) must not stop the records after it: their keys are shredded all the same.
        try {
          const tenant = await context.directory.tenant(record.tenantId);
          if (tenant === undefined) continue;
          const source = context.namespaces.find(
            (candidate) => candidate.namespace.id === tenant.namespace.id,
          );
          if (source === undefined) continue;
          const tombstones = await source.handle.adapter.unit(
            source.namespace,
            { level: 'tenant', backendId: tenant.backendId, tenantId: tenant.id },
            (unit) =>
              shredStep(unit, { keys, subjectId: record.subjectId, at: context.clock.now() }),
          );
          for (const tombstone of tombstones) {
            if (tombstoned.has(tombstone.keyId)) continue;
            await context.control.ledger.append(tombstone);
            for (const sink of context.ledgers) await sink.append([tombstone]);
            tombstoned.add(tombstone.keyId);
          }
        } catch (cause) {
          // The subject is not named: the tenant and the command id find the record.
          context.log.error('the keys of an erasure could not be replayed at the start', {
            tenantId: record.tenantId,
            commandId: record.commandId,
            cause,
          });
        }
      }
      for (const [tenantId, keyIds] of valueKeys) {
        try {
          const tenant = await context.directory.tenant(tenantId);
          if (tenant === undefined) continue;
          const source = context.namespaces.find(
            (candidate) => candidate.namespace.id === tenant.namespace.id,
          );
          if (source === undefined) continue;
          await source.handle.adapter.unit(
            source.namespace,
            { level: 'tenant', backendId: tenant.backendId, tenantId: tenant.id },
            async (unit) => {
              // Destroying a key that is gone, or an id that names a data key, changes nothing.
              for (const keyId of keyIds) await unit.keys.destroyValueKey(keyId);
            },
          );
        } catch (cause) {
          context.log.error('the value keys of a tenant could not be destroyed at the start', {
            tenantId,
            cause,
          });
        }
      }
    },
    stop: async () => undefined,
  };
}
