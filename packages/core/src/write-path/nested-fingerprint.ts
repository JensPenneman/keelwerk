import type { FingerprintSource } from './command-fingerprint.ts';
import { commandFingerprint } from './command-fingerprint.ts';
import type { FingerprintKeys } from './fingerprint-keys.ts';

/**
 * The fingerprint of a command that an `invoke` runs nested. It keeps the outer job (the nested
 * receipt commits only with the outer job's receipt, the one that replays after a deploy), yet its
 * fingerprint and the digest of its decision record hold the version it ran at: a re-decision knows
 * no job. `keys` is the nested unit, where the nested command's personal members are digested.
 */
export function nestedFingerprint(
  run: FingerprintSource,
  keys: FingerprintKeys | null,
): Promise<string> {
  const { job: _job, ...unversioned } = run;
  return commandFingerprint(unversioned, keys);
}
