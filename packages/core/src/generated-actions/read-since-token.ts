import type { Position } from '../storage/position.ts';
import { assertTokenScope } from '../tokens/assert-token-scope.ts';
import { currentTokenCheck } from '../tokens/current-token-check.ts';
import { decodeStateToken } from '../tokens/decode-state-token.ts';
import { tokenCheckHolds } from '../tokens/token-check-holds.ts';
import type { TokenSelector } from '../tokens/token-selector.ts';
import type { GeneratedReadInput } from './generated-read-input.ts';

/** Why a client must resynchronise (JMAP `cannotCalculateChanges`, `reset` in sync and live). */
type ResetReason = 'epoch' | 'check' | 'position' | 'uncertain' | 'tooManyChanges';

/** A token read against the current epoch, scope and visibility. */
export type SinceToken =
  | { readonly ok: true; readonly position: Position }
  | { readonly ok: false; readonly reason: ResetReason };

/**
 * Reads the token a client sends back (section 15.2.6). A token of another scope is
 * `core.token_scope_mismatch`; another epoch, another check (other rules, roles, memberships,
 * principal, partition, filter or sort) or a position past the head resets.
 */
export function readSinceToken(
  input: GeneratedReadInput,
  token: string,
  selector: TokenSelector,
): SinceToken {
  const parts = decodeStateToken(token);
  assertTokenScope(parts, input.scope);
  if (parts.epoch !== input.tokens.epoch) return { ok: false, reason: 'epoch' };
  const check = currentTokenCheck(input.tokens, input.entry.ref, input.scope, selector);
  if (!tokenCheckHolds(parts, check, input.tokens.sealKey)) {
    return { ok: false, reason: 'check' };
  }
  if (parts.position > input.head) return { ok: false, reason: 'position' };
  return { ok: true, position: parts.position };
}
