import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';

/**
 * The rewind signal of S-35: each scope's head position against the newest anchor in the ledger
 * sinks; `resolve` is asked for the scopes that have an anchor only. A scope whose head lies below its newest anchor was restored from an older backup; the
 * caller logs it, `keelwerk doctor` lists it and `keelwerk db verify` fails on it. Epoch bumps and
 * the control store's mark tables are M2.
 */
export async function compareAnchors(
  sinks: readonly LedgerSink[],
  resolve: (scopeIds: ReadonlySet<string>) => Promise<ReadonlyMap<string, ScopeTarget>>,
): Promise<readonly string[]> {
  if (sinks.length === 0) return [];
  const newest = new Map<string, bigint>();
  for (const sink of sinks) {
    for await (const record of sink.read()) {
      if (record.type !== 'anchor') continue;
      const position = BigInt(record.position);
      const known = newest.get(record.scopeId);
      if (known === undefined || position > known) newest.set(record.scopeId, position);
    }
  }
  if (newest.size === 0) return [];
  const scopes = await resolve(new Set(newest.keys()));
  const rewound: string[] = [];
  for (const [scopeId, anchored] of newest) {
    const target = scopes.get(scopeId);
    if (target === undefined) continue;
    const head = await target.handle.adapter.unit(
      target.namespace,
      target.scope,
      (unit) => unit.events.head(),
      { readOnly: true },
    );
    if ((head ?? 0n) < anchored) rewound.push(scopeId);
  }
  return rewound;
}
