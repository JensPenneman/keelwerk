import type {
  Clock,
  ControlLedger,
  KeyTombstoneRecord,
  LedgerSink,
  UnitGuard,
} from '@keelwerk/core';

/** What the worker remembers for a key in a scope, whichever erasure tombstoned it (what a unit that destroys it asks). */
const keyIdentity = (scopeId: string, keyId: string): string => `${scopeId}\u0000${keyId}`;
/** What it remembers for one erasure's tombstone of the key (what a repeat of that tombstone asks). */
const identity = (scopeId: string, keyId: string, commandId: string | undefined): string =>
  `${keyIdentity(scopeId, keyId)}\u0000${commandId ?? ''}`;

/**
 * Whether the control ledger holds the tombstone of this command (none, for the shred step's) for
 * this key id in this scope: a principal's key id is the same in a tenant, in another tenant and in
 * the backend, and another erasure's tombstone for the key does not stand for this one's.
 */
async function held(
  ledger: ControlLedger,
  scopeId: string,
  keyId: string,
  commandId: string | undefined,
): Promise<boolean> {
  for (let after = 0n; ; ) {
    const page = await ledger.find([{ type: 'keyTombstone', keyId }], { after });
    if (
      page.some(
        ({ record }) =>
          record.type === 'keyTombstone' &&
          record.scopeId === scopeId &&
          record.commandId === commandId,
      )
    ) {
      return true;
    }
    const last = page.at(-1);
    if (last === undefined) return false;
    after = last.seq;
  }
}

/** What a unit that destroys keys asks: whether the tombstone of a key id is recorded in its scope. */
export interface KnownKeys {
  readonly has: (keyId: string) => boolean;
  /** Grows with every tombstone this process takes into its memory. */
  readonly size: number;
}

/** What an erasure records tombstones with. */
export interface TombstoneRecorder {
  /** Records the tombstones, each in the scope it names. */
  readonly recordTombstones: (tombstones: readonly KeyTombstoneRecord[]) => Promise<void>;
  /** The tombstones of keys of the tenant. */
  readonly recordKeys: (keyIds: readonly string[]) => Promise<void>;
  /** The tombstones of keys of the tenant's backend scope. */
  readonly recordBackendKeys: (keyIds: readonly string[]) => Promise<void>;
  readonly knownInTenant: KnownKeys;
  readonly knownInBackend: KnownKeys;
}

/**
 * The recording of the key tombstones of one erasure, in its tenant and in the tenant's backend
 * scope. A tombstone is told from another by its scope, its key id AND its erasure's command: a
 * principal's key id is the same in every tenant it acted in and in the backend, and two erasures
 * can tombstone one key, so `known` (the worker's memory of the tombstones every sink has taken,
 * shared by its runs and by the erasures of several tenants) holds the triple, and the pair of
 * scope and key id for the gate of a unit that destroys the key, which any erasure's tombstone
 * opens. `recorded` and `own` collect the tenant's key ids this erasure has a tombstone for, and
 * the ones it recorded itself.
 */
export function tombstoneRecorder(input: {
  readonly ledger: ControlLedger;
  readonly sinks: readonly LedgerSink[];
  readonly guard: UnitGuard;
  readonly clock: Clock;
  readonly known: Set<string>;
  readonly recorded: Set<string>;
  readonly own: Set<string>;
  readonly commandId: string;
  readonly tenantId: string;
  readonly backendId: string;
}): TombstoneRecorder {
  const { ledger, sinks, guard, clock, known, recorded, own, tenantId } = input;
  /**
   * Tombstones go to the control ledger and to every sink, before any later step. A tombstone of
   * this erasure that the control ledger holds already for the scope (the step ran before and
   * failed at a sink, or after it) is not appended there again; the look-up is by scope, key id and
   * command, so another erasure's tombstone for the same key, or the same key id in another scope,
   * does not stand for this one's. The sinks get it again: a sink that failed missed it, and a
   * tombstone twice in a sink changes nothing.
   */
  const recordTombstones = async (tombstones: readonly KeyTombstoneRecord[]): Promise<void> => {
    for (const tombstone of tombstones) {
      // The command the tombstone names (the shred step's tombstones name none).
      const { scopeId, keyId, commandId } = tombstone;
      const inTenant = scopeId === tenantId;
      const ownAlready = inTenant && own.has(keyId);
      if (inTenant) recorded.add(keyId);
      if (
        !ownAlready &&
        !known.has(identity(scopeId, keyId, commandId)) &&
        !(await held(ledger, scopeId, keyId, commandId))
      ) {
        await ledger.append(tombstone);
      }
      if (inTenant && commandId === input.commandId) own.add(keyId);
      for (const sink of sinks) await guard(() => sink.append([tombstone]));
      // Known only once every sink has it: a sink that refused leaves the key unknown, so a rerun appends it again.
      known.add(identity(scopeId, keyId, commandId));
      known.add(keyIdentity(scopeId, keyId));
    }
  };
  const tombstonesOf = (
    keyIds: readonly string[],
    scopeId: string,
  ): readonly KeyTombstoneRecord[] =>
    keyIds.map(
      (keyId): KeyTombstoneRecord => ({
        type: 'keyTombstone',
        scopeId,
        keyId,
        recordedAt: clock.now().toString(),
        reason: 'erasure',
        commandId: input.commandId,
      }),
    );
  const knownIn = (scopeId: string): KnownKeys => ({
    has: (keyId) => known.has(keyIdentity(scopeId, keyId)),
    get size() {
      return known.size;
    },
  });
  return {
    recordTombstones,
    recordKeys: (keyIds) => recordTombstones(tombstonesOf(keyIds, tenantId)),
    recordBackendKeys: (keyIds) => recordTombstones(tombstonesOf(keyIds, input.backendId)),
    knownInTenant: knownIn(tenantId),
    knownInBackend: knownIn(input.backendId),
  };
}
