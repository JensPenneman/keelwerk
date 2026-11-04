import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { createRequest } from './create-request.ts';
import type { RequestAuthorities } from './request-authorities.ts';

type Loads = Readonly<Record<string, unknown>>;

/** The load requests of one entity (section 7.9.3), built for the module whose context hands them out. */
export function buildEntityLoads(
  entity: EntityEntry,
  view: LoadRequest['view'],
  authority: string,
  authorities: RequestAuthorities,
): Loads {
  const load = (op: LoadRequest['op'], args: readonly unknown[]): LoadRequest =>
    createRequest<LoadRequest>(
      authorities,
      {
        kind: 'load',
        module: entity.module,
        entity: entity.name,
        op,
        args: Object.freeze([...args]),
        view,
        forUpdate: false,
      },
      authority,
    );
  return Object.freeze({
    byId: (id: unknown) => load('byId', [id]),
    one: (query: unknown) => load('one', [query]),
    many: (query: unknown) => load('many', [query]),
    count: (where?: unknown) => load('count', [where]),
    exists: (where: unknown) => load('exists', [where]),
    query: (query: unknown) => load('query', [query]),
    history: (): never => {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.request_not_allowed',
        message: 'load.history is not allowed here: this release does not answer history loads.',
        details: { request: 'load.history', reason: 'this release does not answer history loads' },
      });
    },
    forCaller: (): Loads => buildEntityLoads(entity, 'caller', authority, authorities),
  });
}
