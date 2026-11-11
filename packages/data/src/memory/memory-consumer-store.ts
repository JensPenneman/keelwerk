import type { ConsumerStore, ErrorKind, ParkedStream, Position, StreamRef } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { checkLeaseTtl } from '../sql/check-lease-ttl.ts';
import { consumerForbidden } from '../sql/consumer-forbidden.ts';
import { consumerStartScopeId } from '../sql/consumer-start-scope-id.ts';
import { parkedErrorOf } from '../sql/parked-error-of.ts';
import { parkedLastError } from '../sql/parked-last-error.ts';
import { refuseConsumerStartScopeId } from '../sql/refuse-consumer-start-scope-id.ts';
import { floorInstant } from './floor-instant.ts';
import type { MemoryCounter } from './memory-counter.ts';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

interface Checkpoint {
  readonly position: Position;
  readonly updatedAt: Temporal.Instant;
}

interface Lease {
  readonly owner: string;
  readonly expiresAt: Temporal.Instant;
}

interface Parked {
  readonly stream: StreamRef;
  readonly from: Position;
  readonly attempts: number;
  readonly error: { readonly kind: ErrorKind; readonly code: string };
  readonly parkedAt: Temporal.Instant;
}

const separator = '\u0000';
const parkedPrefix = memoryM2Collections.parked('');
const positionsPrefix = 'pos/';

/**
 * Consumer checkpoints, leases and parked streams (15.2.3). Checkpoints and parked streams belong
 * to the unit's scope; leases belong to the namespace and only a namespace-scope unit reaches them.
 * A namespace-scope unit reads every scope's checkpoints and parked streams and writes no
 * checkpoint except through `startAtHeads`, which records the consumer's start (an entry at the
 * reserved scope id) and gives each scope that has events a checkpoint at its head. Instants come
 * from the adapter's clock, floored to milliseconds.
 */
export function memoryConsumerStore(ctx: MemoryUnitContext): ConsumerStore {
  const inNamespace = (): boolean => ctx.scope.level === 'namespace';
  const leasesOnly = (): void => {
    if (!inNamespace())
      throw consumerForbidden('consumer leases belong to namespace-scope units', ctx.scope);
  };
  const scopedOnly = (): string => {
    if (inNamespace()) throw consumerForbidden('this member belongs to a scoped unit', ctx.scope);
    return ctx.scopeId();
  };
  const now = (): Temporal.Instant => floorInstant(ctx.clock.now());
  /** The last committed position of a scope; 0 for a scope that never appended. */
  const headOf = (scopeId: string): Position =>
    (ctx.tx.read<MemoryCounter>(`${positionsPrefix}${scopeId}`).get('counter')?.next ?? 1n) - 1n;
  return {
    checkpoint: async (consumer, scopeId) => {
      refuseConsumerStartScopeId(scopeId);
      if (!inNamespace() && scopeId !== ctx.scopeId()) {
        throw consumerForbidden('a unit reads the checkpoints of its own scope only', ctx.scope);
      }
      return (
        ctx.tx.read<Checkpoint>(memoryM2Collections.consumers(scopeId)).get(consumer)?.position ??
        null
      );
    },
    advance: async (consumer, scopeId, to) => {
      const own = scopedOnly();
      refuseConsumerStartScopeId(scopeId);
      if (scopeId !== own)
        throw consumerForbidden('a unit advances the checkpoints of its own scope only', ctx.scope);
      if (to < 0n) throw errors.validation('a checkpoint position is not negative');
      ctx.writable();
      if (to > headOf(own)) {
        throw errors.validation('a checkpoint cannot be beyond the head of its scope');
      }
      const table = ctx.tx.write<Checkpoint>(memoryM2Collections.consumers(own));
      const current = table.get(consumer);
      if (current === undefined || to > current.position) {
        table.set(consumer, { position: to, updatedAt: now() });
      }
    },
    startAtHeads: async (consumer) => {
      if (!inNamespace()) {
        throw consumerForbidden('a consumer starts in a namespace-scope unit', ctx.scope);
      }
      ctx.writable();
      if (
        ctx.tx.read<Checkpoint>(memoryM2Collections.consumers(consumerStartScopeId)).has(consumer)
      ) {
        return false;
      }
      const updatedAt = now();
      ctx.tx
        .write<Checkpoint>(memoryM2Collections.consumers(consumerStartScopeId))
        .set(consumer, { position: 0n, updatedAt });
      for (const name of ctx.tx.names(positionsPrefix)) {
        const scopeId = name.slice(positionsPrefix.length);
        const head = headOf(scopeId);
        if (head === 0n) continue;
        const table = ctx.tx.write<Checkpoint>(memoryM2Collections.consumers(scopeId));
        if (!table.has(consumer)) table.set(consumer, { position: head, updatedAt });
      }
      return true;
    },
    acquireLease: async (consumer, owner, ttlMs) => {
      leasesOnly();
      checkLeaseTtl(ttlMs, 1);
      ctx.writable();
      const at = now();
      const table = ctx.tx.write<Lease>(memoryM2Collections.consumerLeases);
      const current = table.get(consumer);
      if (
        current !== undefined &&
        current.owner !== owner &&
        Temporal.Instant.compare(current.expiresAt, at) > 0
      ) {
        return false;
      }
      table.set(consumer, { owner, expiresAt: at.add({ milliseconds: ttlMs }) });
      return true;
    },
    renewLease: async (consumer, owner, ttlMs) => {
      leasesOnly();
      checkLeaseTtl(ttlMs, 0);
      ctx.writable();
      const at = now();
      const table = ctx.tx.write<Lease>(memoryM2Collections.consumerLeases);
      const current = table.get(consumer);
      if (
        current === undefined ||
        current.owner !== owner ||
        Temporal.Instant.compare(current.expiresAt, at) <= 0
      ) {
        return false;
      }
      table.set(consumer, { owner, expiresAt: at.add({ milliseconds: ttlMs }) });
      return true;
    },
    park: async (consumer, stream, from, error) => {
      const own = scopedOnly();
      refuseConsumerStartScopeId(own);
      const stored = parkedErrorOf(error);
      ctx.writable();
      const table = ctx.tx.write<Parked>(memoryM2Collections.parked(own));
      const key = [consumer, stream.type, stream.id].join(separator);
      const current = table.get(key);
      if (current === undefined) {
        table.set(key, {
          stream: { type: stream.type, id: stream.id },
          from,
          attempts: 1,
          error: stored,
          parkedAt: now(),
        });
        return;
      }
      // A parking at or before the stored position is a failed replay: it replaces the error.
      const replay = from <= current.from;
      table.set(key, {
        ...current,
        from: replay ? from : current.from,
        attempts: current.attempts + 1,
        error: replay ? stored : current.error,
      });
    },
    unpark: async (consumer, stream) => {
      const own = scopedOnly();
      refuseConsumerStartScopeId(own);
      ctx.writable();
      const key = [consumer, stream.type, stream.id].join(separator);
      const current = ctx.tx.read<Parked>(memoryM2Collections.parked(own)).get(key);
      if (current === undefined) return null;
      ctx.tx.write<Parked>(memoryM2Collections.parked(own)).delete(key);
      return current.from;
    },
    advanceParked: async (consumer, stream, to) => {
      const own = scopedOnly();
      refuseConsumerStartScopeId(own);
      ctx.writable();
      const key = [consumer, stream.type, stream.id].join(separator);
      const current = ctx.tx.read<Parked>(memoryM2Collections.parked(own)).get(key);
      if (current === undefined) return false;
      if (to > current.from) {
        ctx.tx.write<Parked>(memoryM2Collections.parked(own)).set(key, { ...current, from: to });
      }
      return true;
    },
    parked: async (consumer) => {
      const scopeIds = inNamespace()
        ? ctx.tx.names(parkedPrefix).map((name) => name.slice(parkedPrefix.length))
        : [ctx.scopeId()];
      const found: ParkedStream[] = [];
      for (const scopeId of scopeIds) {
        const table = ctx.tx.read<Parked>(memoryM2Collections.parked(scopeId));
        const wanted = `${consumer}${separator}`;
        for (const [key, row] of table) {
          if (!key.startsWith(wanted)) continue;
          found.push({
            scopeId,
            stream: row.stream,
            from: row.from,
            attempts: row.attempts,
            lastError: parkedLastError(row.error),
            parkedAt: row.parkedAt,
          });
        }
      }
      return found.toSorted(
        (a, b) =>
          (a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0) ||
          (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) ||
          (a.stream.type < b.stream.type ? -1 : a.stream.type > b.stream.type ? 1 : 0) ||
          (a.stream.id < b.stream.id ? -1 : a.stream.id > b.stream.id ? 1 : 0),
      );
    },
  };
}
