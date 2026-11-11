import type { StateToken } from '../events/state-token.ts';
import type { Position } from '../storage/position.ts';
import type { Scope } from '../storage/scope.ts';
import { currentTokenCheck } from './current-token-check.ts';
import { encodeStateToken } from './encode-state-token.ts';
import type { StateTokenContext } from './state-token-context.ts';
import { tokenScopePart } from './token-scope-part.ts';
import type { TokenSelector } from './token-selector.ts';

/** Issues the token of section 15.2.6 for the head `position` of a scope. */
export function issueStateToken(
  context: StateTokenContext,
  entity: string,
  scope: Scope,
  position: Position,
  selector: TokenSelector = {},
): StateToken {
  return encodeStateToken(
    {
      epoch: context.epoch,
      position,
      scope: tokenScopePart(scope),
      check: currentTokenCheck(context, entity, scope, selector),
    },
    context.sealKeyOf?.(scope) ?? context.sealKey,
  );
}
