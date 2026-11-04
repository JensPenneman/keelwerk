import type { MigrationStep } from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';
import { sha256 } from '@keelwerk/core/crypto';

/**
 * The checksum of a migration file: the SHA-256 of its canonical neutral steps (section 14.6.3).
 * Every adapter and the planner use this one function, so a changed applied file is drift
 * wherever it is noticed.
 */
export function migrationChecksum(steps: readonly MigrationStep[]): string {
  return sha256(canonicalizeJson(steps));
}
