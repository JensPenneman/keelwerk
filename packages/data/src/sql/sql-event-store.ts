import type { EventStore, Position, StoredEvent, StreamRef } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { sql } from 'kysely';
import { assertStreamInScope } from './assert-stream-in-scope.ts';
import { eventSelectorConditions } from './event-selector-conditions.ts';
import { positionAfterLock } from './postgres/position-after-lock.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlGuard } from './sql-guard.ts';
import { sqlStreamKey } from './sql-stream-key.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { storedEventOfRow } from './stored-event-of-row.ts';
import { streamVersionConflict } from './stream-version-conflict.ts';

const uuidShaped = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const columns = [
  'scope_id',
  'backend_id',
  'stream_type',
  'stream_id',
  'stream_version',
  'partition_key',
  'event_id',
  'name',
  'schema_version',
  'shape_id',
  'data',
  'before',
  'meta',
  'hlc',
  'recorded_at',
  'transient',
  'prev_hash',
  'hash',
] as const;

/**
 * The event log of a unit's scope (15.1.11) over `kw_events` and `kw_positions`. Appends are
 * buffered in the unit's commit buffer and written at the commit tail (`runCommitTail`), which
 * numbers them from the scope's counter; the expected-version check reads the stream's committed
 * version, and a concurrent append of the same version loses at the tail's unique constraint.
 * Tenant, backend and deployment units each have a log; a namespace-scope unit has none, and
 * `movedScopes` is the one member it uses, across the namespace's scopes (the maintenance policy).
 */
export function sqlEventStore(ctx: SqlUnitContext, buffer: SqlCommitBuffer): EventStore {
  const hasLog = ctx.scope.level !== 'namespace';
  const table = ctx.table('kw_events');

  const committedVersions = async (
    streams: readonly StreamRef[],
  ): Promise<ReadonlyMap<string, number>> => {
    const rows = await sqlGuard(async () =>
      ctx
        .scopedDb()
        .selectFrom(table)
        .select([
          'stream_type',
          sql<string>`stream_id::text`.as('stream_id'),
          sql<number>`max(stream_version)`.as('version'),
        ])
        .where((eb) =>
          eb.or(
            streams.map((stream) =>
              eb.and([eb('stream_type', '=', stream.type), eb('stream_id', '=', stream.id)]),
            ),
          ),
        )
        .groupBy(['stream_type', 'stream_id'])
        .execute(),
    );
    return new Map(
      rows.map((row) => [
        sqlStreamKey({ type: String(row.stream_type), id: String(row.stream_id) }),
        Number(row.version),
      ]),
    );
  };

  /** The position the next buffered event would get if no other unit of the scope committed first. */
  const nextPosition = async (): Promise<Position> => {
    const row = await sqlGuard(async () =>
      ctx
        .scopedDb()
        .selectFrom(ctx.table('kw_positions'))
        .select(sql<string>`next::text`.as('next'))
        .executeTakeFirst(),
    );
    return row === undefined ? 1n : BigInt(String(row.next));
  };

  const buffered = async (): Promise<readonly StoredEvent[]> => {
    if (buffer.events.length === 0) return [];
    const base = await nextPosition();
    return buffer.events.map((pending, index) => ({
      eventId: pending.event.eventId,
      position: base + BigInt(index),
      namespace: ctx.namespace.id,
      scope: ctx.scope as StoredEvent['scope'],
      stream: pending.stream,
      version: pending.version,
      partition: pending.partition,
      type: `${pending.stream.type}.${pending.event.name}`,
      schemaVersion: pending.event.schemaVersion,
      shape: pending.event.shape,
      data: pending.event.data,
      before: pending.event.before as StoredEvent['before'],
      hlc: pending.event.hlc,
      recordedAt: pending.event.recordedAt,
      actor: pending.event.meta.actor,
      commandId: pending.event.meta.commandId,
      action: pending.event.meta.action,
      causationId: pending.event.meta.causationId,
      correlationId: pending.event.meta.correlationId,
      client: pending.event.meta.client,
      merge: pending.event.meta.merge,
      writer: pending.event.meta.writer,
      flags: pending.event.meta.flags,
      decision: pending.event.meta.decision,
      transient: pending.event.transient,
      prevHash: pending.event.prevHash,
      hash: pending.event.hash,
      traceparent: pending.event.meta.traceparent,
    }));
  };

  return {
    append: async (batch) => {
      ctx.writable();
      if (!hasLog) throw errors.internal(`a ${ctx.scope.level}-scope unit has no event log`);
      for (const append of batch) {
        if (append.tenancy !== undefined) {
          assertStreamInScope({ ref: append.stream.type, tenancy: append.tenancy }, ctx.scope);
        } else {
          const entity = ctx.entities.find(append.stream.type);
          if (entity === undefined) {
            throw errors.internal(`the shape of ${append.stream.type} is unknown to this unit`);
          }
          assertStreamInScope(entity, ctx.scope);
        }
      }
      const unknown = new Map<string, StreamRef>();
      for (const append of batch) {
        const { type, id } = append.stream;
        if (buffer.versionOf(type, id) === undefined)
          unknown.set(sqlStreamKey(append.stream), append.stream);
      }
      const committed =
        unknown.size === 0 ? new Map() : await committedVersions([...unknown.values()]);
      const planned = new Map<string, number>();
      for (const append of batch) {
        const key = sqlStreamKey(append.stream);
        const version =
          planned.get(key) ??
          buffer.versionOf(append.stream.type, append.stream.id) ??
          committed.get(key) ??
          0;
        if (version !== append.expectedVersion) {
          throw streamVersionConflict(append.stream, append.expectedVersion, version);
        }
        planned.set(key, version + append.events.length);
      }
      const results: { eventId: string; version: number }[] = [];
      for (const append of batch) {
        const key = sqlStreamKey(append.stream);
        let version = committed.get(key) ?? 0;
        version = buffer.versionOf(append.stream.type, append.stream.id) ?? version;
        for (const event of append.events) {
          version += 1;
          buffer.push({ stream: append.stream, version, partition: append.partition, event });
          results.push({ eventId: event.eventId, version });
        }
      }
      return results;
    },

    readStream: async (stream, range = {}) => {
      if (!hasLog) return [];
      const { fromVersion = 1, toVersion = Number.POSITIVE_INFINITY, limit } = range;
      const rows = await sqlGuard(async () => {
        let query = ctx
          .scopedDb()
          .selectFrom(table)
          .select([...columns, sql<string>`position::text`.as('position_text')])
          .where('stream_type', '=', stream.type)
          .where('stream_id', '=', stream.id)
          .where('stream_version', '>=', fromVersion);
        if (Number.isFinite(toVersion)) query = query.where('stream_version', '<=', toVersion);
        query = query.orderBy('stream_version');
        if (limit !== undefined) query = query.limit(limit);
        return query.execute();
      });
      const found: StoredEvent[] = rows.map((row) => storedEventOfRow(ctx, row));
      const own = buffer.events.some(
        (pending) => pending.stream.type === stream.type && pending.stream.id === stream.id,
      );
      if (!own) return found;
      const merged = [
        ...found,
        ...(await buffered()).filter(
          (event) =>
            event.stream.type === stream.type &&
            event.stream.id === stream.id &&
            event.version >= fromVersion &&
            event.version <= toVersion,
        ),
      ].sort((a, b) => a.version - b.version);
      return limit === undefined ? merged : merged.slice(0, limit);
    },

    readAll: async (after, options) => {
      if (!hasLog) return { events: [], next: after };
      const rows = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .selectFrom(table)
          .select([...columns, sql<string>`position::text`.as('position_text')])
          .where((eb) =>
            eb.and([
              ...(after === null ? [] : [eb('position', '>', after.toString())]),
              ...(options.includeTransient === true ? [] : [eb('transient', '=', false)]),
              ...eventSelectorConditions(eb, options.selector),
            ]),
          )
          .orderBy('position')
          .limit(options.limit)
          .execute(),
      );
      const events = rows.map((row) => storedEventOfRow(ctx, row));
      return { events, next: events.at(-1)?.position ?? after };
    },

    find: async (match, page) => {
      if (!hasLog) return { events: [], next: null };
      if ('eventId' in match && !uuidShaped.test(match.eventId)) return { events: [], next: null };
      const rows = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .selectFrom(table)
          .select([...columns, sql<string>`position::text`.as('position_text')])
          .where((eb) =>
            eb.and([
              ...(page.after === null ? [] : [eb('position', '>', page.after.toString())]),
              'commandId' in match
                ? eb(sql<string | null>`meta->>'commandId'`, '=', match.commandId)
                : 'causationId' in match
                  ? eb(sql<string | null>`meta->>'causationId'`, '=', match.causationId)
                  : eb('event_id', '=', match.eventId),
            ]),
          )
          .orderBy('position')
          .limit(page.limit)
          .execute(),
      );
      const events = rows.map((row) => storedEventOfRow(ctx, row));
      return {
        events,
        next: events.length >= page.limit ? (events.at(-1)?.position ?? null) : null,
      };
    },

    head: async (selector) => {
      if (!hasLog) return null;
      if (selector === undefined) {
        const [row] = await sqlGuard(async () =>
          runSql(ctx.db, positionAfterLock(ctx.namespace.root, ctx.scopeId())),
        );
        const position = BigInt(String(row?.position ?? '0'));
        return position === 0n ? null : position;
      }
      const row = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .selectFrom(table)
          .select(sql<string | null>`max(position)::text`.as('head'))
          .where((eb) => eb.and([...eventSelectorConditions(eb, selector)]))
          .executeTakeFirst(),
      );
      return row?.head === null || row?.head === undefined ? null : BigInt(String(row.head));
    },

    committed: () => [...buffer.assigned],

    movedScopes: async (since, limit) => {
      const ids = [...since.keys()];
      const rows = await sqlGuard(async () =>
        runSql(ctx.db, {
          sql: `select p.scope_id::text as scope_id, (p.next - 1)::text as head
from ${quoteIdentifier(ctx.namespace.root)}.kw_positions p
where p.next > 1
  and p.next - 1 > coalesce((select s.head::bigint from unnest($1::text[], $2::text[]) as s (id, head) where s.id = p.scope_id::text), 0)
  and ($3::text is null or p.scope_id = $3::uuid)
order by p.scope_id
limit $4::integer`,
          parameters: [
            ids,
            ids.map((id) => String(since.get(id))),
            ctx.scope.level === 'namespace' ? null : ctx.scopeId(),
            limit,
          ],
        }),
      );
      return rows.map((row) => ({
        scopeId: String(row.scope_id),
        head: BigInt(String(row.head)),
      }));
    },
  };
}
