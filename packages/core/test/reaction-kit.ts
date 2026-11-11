import { defineEntity } from '../src/dsl/define-entity.ts';
import { defineProcess } from '../src/dsl/define-process.ts';
import { defineReaction } from '../src/dsl/define-reaction.ts';
import type { StoredEvent } from '../src/events/stored-event.ts';
import { field } from '../src/fields/field.ts';
import { shape } from '../src/fields/shape.ts';
import { buildRegistry } from '../src/registry/build-registry.ts';
import type { ReactionEntry } from '../src/registry/reaction-entry.ts';
import type { Registry } from '../src/registry/registry.ts';
import { appOf, makeModule } from './registry-kit.ts';

const note = defineEntity({
  prefix: 'nte',
  dataSubject: 'owner',
  fields: { owner: field.subject(), text: field.string() },
});
const logsBase = (makeModule({ id: 'logs', entities: { note } }) as unknown as { base: object })
  .base;

const react = (): undefined => undefined;
const reaction = (spec: object): object =>
  defineReaction(logsBase as never, { on: 'logs.note.created', react, ...spec } as never);

/** Four async reactions and a process of one module over one entity, as the dispatcher and the job form see them. */
export function reactionRegistry(over: { readonly process?: object } = {}): Registry {
  const process = defineProcess(
    logsBase as never,
    {
      on: ['logs.note.created'],
      key: (event: { readonly stream: { readonly id: string } }) => event.stream.id,
      events: { noted: shape({ note: field.string().personal(), n: field.integer() }) },
      dataSubject: 'instanceKey',
      initial: { count: 0 },
      evolve: (state: { count: number }, event: { data: { n: number } }) => ({
        count: state.count + event.data.n,
      }),
      react,
      ...over.process,
    } as never,
  );
  return buildRegistry(
    appOf([
      makeModule(
        { id: 'logs', entities: { note } },
        {
          reactions: {
            plain: reaction({}),
            ordered: reaction({
              ordering: 'fifo-per-key',
              key: (event: { readonly stream: { readonly id: string } }) => event.stream.id,
            }),
            latest: reaction({ coalesce: true, key: () => 'k' }),
            retried: reaction({
              concurrency: 2,
              retry: { limit: 5, delays: ['10s', '20s'] },
            }),
            inline: reaction({ timing: 'inline' }),
            tally: process,
          },
        },
      ),
    ]),
  );
}

/** The reaction `logs.<name>` of `reactionRegistry`. */
export function reactionOf(registry: Registry, name: string): ReactionEntry {
  const found = registry.reactions.get(`logs.${name}`);
  if (found === undefined) throw new Error(`the fixture has no reaction logs.${name}`);
  return found;
}

export const reactionTenantScope = {
  level: 'tenant',
  backendId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01',
  tenantId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02',
} as const;

/** A stored event of `logs.note` in the tenant scope. */
export function noteEvent(over: Partial<StoredEvent> = {}): StoredEvent {
  return {
    eventId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a10',
    position: 7n,
    namespace: 'ns-1',
    scope: reactionTenantScope,
    stream: { type: 'logs.note', id: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a11' },
    version: 1,
    partition: null,
    type: 'logs.note.created',
    schemaVersion: 1,
    shape: 'logs.note',
    data: { values: { text: 'hello' } },
    before: null,
    hlc: '000000000000000000-n',
    recordedAt: Temporal.Instant.from('2026-03-01T08:00:00Z'),
    actor: { kind: 'user', id: 'ada', via: 'auth.session' },
    commandId: 'cmd-1',
    action: 'logs.write',
    causationId: null,
    correlationId: 'corr-1',
    client: null,
    merge: null,
    writer: { build: 'b', revision: 1 },
    flags: [],
    decision: null,
    transient: false,
    prevHash: null,
    hash: null,
    traceparent: null,
    ...over,
  } as StoredEvent;
}
