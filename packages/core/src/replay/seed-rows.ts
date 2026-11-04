import { hybridClock } from '../clock/hybrid-clock.ts';
import { errors } from '../errors/errors.ts';
import type { EventMeta } from '../events/event-meta.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { appendEvents } from '../write-path/append-events.ts';
import { defaultNodeId } from '../write-path/default-node-id.ts';
import { draftsToEvents } from '../write-path/drafts-to-events.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';
import { writeStateRows } from '../write-path/write-state-rows.ts';

const seedMeta: EventMeta = {
  actor: { kind: 'system', id: null, via: 'core.seed' },
  commandId: null,
  action: null,
  causationId: null,
  correlationId: 'seed',
  client: null,
  merge: null,
  traceparent: null,
  writer: { build: 'seed', revision: 0 },
  flags: [],
  decision: null,
};

/** What seeding rows takes. */
export interface SeedRowsInput {
  /** A read-write unit of the scope the rows live in. */
  readonly unit: Unit;
  readonly registry: Registry;
  readonly behaviours: EntityBehaviours;
  /** The fields of each row by entity reference; `id` may be named, else a UUIDv7 is minted. */
  readonly rows: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  readonly now: Temporal.Instant;
}

/**
 * Puts given rows into a unit the way the kernel would have written them: one `created` event
 * per row with the state row beside it, so the stream, its chain and the version are what a
 * command finds. Kernel work: the events carry no decision record. Test and tooling use only.
 */
export async function seedRows(input: SeedRowsInput): Promise<void> {
  const clock = hybridClock(defaultNodeId);
  for (const [ref, values] of Object.entries(input.rows)) {
    const entry = input.registry.entities.get(ref);
    if (entry === undefined) throw errors.not_found(`${ref} is not an entity of this app.`);
    const drafts = values.map((row): AnyDraft => {
      const { id, ...rest } = row;
      return Object.freeze({
        kind: 'create',
        type: 'created',
        target: ref,
        entity: ref,
        id: typeof id === 'string' ? id : newUuidV7(),
        expectedVersion: 0,
        values: Object.freeze(rest),
      }) as AnyDraft;
    });
    const written = await draftsToEvents({
      unit: input.unit,
      registry: input.registry,
      behaviours: input.behaviours,
      drafts,
      authority: entry.module,
      now: input.now,
      meta: () => seedMeta,
      reads: [],
      loaded: new Map(),
      hybridClock: clock,
    });
    await writeStateRows(input.unit, written);
    await appendEvents(input.unit, written);
  }
}
