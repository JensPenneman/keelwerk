import type { StubEntry } from './infrastructure-entry.ts';

/** Stand-in for @keelwerk/core/ledger: a ledger sink outside placement backups. */
export function ledgerFile(options: { readonly path: string }): StubEntry<readonly []> {
  return { kind: `ledger:${options.path}`, provides: [] };
}
