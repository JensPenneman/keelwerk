import type { VerifyOutcome } from '../kernel/verify-outcome.ts';
import { verifySecret } from './verify-secret.ts';

/**
 * No key at all means the scope key the verifier was made under is destroyed; otherwise the
 * constant-time comparison of `verifySecret` answers `match` or `wrong`.
 */
export function destroyedOrWrong(
  key: Uint8Array | undefined,
  token: string,
  verifier: string,
): VerifyOutcome {
  if (key === undefined) return 'destroyed';
  return verifySecret(key, token, verifier) ? 'match' : 'wrong';
}
