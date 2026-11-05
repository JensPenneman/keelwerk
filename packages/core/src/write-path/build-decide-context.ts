import { createRequest } from '../interpreter/create-request.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { RequestAuthorities } from '../interpreter/request-authorities.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { IdRequest } from '../protocol/id-request.ts';
import type { PerformRequest } from '../protocol/perform-request.ts';
import type { RandomRequest } from '../protocol/random-request.ts';
import type { SecretRequest } from '../protocol/secret-request.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';

type Target = string | { readonly id: unknown; readonly version?: unknown };
type Constructors = Readonly<Record<string, unknown>>;

function targetOf(target: Target): { id: string; expectedVersion?: number } {
  if (typeof target === 'string') return { id: target };
  return { id: String(target.id), expectedVersion: Number(target.version) };
}

function draftOf(
  kind: AnyDraft['kind'],
  type: string,
  entity: string,
  values: Readonly<Record<string, unknown>>,
  target: { id: string; expectedVersion?: number },
): AnyDraft {
  return Object.freeze({
    kind,
    type,
    target: entity,
    entity,
    id: target.id,
    ...(target.expectedVersion === undefined ? {} : { expectedVersion: target.expectedVersion }),
    values,
  }) as AnyDraft;
}

function constructorsOf(
  entry: EntityEntry,
  input: DecideContextInput,
  ownEntity: boolean,
): Constructors {
  const { ref } = entry;
  const update = (target: Target, patch: Readonly<Record<string, unknown>>): AnyDraft =>
    draftOf('update', 'changed', ref, patch, targetOf(target));
  if (!ownEntity) return Object.freeze({ update });
  const events: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(entry.events)) {
    events[name] = (target: Target, payload: Readonly<Record<string, unknown>>): AnyDraft =>
      draftOf('event', name, ref, payload, targetOf(target));
  }
  return Object.freeze({
    ...events,
    create: (values: Readonly<Record<string, unknown>>): AnyDraft => {
      const { id, ...rest } = values;
      const named = typeof id === 'string' ? id : input.newId(ref);
      return Object.freeze({
        kind: 'create',
        type: 'created',
        target: ref,
        entity: ref,
        id: named,
        expectedVersion: 0,
        values: Object.freeze(rest),
      }) as AnyDraft;
    },
    update,
    archive: (target: Target, options?: { readonly reason?: string }): AnyDraft =>
      draftOf('archive', 'archived', ref, options ?? {}, targetOf(target)),
    restore: (target: Target): AnyDraft =>
      draftOf('restore', 'restored', ref, {}, targetOf(target)),
  });
}

/** What the context of `decide` and `prepare` is built from. */
export interface DecideContextInput {
  /** The read context of the authority module (section 7.6): loads, flags, services and the rest. */
  readonly base: Constructors;
  readonly registry: Registry;
  readonly authorities: RequestAuthorities;
  /** The module whose authority the drafts are written with: the declaring module, or the contributor of a contributed command. */
  readonly module: string;
  /** What `prepare` passed on; `undefined` without one. */
  readonly prepared: unknown;
  /** The entity an entity command is mounted on and its loaded row: `ctx.events` drafts for it. */
  readonly target?: {
    readonly entry: EntityEntry;
    readonly row: Readonly<Record<string, unknown>>;
  };
  /** Mints the id of a `create` that names none, and records it as an answer. */
  readonly newId: (entity: string) => string;
  /** Adds `perform` (the `prepare` form): the request exists and the interpreter refuses it (S-05). */
  readonly withPerform?: boolean;
}

/**
 * The context of `decide` (section 7.9.7): the read context of the authority module plus the
 * write side. `ctx.write.<module>.<entity>` holds the draft constructors of the module's own
 * entities and its domain events by name, and for another module's entity `update` only (the
 * runtime refuses a draft outside the fields the module contributed, section 8.4); `ctx.events`
 * holds the target entity's domain events; `newId` and `random` build requests. A draft built
 * from a row carries that row's version, one built from an id carries none (S-21).
 */
export function buildDecideContext(input: DecideContextInput): Constructors {
  const { registry, module, authorities } = input;
  const write: Record<string, Record<string, Constructors>> = Object.create(null);
  for (const entry of registry.entities.values()) {
    const own = entry.module === module;
    const contributed = Object.values(entry.origin).includes(module);
    if (!(own || contributed)) continue;
    const owner = registry.modules.find((candidate) => candidate.id === entry.module);
    if (owner === undefined) continue;
    const group: Record<string, Constructors> = write[owner.contextName] ?? Object.create(null);
    group[entry.name] = constructorsOf(entry, input, own);
    write[owner.contextName] = group;
  }
  for (const [name, group] of Object.entries(write)) write[name] = Object.freeze(group);

  const events: Record<string, unknown> = Object.create(null);
  if (input.target !== undefined) {
    const { entry, row } = input.target;
    for (const name of Object.keys(entry.events)) {
      events[name] = (payload: Readonly<Record<string, unknown>>): AnyDraft =>
        draftOf('event', name, entry.ref, payload, targetOf(row as { id: unknown }));
    }
  }
  const prefixes = new Map<string, string>();
  for (const entry of registry.entities.values()) prefixes.set(entry.prefix, entry.ref);

  const extra: Record<string, unknown> = {
    write: Object.freeze(write),
    events: Object.freeze(events),
    prepared: input.prepared,
    newId: (entity: { readonly prefix?: unknown } | string) => {
      const ref = typeof entity === 'string' ? entity : prefixes.get(String(entity.prefix));
      if (ref === undefined) throw refuseRequest('id', 'the entity is not part of this app');
      return createRequest<IdRequest>(authorities, { kind: 'id', entity: ref }, module);
    },
    random: (bytes: number) =>
      createRequest<RandomRequest>(authorities, { kind: 'random', bytes }, module),
    secrets: Object.freeze({
      ...(input.base.secrets as object),
      issue: (options: unknown) =>
        createRequest<SecretRequest>(
          authorities,
          { kind: 'secret', op: 'issue', args: Object.freeze([options]) },
          module,
        ),
    }),
  };
  if (input.withPerform === true) {
    extra.perform = (effect: PerformRequest['effect']) =>
      createRequest<PerformRequest>(authorities, { kind: 'perform', effect }, module);
  }
  const descriptors: PropertyDescriptorMap = {};
  for (const [name, value] of Object.entries(extra)) {
    descriptors[name] = { value, enumerable: true };
  }
  return Object.freeze(Object.create(input.base, descriptors) as Constructors);
}
