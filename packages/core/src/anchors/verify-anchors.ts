import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import type { AnchorFinding } from './anchor-finding.ts';
import type { AnchorRecord } from './newest-anchors.ts';

/** What `verifyAnchors` found. */
export interface AnchorVerdict {
  /** Distinct anchored (scope, position) pairs compared. */
  readonly checked: number;
  /** Scopes the ledger has anchors for that `resolve` did not answer (deleted or not served here). */
  readonly unresolved: readonly string[];
  readonly findings: readonly AnchorFinding[];
}

/**
 * Compares the chain with the anchors of the ledger sinks (section 15.1.8): the event at each
 * anchored position must exist with the anchored hash and stream, and the scope's head must be at
 * or past its newest anchor, so a chain rewritten or rewound inside the placement is found even
 * when its links are consistent. Read-only; `keelwerk db verify` fails on any finding and
 * `keelwerk doctor` lists the scopes of the `behind` ones.
 */
export async function verifyAnchors(
  sinks: readonly LedgerSink[],
  resolve: (scopeIds: ReadonlySet<string>) => Promise<ReadonlyMap<string, ScopeTarget>>,
): Promise<AnchorVerdict> {
  const byScope = new Map<string, Map<string, AnchorRecord>>();
  for (const sink of sinks) {
    for await (const record of sink.read()) {
      if (record.type !== 'anchor') continue;
      const held = byScope.get(record.scopeId) ?? new Map<string, AnchorRecord>();
      held.set(
        `${record.position}:${record.hash}:${record.stream.type}:${record.stream.id}`,
        record,
      );
      byScope.set(record.scopeId, held);
    }
  }
  const targets =
    byScope.size === 0 ? new Map<string, ScopeTarget>() : await resolve(new Set(byScope.keys()));
  const findings: AnchorFinding[] = [];
  const unresolved: string[] = [];
  let checked = 0;
  for (const [scopeId, held] of byScope) {
    const target = targets.get(scopeId);
    if (target === undefined) {
      unresolved.push(scopeId);
      continue;
    }
    const anchors = [...held.values()].toSorted((a, b) => {
      const gap = BigInt(a.position) - BigInt(b.position);
      return gap < 0n ? -1 : gap > 0n ? 1 : 0;
    });
    await target.handle.adapter.unit(
      target.namespace,
      target.scope,
      async (unit) => {
        for (const anchor of anchors) {
          const position = BigInt(anchor.position);
          checked += 1;
          const page = await unit.events.readAll(position - 1n > 0n ? position - 1n : null, {
            limit: 1,
            includeTransient: true,
          });
          const event = page.events[0];
          if (event === undefined || event.position !== position) {
            findings.push({ kind: 'missing', scopeId, position: anchor.position });
          } else if (
            event.hash !== anchor.hash ||
            event.stream.type !== anchor.stream.type ||
            event.stream.id !== anchor.stream.id
          ) {
            findings.push({
              kind: 'mismatch',
              scopeId,
              position: anchor.position,
              anchoredHash: anchor.hash,
              foundHash: event.hash,
            });
          }
        }
        const newest = anchors.at(-1);
        const head = await unit.events.head();
        if (newest !== undefined && (head ?? 0n) < BigInt(newest.position)) {
          findings.push({
            kind: 'behind',
            scopeId,
            head: head === null ? null : head.toString(),
            newest: newest.position,
          });
        }
      },
      { readOnly: true },
    );
  }
  return { checked, unresolved, findings };
}
