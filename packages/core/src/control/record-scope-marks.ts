import type { ScopeTarget } from '../invoker/scope-target.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { ScopeCounters } from '../storage/scope-counters.ts';
import type { ControlStore } from './control-store.ts';
import type { ScopeMark } from './scope-mark.ts';

const pageSize = 500;

/** The key of a scope in a process's memo and positions: two namespaces may hold the same scope. */
function keyOf(namespaceId: string, scopeId: string): string {
  return `${namespaceId}\u0000${scopeId}`;
}

/** What the counters of one scope amount to, for the memo that skips an unchanged scope. */
function signatureOf(counters: ScopeCounters): string {
  return canonicalizeJson({
    position: counters.position.toString(),
    serials: Object.fromEntries(
      Object.entries(counters.serials).map(([name, value]) => [name, value.toString()]),
    ),
  });
}

/**
 * Reads the counters of the source's namespace (all scopes, or `scopeIds`) in a read-only
 * namespace unit and raises their marks in pages of 500 (14.7.6): the mark of a scope is its last
 * position and each serial's last value, so a restore that rewinds the counters is found by the
 * comparison at the next `connect`. A scope whose counters equal `memo`'s entry is skipped and
 * `memo` is updated after the marks are written; `memo` and `positions` are keyed by namespace and
 * scope together, so one scope with counters in two namespaces is two entries. A new mark holds
 * epoch 0; a stored epoch stays.
 * With `positions`, the last position seen per scope is kept, and a scope whose position is now
 * below it was rewound under the running process (a restore the counters can see): `onRewind` is
 * called with the scope's counters and the position it had. Answers the number of marks
 * written.
 */
export async function recordScopeMarks(
  control: ControlStore,
  source: Omit<ScopeTarget, 'scope'>,
  options: {
    readonly now: Temporal.Instant;
    readonly scopeIds?: readonly string[];
    readonly memo?: Map<string, string>;
    /** The last position seen per scope, kept between calls. */
    readonly positions?: Map<string, bigint>;
    readonly onRewind?: (counters: ScopeCounters, was: bigint) => void;
  },
): Promise<number> {
  const { namespace, handle } = source;
  const { memo } = options;
  let written = 0;
  let after: string | undefined;
  for (;;) {
    const page: readonly ScopeCounters[] = await handle.adapter.unit(
      namespace,
      { level: 'namespace', reason: 'marks' },
      async (unit) =>
        unit.counters?.list({
          limit: pageSize,
          ...(after === undefined ? {} : { after }),
          ...(options.scopeIds === undefined ? {} : { scopeIds: options.scopeIds }),
        }) ?? [],
      { readOnly: true },
    );
    const last = page.at(-1);
    if (last === undefined) break;
    after = last.scopeId;
    if (options.positions !== undefined) {
      for (const counters of page) {
        const key = keyOf(namespace.id, counters.scopeId);
        const was = options.positions.get(key);
        if (was !== undefined && counters.position < was) {
          options.onRewind?.(counters, was);
        } else {
          options.positions.set(key, counters.position);
        }
      }
    }
    const changed = page.filter(
      (counters) =>
        memo === undefined ||
        memo.get(keyOf(namespace.id, counters.scopeId)) !== signatureOf(counters),
    );
    if (changed.length > 0) {
      const marks = changed.map(
        (counters): ScopeMark => ({
          scopeId: counters.scopeId,
          namespaceId: namespace.id,
          epoch: 0,
          position: counters.position,
          serials: counters.serials,
          updatedAt: options.now,
        }),
      );
      await control.marks.raise(marks);
      written += marks.length;
      if (memo !== undefined) {
        for (const counters of changed) {
          memo.set(keyOf(namespace.id, counters.scopeId), signatureOf(counters));
        }
      }
    }
    if (page.length < pageSize) break;
  }
  return written;
}
