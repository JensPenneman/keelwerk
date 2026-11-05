import { errors } from '../errors/errors.ts';
import type { Scope } from '../storage/scope.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import { readVisibility } from './read-visibility.ts';
import type { StateTokenContext } from './state-token-context.ts';
import { tokenCheck } from './token-check.ts';
import type { TokenSelector } from './token-selector.ts';

/** The `check` part a token for this entity, principal and selector carries now. */
export function currentTokenCheck(
  context: StateTokenContext,
  entity: string,
  scope: Scope,
  selector: TokenSelector = {},
): string {
  const entry = context.registry.entities.get(entity);
  if (entry === undefined) throw errors.internal(`a token names ${entity}, which is not an entity`);
  return tokenCheck({
    ...readVisibility(context, entry, scope),
    entity,
    partition: selector.partition ?? '',
    ...(selector.query === undefined
      ? {}
      : {
          selector: {
            filter: encodeEventValue(selector.query.filter ?? null),
            sort: selector.query.sort,
          },
        }),
  });
}
