import type { Registry, StoredEvent } from '@keelwerk/core';
import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineProcess,
  defineReaction,
  field,
  shape,
} from '@keelwerk/core';

const note = defineEntity({ prefix: 'nte', fields: { text: field.string() } });
const mark = defineEntity({ prefix: 'mrk', fields: { text: field.string() } });
const base = defineModuleBase({
  id: 'trace',
  version: '0.1.0',
  entities: { note, mark },
  observes: 'all',
});
const react = (): undefined => undefined;

/** The process `trace.tally`: its own state stream has the type `trace.tally`; it listens to an event no test writes. */
const process = (
  personal: boolean,
  key: (event: never) => string = (event: { readonly stream: { readonly id: string } }) =>
    event.stream.id,
): unknown =>
  defineProcess(
    base as never,
    {
      on: ['trace.note.archived'],
      key,
      events: {
        noted: shape(personal ? { note: field.string().personal() } : { n: field.integer() }),
      },
      initial: {},
      evolve: (state: unknown) => state,
      react,
      ...(personal ? { dataSubject: 'instanceKey' } : {}),
    } as never,
  );

/** Event ids count up, so a run is the same on every machine. */
let sequence = 0;

/** A reaction literal; the base's types are bypassed, as the dispatcher only reads the entry. */
export const reactionLiteral = (spec: object): unknown =>
  defineReaction(base as never, { on: 'trace.note.created', react, ...spec } as never);

/** What each reaction of `dispatchRegistry` is, by name. */
export const reactionKeys: { seen: number } = { seen: 0 };

/**
 * One module whose reactions cover the dispatcher's cases: plain, ordered, inline, and `on: 'all'`
 * with an except. `process` adds the process `trace.tally`, with or without a personal member, and the reaction
 * `trace.named`, which lists the process's event.
 */
export function dispatchRegistry(
  over: {
    readonly extra?: Readonly<Record<string, unknown>>;
    readonly process?: 'plain' | 'personal';
    /** The key of the process; default: the stream id. */
    readonly processKey?: (event: never) => string;
  } = {},
): Registry {
  const module = defineModule(base, {
    reactions: {
      plain: reactionLiteral({}),
      ordered: reactionLiteral({
        ordering: 'fifo-per-key',
        key: (event: { readonly current?: { readonly text?: string } }) => {
          reactionKeys.seen += 1;
          return event.current?.text ?? 'none';
        },
      }),
      inline: reactionLiteral({ timing: 'inline' }),
      every: reactionLiteral({ on: 'all', except: ['trace.mark.created'] }),
      ...(over.process === undefined
        ? {}
        : {
            tally: process(over.process === 'personal', over.processKey),
            // Named like a process event: no entity writes it, so it matches nothing in the log.
            named: reactionLiteral({ on: 'trace.tally.noted' }),
          }),
      ...over.extra,
    },
  } as never);
  return defineApp({ id: 'traceapp', modules: [module] as never }).registry;
}

/** A stored event of `type` for the dispatcher to read. */
export function eventOf(type: string, over: Partial<StoredEvent> = {}): StoredEvent {
  const [module = 'trace', entity = 'note'] = type.split('.');
  sequence += 1;
  return {
    eventId: `0197a1c2-7b3e-7c11-9a55-${String(sequence).padStart(12, '0')}`,
    position: 1n,
    namespace: 'ns-1',
    scope: {
      level: 'tenant',
      backendId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01',
      tenantId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02',
    },
    stream: { type: `${module}.${entity}`, id: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a11' },
    version: 1,
    partition: null,
    type,
    schemaVersion: 1,
    shape: `${module}.${entity}`,
    data: { values: { text: 'hello' } },
    before: null,
    hlc: '000000000000000000-n',
    recordedAt: Temporal.Instant.from('2026-03-01T08:00:00Z'),
    actor: { kind: 'user', id: 'ada', via: 'auth.session' },
    commandId: 'cmd-1',
    action: 'trace.add',
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
