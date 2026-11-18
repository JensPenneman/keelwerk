import type { CommandDigests, FingerprintSource } from './command-digests.ts';
import { commandDigests } from './command-digests.ts';

/**
 * The digests of a command that an `invoke` runs nested. It keeps the outer job (the nested receipt
 * commits only with the outer job's receipt, the one that replays after a deploy), yet its
 * fingerprint and the digest of its decision record hold the version it ran at: a re-decision knows
 * no job. The source carries the outer run's fingerprint key: the nested run is in the same scope.
 */
export function nestedFingerprint(run: FingerprintSource): CommandDigests {
  const { job: _job, ...unversioned } = run;
  return commandDigests(unversioned);
}
