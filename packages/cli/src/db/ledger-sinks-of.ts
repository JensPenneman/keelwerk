import type { LedgerSink } from '@keelwerk/core';

function isSink(value: unknown): value is LedgerSink {
  return (
    typeof value === 'object' &&
    value !== null &&
    'append' in value &&
    'read' in value &&
    typeof value.read === 'function'
  );
}

/** The ledger sinks a deployment lists among its infrastructure. */
export function ledgerSinksOf(infrastructure: readonly unknown[]): readonly LedgerSink[] {
  return infrastructure.filter(isSink);
}
