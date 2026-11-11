import type {
  EntityDescriptor,
  Logger,
  NamespaceRef,
  StorageScope,
  Unit,
  UnitOptions,
} from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { memoryAcquireLock } from './memory-acquire-lock.ts';
import { memoryBuildUnit } from './memory-build-unit.ts';
import { memoryCommitTail } from './memory-commit-tail.ts';
import type { MemoryDatabase } from './memory-database.ts';
import { memoryTransaction } from './memory-transaction.ts';
import { memoryUnitContext } from './memory-unit-context.ts';

/** What a unit needs from its adapter besides the database. */
export interface MemoryUnitEnvironment {
  readonly database: MemoryDatabase;
  readonly log: Logger;
  readonly lookup: ((ref: string) => EntityDescriptor | undefined) | undefined;
}

/**
 * Runs `fn` as one unit on one namespace for one scope (14.3.6). A read-write unit holds the
 * namespace's lock from its snapshot to its commit, so units are serialised in the order they
 * asked; a read-only unit takes a snapshot of the committed collections and never waits, so a
 * command can read another scope's data in a unit of its own while it runs. Nothing is visible
 * to others until the commit installs the unit's collections; an error leaves nothing behind.
 * The signal is checked before the unit starts and before it commits; `timeoutMs` and the signal
 * also bound the wait for the lock (`unavailable`, `core.timeout`), the only wait a unit has here.
 */
export async function memoryUnit<T>(
  environment: MemoryUnitEnvironment,
  namespace: NamespaceRef,
  scope: StorageScope,
  fn: (unit: Unit) => Promise<T>,
  options: UnitOptions = {},
): Promise<T> {
  const { database } = environment;
  if (database.isClosed()) throw errors.unavailable('the in-memory adapter is closed');
  options.signal?.throwIfAborted();
  const readOnly = options.readOnly === true;
  const state = database.namespace(namespace);
  const release = readOnly ? undefined : await memoryAcquireLock(database, namespace.id, options);
  try {
    options.signal?.throwIfAborted();
    const ctx = memoryUnitContext(
      {
        namespace,
        scope,
        readOnly,
        tx: memoryTransaction(new Map(state.collections)),
        clock: database.clock,
        state,
        deploymentId: database.deploymentId,
      },
      environment.lookup,
    );
    const hooks: (() => void)[] = [];
    let result: T;
    try {
      result = await fn(memoryBuildUnit(ctx, hooks));
      options.signal?.throwIfAborted();
      if (!readOnly) {
        memoryCommitTail(ctx);
        for (const [name, collection] of ctx.tx.changes()) state.collections.set(name, collection);
      }
      if (ctx.assigned.length > 0) database.committed(namespace.id, ctx.scopeId());
    } finally {
      // Settled: work of the unit that is still running (a consumer raced against a deadline) can
      // no longer read or change what the unit saw or committed.
      ctx.tx.end();
    }
    for (const hook of hooks) {
      try {
        hook();
      } catch (error) {
        environment.log.error('an afterCommit hook failed', { error: String(error) });
      }
    }
    return result;
  } finally {
    release?.();
  }
}
