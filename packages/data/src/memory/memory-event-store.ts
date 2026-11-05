import type { EventStore, Position, StoredEvent } from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import { assertStreamInScope } from '../sql/assert-stream-in-scope.ts';
import type { MemoryCounter } from './memory-counter.ts';
import { memoryEnvelope } from './memory-envelope.ts';
import type { MemoryLoggedEvent } from './memory-logged-event.ts';
import { memoryMatchesSelector } from './memory-matches-selector.ts';
import type { MemoryPendingEvent } from './memory-pending-event.ts';
import { memoryStreamKey } from './memory-stream-key.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

function sequenceKey(index: number): string {
  return String(index).padStart(12, '0');
}

/**
 * The event log of a unit's scope (15.1.11). Appends sit in the unit's buffer, which a savepoint
 * covers like any collection; the commit tail (`memoryCommitTail`) numbers them from the scope's
 * counter. Tenant, backend and deployment units each have a log (`kw_positions` and `kw_events` admit
 * `scope_id = keelwerk.deployment_id` in the control root); only a namespace-scope unit has none.
 */
export function memoryEventStore(ctx: MemoryUnitContext): EventStore {
  const hasLog = ctx.scope.level !== 'namespace';
  const counterOf = (): MemoryCounter | undefined =>
    hasLog ? ctx.tx.read<MemoryCounter>(`pos/${ctx.scopeId()}`).get('counter') : undefined;
  const logOf = (): ReadonlyMap<string, MemoryLoggedEvent> =>
    hasLog ? ctx.tx.read<MemoryLoggedEvent>(`events/${ctx.scopeId()}`) : new Map();
  const bufferName = (): string => `~events/${ctx.scopeId()}`;
  const versionsName = (): string => `~versions/${ctx.scopeId()}`;
  const bufferOf = (): readonly MemoryPendingEvent[] => [
    ...ctx.tx.read<MemoryPendingEvent>(bufferName()).values(),
  ];
  const committedVersion = (type: string, id: string): number => {
    const key = memoryStreamKey(type, id);
    const buffered = ctx.tx.read<number>(versionsName()).get(key);
    if (buffered !== undefined) return buffered;
    return ctx.tx.read<number>(`streamv/${ctx.scopeId()}`).get(key) ?? 0;
  };
  const pendingAsStored = (): readonly StoredEvent[] => {
    const next = counterOf()?.next ?? 1n;
    return bufferOf().map((pending, index) => memoryEnvelope(ctx, pending, next + BigInt(index)));
  };
  return {
    append: async (batch) => {
      ctx.writable();
      if (!hasLog) {
        throw errors.internal(`a ${ctx.scope.level}-scope unit has no event log`);
      }
      const planned = new Map<string, number>();
      for (const append of batch) {
        const entity = ctx.entity(append.stream.type);
        if (entity === undefined) {
          throw errors.internal(`the shape of ${append.stream.type} is unknown to this unit`);
        }
        assertStreamInScope(entity, ctx.scope);
        const key = memoryStreamKey(append.stream.type, append.stream.id);
        const version = planned.get(key) ?? committedVersion(append.stream.type, append.stream.id);
        if (version !== append.expectedVersion) {
          throw new KeelwerkError({
            kind: 'conflict',
            code: 'core.version_mismatch',
            message: 'The stream changed since it was read.',
            details: { stream: append.stream, expectedVersion: append.expectedVersion, version },
          });
        }
        planned.set(key, version + append.events.length);
      }
      const results: { eventId: string; version: number }[] = [];
      const buffer = ctx.tx.write<MemoryPendingEvent>(bufferName());
      const versions = ctx.tx.write<number>(versionsName());
      for (const append of batch) {
        const key = memoryStreamKey(append.stream.type, append.stream.id);
        let version = committedVersion(append.stream.type, append.stream.id);
        for (const event of append.events) {
          version += 1;
          buffer.set(sequenceKey(buffer.size), {
            stream: append.stream,
            version,
            partition: append.partition,
            event,
          });
          results.push({ eventId: event.eventId, version });
        }
        versions.set(key, version);
      }
      return results;
    },
    readStream: async (stream, range = {}) => {
      const { fromVersion = 1, toVersion = Number.POSITIVE_INFINITY, limit } = range;
      const found = [...logOf().values()]
        .map((logged) => logged.event)
        .concat(pendingAsStored())
        .filter(
          (event) =>
            event.stream.type === stream.type &&
            event.stream.id === stream.id &&
            event.version >= fromVersion &&
            event.version <= toVersion,
        )
        .sort((a, b) => a.version - b.version);
      return limit === undefined ? found : found.slice(0, limit);
    },
    readAll: async (after, options) => {
      const events: StoredEvent[] = [];
      for (const logged of logOf().values()) {
        if (after !== null && logged.event.position <= after) continue;
        if (logged.event.transient && options.includeTransient !== true) continue;
        if (!memoryMatchesSelector(logged, options.selector)) continue;
        events.push(logged.event);
        if (events.length >= options.limit) break;
      }
      return { events, next: events.at(-1)?.position ?? after };
    },
    find: async (match, page) => {
      const found: StoredEvent[] = [];
      for (const logged of logOf().values()) {
        const { event } = logged;
        if (page.after !== null && event.position <= page.after) continue;
        const hit =
          'commandId' in match
            ? event.commandId === match.commandId
            : 'causationId' in match
              ? event.causationId === match.causationId
              : event.eventId === match.eventId;
        if (!hit) continue;
        found.push(event);
        if (found.length >= page.limit) break;
      }
      return {
        events: found,
        next: found.length >= page.limit ? (found.at(-1)?.position ?? null) : null,
      };
    },
    head: async (selector) => {
      if (selector === undefined) {
        const counter = counterOf();
        return counter === undefined || counter.next === 1n ? null : counter.next - 1n;
      }
      let head: Position | null = null;
      for (const logged of logOf().values()) {
        if (memoryMatchesSelector(logged, selector)) head = logged.event.position;
      }
      return head;
    },
    committed: () => [...ctx.assigned],
    movedScopes: async (since, limit) => {
      const names =
        ctx.scope.level === 'namespace'
          ? ctx.tx.names('pos/')
          : hasLog
            ? [`pos/${ctx.scopeId()}`]
            : [];
      const moved: { scopeId: string; head: Position }[] = [];
      for (const name of names.toSorted()) {
        const scopeId = name.slice('pos/'.length);
        const counter = ctx.tx.read<MemoryCounter>(name).get('counter');
        const head = counter === undefined ? 0n : counter.next - 1n;
        if (head > 0n && head > (since.get(scopeId) ?? 0n)) moved.push({ scopeId, head });
        if (moved.length >= limit) break;
      }
      return moved;
    },
  };
}
