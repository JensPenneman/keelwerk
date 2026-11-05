import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import { newestAnchors } from './newest-anchors.ts';

/**
 * The rewind signal of S-35 at `connect`: each scope's head position against its newest anchor in
 * the ledger sinks; `resolve` is asked for the scopes that have an anchor only. A scope whose head
 * lies below its newest anchor was restored from an older backup; the caller logs it, `keelwerk
 * doctor` lists it and `keelwerk db verify` fails on it (`verifyAnchors`). Epoch bumps and the
 * control store's mark tables are M2. Returns the ids of the rewound scopes.
 */
export async function connectRewindCheck(
  sinks: readonly LedgerSink[],
  resolve: (scopeIds: ReadonlySet<string>) => Promise<ReadonlyMap<string, ScopeTarget>>,
): Promise<readonly string[]> {
  if (sinks.length === 0) return [];
  const newest = await newestAnchors(sinks);
  if (newest.size === 0) return [];
  const scopes = await resolve(new Set(newest.keys()));
  const rewound: string[] = [];
  for (const [scopeId, anchor] of newest) {
    const target = scopes.get(scopeId);
    if (target === undefined) continue;
    const head = await target.handle.adapter.unit(
      target.namespace,
      target.scope,
      (unit) => unit.events.head(),
      { readOnly: true },
    );
    if ((head ?? 0n) < BigInt(anchor.position)) rewound.push(scopeId);
  }
  return rewound;
}
