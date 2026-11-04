import { errors } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { releaseGroupStatement } from './postgres/release-group-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Jobs of a group that stopped running, to give their slots back. */
export interface GroupRelease {
  readonly id: string;
  /** Null for a group that spans the namespace's scopes. */
  readonly scopeId: string | null;
  readonly by: number;
  /** A `rate_limited` failure blocks the group until then. */
  readonly blockedUntil?: Temporal.Instant;
}

/** Gives running slots back to groups, one row at a time in id order, each under its row lock. */
export async function sqlReleaseGroups(
  ctx: SqlUnitContext,
  releases: readonly GroupRelease[],
): Promise<void> {
  const merged = new Map<string, GroupRelease>();
  for (const release of releases) {
    const key = `${release.id}\u0000${release.scopeId ?? ''}`;
    const before = merged.get(key);
    merged.set(key, {
      ...release,
      by: (before?.by ?? 0) + release.by,
      ...(release.blockedUntil === undefined
        ? before?.blockedUntil === undefined
          ? {}
          : { blockedUntil: before.blockedUntil }
        : { blockedUntil: release.blockedUntil }),
    });
  }
  const ordered = [...merged.values()].sort(
    (a, b) =>
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || (a.scopeId ?? '').localeCompare(b.scopeId ?? ''),
  );
  for (const release of ordered) {
    const moved = await runSql(
      ctx.db,
      releaseGroupStatement(
        ctx.namespace.root,
        release.id,
        release.scopeId,
        release.blockedUntil === undefined ? null : encodeInstant(release.blockedUntil),
        release.by,
      ),
    );
    if (moved.length === 0) {
      throw errors.internal(
        `the job group ${release.id} has no row to give a running slot back to; its running count would drift`,
      );
    }
  }
}
