// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { ConsumerStore, ErrorKind, ParkedStream } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { checkLeaseTtl } from './check-lease-ttl.ts';
import { consumerForbidden } from './consumer-forbidden.ts';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { isLockUnavailable } from './is-lock-unavailable.ts';
import { parkedErrorOf } from './parked-error-of.ts';
import { parkedLastError } from './parked-last-error.ts';
import { acquireConsumerLeaseStatement } from './postgres/acquire-consumer-lease-statement.ts';
import { advanceCheckpointStatement } from './postgres/advance-checkpoint-statement.ts';
import { consumerStartStatement } from './postgres/consumer-start-statement.ts';
import { headCheckpointsStatement } from './postgres/head-checkpoints-statement.ts';
import { parkStreamStatement } from './postgres/park-stream-statement.ts';
import { positionAfterLock } from './postgres/position-after-lock.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { renewConsumerLeaseStatement } from './postgres/renew-consumer-lease-statement.ts';
import { refuseConsumerStartScopeId } from './refuse-consumer-start-scope-id.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { withLockTimeout } from './with-lock-timeout.ts';

/** How long an advance waits for the row lock of a checkpoint another unit holds. */
const lockWaitMs = 500;

/** The kind and code of the stored JSON, which the driver returns parsed. */
function storedErrorOf(value: unknown): { readonly kind: ErrorKind; readonly code: string } {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  const record = parsed as { readonly kind: ErrorKind; readonly code: string };
  return { kind: record.kind, code: record.code };
}

/**
 * Consumer checkpoints, leases and parked streams (15.2.3) as raw statements with the scope id
 * explicit: a namespace-scope unit has no scope for the scoping plugin, and the row-level security
 * of the tables (`scoped` and `maintenance`, `take` for the leases) is the second line. Leases
 * belong to the namespace and only a namespace-scope unit reaches them; a namespace-scope unit
 * reads every scope's checkpoints and parked streams and writes no checkpoint except through
 * `startAtHeads`, which records the consumer's start (a row at the reserved scope id) and gives each
 * scope that has events a checkpoint at its head. Instants come from the adapter's clock, floored to
 * milliseconds.
 */
export function sqlConsumerStore(ctx: SqlUnitContext): ConsumerStore {
  const root = quoteIdentifier(ctx.namespace.root);
  const inNamespace = (): boolean => ctx.scope.level === 'namespace';
  const leasesOnly = (): void => {
    if (!inNamespace())
      throw consumerForbidden('consumer leases belong to namespace-scope units', ctx.scope);
  };
  const scopedOnly = (): string => {
    if (inNamespace()) throw consumerForbidden('this member belongs to a scoped unit', ctx.scope);
    return ctx.scopeId();
  };
  const now = (): string => encodeInstant(ctx.clock.now());
  return {
    checkpoint: async (consumer, scopeId) => {
      refuseConsumerStartScopeId(scopeId);
      if (!inNamespace() && scopeId !== ctx.scopeId()) {
        throw consumerForbidden('a unit reads the checkpoints of its own scope only', ctx.scope);
      }
      const rows = await sqlGuard(async () =>
        runSql(ctx.db, {
          sql: `select position::text as position from ${root}.kw_consumers
where consumer_id = $1::text and scope_id = $2::uuid`,
          parameters: [consumer, scopeId],
        }),
      );
      const row = rows[0];
      return row === undefined ? null : BigInt(String(row.position));
    },
    advance: async (consumer, scopeId, to) => {
      const own = scopedOnly();
      refuseConsumerStartScopeId(scopeId);
      if (scopeId !== own) {
        throw consumerForbidden('a unit advances the checkpoints of its own scope only', ctx.scope);
      }
      if (to < 0n) throw errors.validation('a checkpoint position is not negative');
      ctx.writable();
      if (to > 0n) {
        // Only what the scope has appended can have been delivered (read before any lock is taken).
        const [row] = await sqlGuard(async () =>
          runSql(ctx.db, positionAfterLock(ctx.namespace.root, own)),
        );
        if (to > BigInt(String(row?.position ?? '0'))) {
          throw errors.validation('a checkpoint cannot be beyond the head of its scope');
        }
      }
      // The advance takes the row lock; a row another unit holds is waited for only briefly, so a
      // stalled holder cannot park the caller (and the scopes queued behind it) on the lock.
      try {
        await withLockTimeout(ctx, lockWaitMs, () =>
          sqlGuard(async () =>
            runSql(
              ctx.db,
              advanceCheckpointStatement(ctx.namespace.root, consumer, own, to, now()),
            ),
          ),
        );
      } catch (error) {
        if (isLockUnavailable(error)) {
          throw errors.unavailable('The checkpoint is locked by another unit.', {
            cause: error,
            retryAfter: 1,
          });
        }
        throw error;
      }
    },
    startAtHeads: async (consumer) => {
      if (!inNamespace()) {
        throw consumerForbidden('a consumer starts in a namespace-scope unit', ctx.scope);
      }
      ctx.writable();
      const startedAt = now();
      try {
        // The start record first: a concurrent start waits for its row and then writes nothing, so
        // one snapshot, that of the second statement, decides the heads.
        return await withLockTimeout(ctx, lockWaitMs, async () => {
          const written = await sqlGuard(async () =>
            runSql(ctx.db, consumerStartStatement(ctx.namespace.root, consumer, startedAt)),
          );
          if (written.length === 0) return false;
          await sqlGuard(async () =>
            runSql(ctx.db, headCheckpointsStatement(ctx.namespace.root, consumer, startedAt)),
          );
          return true;
        });
      } catch (error) {
        if (isLockUnavailable(error)) {
          throw errors.unavailable('The start of the consumer is held by another unit.', {
            cause: error,
            retryAfter: 1,
          });
        }
        throw error;
      }
    },
    acquireLease: async (consumer, owner, ttlMs) => {
      leasesOnly();
      checkLeaseTtl(ttlMs, 1);
      ctx.writable();
      const at = ctx.clock.now();
      const rows = await sqlGuard(async () =>
        runSql(
          ctx.db,
          acquireConsumerLeaseStatement(
            ctx.namespace.root,
            consumer,
            owner,
            encodeInstant(at.add({ milliseconds: ttlMs })),
            encodeInstant(at),
          ),
        ),
      );
      return rows.length > 0;
    },
    renewLease: async (consumer, owner, ttlMs) => {
      leasesOnly();
      checkLeaseTtl(ttlMs, 0);
      ctx.writable();
      const at = ctx.clock.now();
      const rows = await sqlGuard(async () =>
        runSql(
          ctx.db,
          renewConsumerLeaseStatement(
            ctx.namespace.root,
            consumer,
            owner,
            encodeInstant(at.add({ milliseconds: ttlMs })),
            encodeInstant(at),
          ),
        ),
      );
      return rows.length > 0;
    },
    park: async (consumer, stream, from, error) => {
      const own = scopedOnly();
      refuseConsumerStartScopeId(own);
      const stored = parkedErrorOf(error);
      ctx.writable();
      await sqlGuard(async () =>
        runSql(
          ctx.db,
          parkStreamStatement(ctx.namespace.root, consumer, own, stream, from, stored, now()),
        ),
      );
    },
    unpark: async (consumer, stream) => {
      const own = scopedOnly();
      refuseConsumerStartScopeId(own);
      ctx.writable();
      const rows = await sqlGuard(async () =>
        runSql(ctx.db, {
          sql: `delete from ${root}.kw_parked
where consumer_id = $1::text and scope_id = $2::uuid and stream_type = $3::text and stream_id = $4::uuid
returning from_position::text as from_position`,
          parameters: [consumer, own, stream.type, stream.id],
        }),
      );
      const row = rows[0];
      return row === undefined ? null : BigInt(String(row.from_position));
    },
    advanceParked: async (consumer, stream, to) => {
      const own = scopedOnly();
      refuseConsumerStartScopeId(own);
      ctx.writable();
      const rows = await sqlGuard(async () =>
        runSql(ctx.db, {
          sql: `update ${root}.kw_parked set from_position = greatest(from_position, $5::bigint)
where consumer_id = $1::text and scope_id = $2::uuid and stream_type = $3::text and stream_id = $4::uuid
returning 1`,
          parameters: [consumer, own, stream.type, stream.id, to.toString()],
        }),
      );
      return rows.length > 0;
    },
    parked: async (consumer) => {
      const rows = await sqlGuard(async () =>
        runSql(ctx.db, {
          sql: `select scope_id::text as scope_id, stream_type, stream_id::text as stream_id,
  from_position::text as from_position, attempts, last_error, parked_at
from ${root}.kw_parked
where consumer_id = $1::text and ($2::uuid is null or scope_id = $2::uuid)
order by scope_id, from_position, stream_type collate "C", stream_id`,
          parameters: [consumer, inNamespace() ? null : ctx.scopeId()],
        }),
      );
      return rows.map(
        (row): ParkedStream => ({
          scopeId: String(row.scope_id),
          stream: { type: String(row.stream_type), id: String(row.stream_id) },
          from: BigInt(String(row.from_position)),
          attempts: Number(row.attempts),
          lastError: parkedLastError(storedErrorOf(row.last_error)),
          parkedAt: decodeInstant(row.parked_at),
        }),
      );
    },
  };
}
