import type { LedgerRecord } from '@keelwerk/core';
import { cadenceOf } from './cadence-of.ts';
import type { AnchorFacts } from './deployment-facts.ts';

interface Sink {
  read(): AsyncIterable<LedgerRecord>;
}

function isSink(value: unknown): value is Sink {
  return (
    typeof value === 'object' &&
    value !== null &&
    'append' in value &&
    'read' in value &&
    typeof value.read === 'function'
  );
}

/** The newest anchor of every scope in the deployment's ledger sinks, against the heads `heads` reads. */
export async function readAnchorFacts(
  infrastructure: readonly unknown[],
  every: string | undefined,
  heads: ((scopeIds: ReadonlySet<string>) => Promise<ReadonlyMap<string, string>>) | undefined,
): Promise<AnchorFacts> {
  const newest = new Map<string, { position: bigint; at: string }>();
  for (const entry of infrastructure.filter(isSink)) {
    for await (const record of entry.read()) {
      if (record.type !== 'anchor') continue;
      const position = BigInt(record.position);
      const known = newest.get(record.scopeId);
      if (known === undefined || position > known.position) {
        newest.set(record.scopeId, { position, at: record.recordedAt });
      }
    }
  }
  const current =
    heads === undefined ? new Map<string, string>() : await heads(new Set(newest.keys()));
  return {
    cadenceMs: cadenceOf(every),
    refusedAppends: 0,
    scopes: [...newest].map(([scopeId, anchor]) => ({
      scopeId,
      anchored: anchor.position.toString(),
      anchoredAt: anchor.at,
      head: current.get(scopeId),
    })),
  };
}
