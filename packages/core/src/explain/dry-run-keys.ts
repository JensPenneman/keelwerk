import { errors } from '../errors/errors.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { isForkable } from '../keys/is-forkable.ts';

const refused = (what: string): Error =>
  errors.internal(
    `The dry run cannot ${what}: this key service cannot fork, and a real one would commit keys outside the rollback.`,
  );

/**
 * The key service a dry run runs with: a fork whose new keys stay in memory (WP-45). A key service
 * that cannot fork may still verify and reveal what exists, but `issue` and `derive` are refused,
 * because they could create a scope key the rollback cannot undo.
 */
export function dryRunKeys(keys: KeyService): KeyService {
  if (isForkable(keys)) return keys.fork();
  return {
    issue: () => Promise.reject(refused('issue a secret')),
    derive: () => Promise.reject(refused('derive a key')),
    verify: (scope, token, verifier) => keys.verify(scope, token, verifier),
    reveal: (unit, ref, reason) => keys.reveal(unit, ref, reason),
    invalidate: (scope) => {
      keys.invalidate(scope);
    },
  };
}
